import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { GameEngine, GameRuleError } from './game-engine.js';
import { DeepSeekClient, ModelError, type GameModel } from './model.js';
import { MemoryTraceSink } from './obs/tracer.js';
import { TracedModel } from './obs/traced-model.js';

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
