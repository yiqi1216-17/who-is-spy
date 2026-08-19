import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { GameEngine, GameRuleError } from './game-engine.js';
import { DeepSeekClient, ModelError, type GameModel } from './model.js';
import { MemoryTraceSink } from './obs/tracer.js';
import { TracedModel } from './obs/traced-model.js';
import {
  STREAM_VERSION,
  formatEnd,
  formatEnvelope,
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
  const tracedModel = new TracedModel(model, { sink: traceSink, now: () => performance.now() });
  const engine = new GameEngine(tracedModel, undefined, {
    sink: traceSink,
    now: () => performance.now(),
  });
  app.use(express.json({ limit: '16kb' }));

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
      const heartbeat = setInterval(() => response.write(': hb\n\n'), 15000);
      heartbeat.unref?.();
      request.on('close', () => {
        clearInterval(heartbeat);
        off();
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
      if (error instanceof ModelError) {
        response.status(502).json({ error: error.message });
        return;
      }
      console.error(error);
      response.status(500).json({ error: '服务暂时出错，请稍后重试' });
    },
  );

  return { app, engine, traceSink };
}
