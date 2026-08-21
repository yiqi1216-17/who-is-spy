import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import {
  FeedbackError,
  FeedbackStore,
  deidentify,
  feedbackSubmissionSchema,
  resolveReferences,
  todayBucket,
} from './feedback.js';
import { GameEngine, GameRuleError } from './game-engine.js';
import { DeepSeekClient, ModelError, type GameModel } from './model.js';
import { MemoryTraceSink } from './obs/tracer.js';
import { TracedModel } from './obs/traced-model.js';
import { FaultSwitch, registerOpsRoutes } from './ops.js';
import { createPublicGuard, guardOptionsFromEnv } from './public-guard.js';
import {
  STREAM_VERSION,
  formatEnd,
  formatEnvelope,
  formatPreview,
  parseLastEventId,
  type StreamEnvelope,
} from './stream.js';

const descriptionInput = z.object({ text: z.string() });
const voteInput = z.object({ targetId: z.string().min(1) });

export function createApp(model: GameModel = new DeepSeekClient()) {
  const app = express();
  // 可观测层(OpenSpec 04 · §3):一把共享脱敏 trace 汇。
  //   模型边界(传输重试 + 9 类故障分类)由 TracedModel 打点;
  //   决策纠偏(质量拒稿,含 hash/length 指纹)+ hook 边界由引擎打点。
  // 二者同汇 → 统一世系;生产取有限环形上限,避免长跑无界增长。trace 只在服务端,绝不进 DTO。
  const traceSink = new MemoryTraceSink(2000);
  // 观测台(题面任务线③前端呈现 · 附加端点):故障开关只在**非生产**装进模型链——
  // 生产链是 TracedModel 直包真实模型,结构上无故障面(生产禁用第 2 重闸,详见 ops.ts)。
  const devOps = process.env.NODE_ENV !== 'production';
  const faultSwitch = devOps ? new FaultSwitch(model) : null;
  const tracedModel = new TracedModel(faultSwitch ?? model, {
    sink: traceSink,
    now: () => performance.now(),
  });
  const engine = new GameEngine(tracedModel, undefined, {
    sink: traceSink,
    now: () => performance.now(),
  });
  // 知情、去标识的产品反馈存储(OpenSpec 05-H · 任务 5.5)。进程内、只出聚合、不出逐条。
  const feedback = new FeedbackStore();
  app.use(express.json({ limit: '16kb' }));

  // 公网守卫(部署加固):仅 PUBLIC_MODE=1 挂载——每 IP 命令限频 + 每 IP/全局建局限额,
  // 封顶模型成本与内存增长;不设 PUBLIC_MODE 时零行为差异(契约/本地路径逐字节不变)。
  if (process.env.PUBLIC_MODE === '1') {
    app.set('trust proxy', true); // Vercel rewrites → 后端的 XFF 链路取真实来源 IP
    app.use(createPublicGuard(guardOptionsFromEnv(process.env)));
  }

  app.get('/api/health', (_request, response) => {
    response.json({
      ok: true,
      model: model.model,
      configured: model.isConfigured(),
    });
  });

  app.post('/api/games', (_request, response) => {
    response.status(201).json(engine.createGame());
  });

  app.get('/api/games/:id', (request, response, next) => {
    try {
      response.json(engine.getGame(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  // 只读回放(OpenSpec 04 · §5.1):从有序公开事件重建时间线,经完整性四关校验。
  // 只吐公开动作(描述/票型/出局/高光锚点),不含 role/word;dataset 导出含终局标签,故不设 HTTP 出口。
  app.get('/api/games/:id/replay', (request, response, next) => {
    try {
      response.json(engine.reconstructReplay(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  // —— 高光时刻(OpenSpec 05-H · 任务 5.2/5.3/5.4)——
  // 附加端点、不改冻结契约:确定性检测的一束多样时刻,每张卡片援引公开事件 id。
  // 终局门禁:未终局返回 { available:false, cards:[] };默认剧透安全(结构上无 role/word);
  // 仅 ?spoilers=1 且已终局时才附 spoiler 层(身份/密词/结构化信念增量)。
  app.get('/api/games/:id/highlights', (request, response, next) => {
    try {
      const revealSpoilers = request.query.spoilers === '1' || request.query.spoilers === 'true';
      response.json(engine.getHighlights(request.params.id, revealSpoilers));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/games/:id/describe', async (request, response, next) => {
    try {
      const input = descriptionInput.parse(request.body);
      response.json(await engine.submitHumanDescription(request.params.id, input.text));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/games/:id/vote', async (request, response, next) => {
    try {
      const input = voteInput.parse(request.body);
      response.json(await engine.submitHumanVote(request.params.id, input.targetId));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/games/:id/continue', async (request, response, next) => {
    try {
      response.json(await engine.continueAsSpectator(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  // —— 只读公开事件流(OpenSpec 05-H · 决策 3 · 任务 4.1)——
  // 附加端点、**不改冻结契约**:SSE 版本化信封 + 单调 seq + Last-Event-ID 重连补发。
  // HTTP 命令仍是唯一权威写入口;本通道只做有序公开呈现。仅承载公开 GameEvent
  // (无 role/word/belief/私有 prompt/未公开票);断线对账以 `GET /api/games/:id` 为权威。
  app.get('/api/games/:id/stream', (request, response, next) => {
    try {
      const id = request.params.id;
      const state = engine.getGame(id); // 不存在 → 404(经错误中间件)
      const afterSeq = parseLastEventId(
        request.header('last-event-id') ??
          (typeof request.query.lastEventId === 'string' ? request.query.lastEventId : null),
      );

      response.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no', // 关反代缓冲,确保逐帧下发
      });
      response.flushHeaders?.();
      response.write('retry: 3000\n\n'); // 指示浏览器 EventSource 的重连退避

      let lastSent = afterSeq;
      const send = (envelopes: StreamEnvelope[]): void => {
        for (const envelope of envelopes) {
          if (envelope.seq <= lastSent) continue; // 幂等去重(重连补发/实时广播可能重叠)
          response.write(formatEnvelope(envelope));
          lastSent = envelope.seq;
        }
      };

      // 先追平已知历史,再订阅未来广播 —— 单线程同 tick 完成,命令回调不会插入其间;
      // `lastSent` 闸再兜一层幂等,杜绝重叠重发。
      send(engine.catchUpEnvelopes(id, afterSeq));

      // 已终局:补发完毕即收束(有界响应,天然适配重连/回放对接)。winner 终局才公开。
      if (state.phase === 'finished') {
        response.write(formatEnd({ v: STREAM_VERSION, gameId: id, phase: 'finished', winner: state.winner }));
        response.end();
        return;
      }

      const off = engine.onGameEvents(id, send);
      // 生成途中的瞬态预告帧(异步发言感):无 id 行 → 不参与 Last-Event-ID 补发;权威对账不受影响。
      const offPreview = engine.onPreviews(id, (frame) => response.write(formatPreview(frame)));
      const heartbeat = setInterval(() => response.write(': hb\n\n'), 15000);
      heartbeat.unref?.();
      request.on('close', () => {
        clearInterval(heartbeat);
        off();
        offPreview();
      });
    } catch (error) {
      next(error);
    }
  });

  // —— 上帝模式(附加端点,不在冻结契约内)——
  // 一桌全 AI 旁观对局,一次性解算到终局并回传含内心 OS 的上帝投影。
  // 独立 DTO(GodGameState),与 /api/games 的信息隔离不变量互不影响。
  app.post('/api/god-games', async (_request, response, next) => {
    try {
      response.status(201).json(await engine.createGodGame());
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/god-games/:id', (request, response, next) => {
    try {
      response.json(engine.getGodGame(request.params.id));
    } catch (error) {
      next(error);
    }
  });

  // —— 知情、去标识的产品反馈(OpenSpec 05-H · 任务 5.5)——
  // 附加端点、不改冻结契约。知情闸:consent 必须字面量 true(schema 即闸,未同意→400,零落库)。
  // 去标识:gameId 仅用于把「最爱 Agent/瞬间」校验到真实对局后即弃;落库只留天桶 + 枚举 + 稳定原型。
  // 完整退出路径在前端(选择「不用了」则一字节都不发送);后端亦拒绝任何未同意提交。
  app.post('/api/feedback', (request, response, next) => {
    try {
      const submission = feedbackSubmissionSchema.parse(request.body);
      const game = engine.getGame(submission.gameId); // 不存在 → 404
      const agentIds = game.players.filter((player) => !player.isHuman).map((player) => player.id);
      const moments = engine
        .getHighlights(submission.gameId, false)
        .cards.map((card) => ({ id: card.id, type: card.type }));
      const resolved = resolveReferences(submission, { agentIds, moments });
      feedback.record(deidentify(submission, resolved, todayBucket()));
      response.status(201).json({ recorded: true });
    } catch (error) {
      next(error);
    }
  });

  // 去标识聚合快照(供 playtest 复盘 · 任务 6.3):只出计数,个体记录永不出存储。
  app.get('/api/feedback/summary', (_request, response) => {
    response.json(feedback.summary());
  });

  // —— 观测台端点(仅开发环境挂载;生产 /api/ops/* 一律 404 —— 生产禁用第 1 重闸)——
  if (devOps && faultSwitch) {
    registerOpsRoutes(app, { sink: traceSink, faults: faultSwitch });
  }

  if (process.env.NODE_ENV === 'production') {
    const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
    const distDirectory = path.resolve(currentDirectory, '../../web/dist');
    app.use(express.static(distDirectory));
    app.use((request, response, next) => {
      if (request.method === 'GET' && !request.path.startsWith('/api/')) {
        response.sendFile(path.join(distDirectory, 'index.html'));
        return;
      }
      next();
    });
  }

  app.use(
    (
      error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError) {
        response.status(400).json({ error: '请求格式不正确', details: error.flatten() });
        return;
      }
      if (error instanceof GameRuleError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof FeedbackError) {
        response.status(error.status).json({ error: error.message });
        return;
      }
      if (error instanceof ModelError) {
        response.status(502).json({ error: error.message });
        return;
      }
      console.error(error);
      response.status(500).json({ error: '服务暂时出错，请稍后重试' });
    },
  );

  return { app, engine, traceSink, faultSwitch };
}
