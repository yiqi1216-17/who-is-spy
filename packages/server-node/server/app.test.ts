import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { deterministicSafeHuman } from './eval/self-play.js';
import { scanSecrets } from './redaction.js';
import { FakeGameModel } from './test-utils.js';

describe('HTTP API', () => {
  it('reports model readiness and keeps AI secrets server-side before the finale', async () => {
    const { app } = createApp(new FakeGameModel());

    const health = await request(app).get('/api/health').expect(200);
    expect(health.body).toMatchObject({
      ok: true,
      configured: true,
      model: 'deepseek-v4-flash-test-double',
    });

    const created = await request(app).post('/api/games').expect(201);
    expect(created.body.players).toHaveLength(5);
    expect(created.body.human.word).toBeTypeOf('string');
    for (const player of created.body.players) {
      expect(player).not.toHaveProperty('role');
      expect(player).not.toHaveProperty('word');
      expect(player).not.toHaveProperty('revealedRole');
      expect(player).not.toHaveProperty('revealedWord');
    }
  });

  it('validates malformed actions with a useful client error', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);

    const response = await request(app)
      .post(`/api/games/${created.body.id}/vote`)
      .send({ targetId: '' })
      .expect(400);

    expect(response.body.error).toBe('请求格式不正确');
  });

  it('exposes a read-only replay timeline that reconstructs public actions without leaking secrets', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    // 走一轮:提交人类描述 → 触发四个 AI 描述 → 事件流落一整轮公开动作。
    await request(app)
      .post(`/api/games/${created.body.id}/describe`)
      .send({ text: deterministicSafeHuman.describe(created.body, 1) })
      .expect(200);

    const replay = await request(app).get(`/api/games/${created.body.id}/replay`).expect(200);
    // 重建出第一轮五条公开描述(人类 + 四 AI)。
    expect(replay.body.gameId).toBe(created.body.id);
    expect(replay.body.rounds[0].descriptions).toHaveLength(5);
    // 只读回放是公开安全的:不含 role/word/revealed*,且扫不出任何密词。
    const serialized = JSON.stringify(replay.body);
    expect(serialized).not.toContain('"role"');
    expect(serialized).not.toContain('"word"');
    expect(serialized).not.toContain('revealed');
    expect(scanSecrets(serialized)).toEqual([]);

    // 未知对局 → 404(复用引擎的 requireGame 语义)。
    await request(app).get('/api/games/does-not-exist/replay').expect(404);
  });

  it('can initialize the production static fallback on Express 5', async () => {
    const previousEnvironment = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { app } = createApp(new FakeGameModel());
      await request(app).get('/api/health').expect(200);
    } finally {
      process.env.NODE_ENV = previousEnvironment;
    }
  });
});
