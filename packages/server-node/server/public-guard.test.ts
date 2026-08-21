import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createPublicGuard } from './public-guard.js';
import { FakeGameModel } from './test-utils.js';
import express from 'express';

/**
 * 公网守卫(部署加固):三道闸各自可测、时钟注入确定性、不挂载零差异。
 */

function guardedApp(options: Parameters<typeof createPublicGuard>[0]) {
  const app = express();
  app.use(createPublicGuard(options));
  app.post('/api/games', (_req, res) => res.status(201).json({ ok: true }));
  app.post('/api/god-games', (_req, res) => res.status(201).json({ ok: true }));
  app.post('/api/games/x/describe', (_req, res) => res.json({ ok: true }));
  app.get('/api/games/x', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('公网守卫 · 三道闸', () => {
  it('每 IP 命令限频:窗口内超限 429+Retry-After,窗口滑过即恢复;GET 不受限', async () => {
    let at = 0;
    const app = guardedApp({ now: () => at, maxCommandsPerIpPerMinute: 3 });
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/games/x/describe').expect(200);
    }
    const blocked = await request(app).post('/api/games/x/describe').expect(429);
    expect(blocked.headers['retry-after']).toBe('30');
    expect(blocked.body.error).toContain('操作太快');
    // GET 只读端点(状态/SSE 对账)不限。
    await request(app).get('/api/games/x').expect(200);
    // 60s 窗口滑过 → 恢复。
    at = 60_001;
    await request(app).post('/api/games/x/describe').expect(200);
  });

  it('每 IP 建局限频:人类局与上帝局共享额度,1 小时窗口滑过恢复', async () => {
    let at = 0;
    const app = guardedApp({ now: () => at, maxGamesPerIpPerHour: 2, maxGamesPerDay: 100 });
    await request(app).post('/api/games').expect(201);
    await request(app).post('/api/god-games').expect(201); // 上帝局同池(它才是成本大头)
    const blocked = await request(app).post('/api/games').expect(429);
    expect(blocked.body.error).toContain('开局太频繁');
    at = 3_600_001;
    await request(app).post('/api/games').expect(201);
  });

  it('全局日额:不同 IP 合并计数,触顶后任何 IP 都 429', async () => {
    let at = 0;
    const app = guardedApp({ now: () => at, maxGamesPerIpPerHour: 99, maxGamesPerDay: 2 });
    await request(app).post('/api/games').set('X-Forwarded-For', '1.1.1.1').expect(201);
    await request(app).post('/api/games').set('X-Forwarded-For', '2.2.2.2').expect(201);
    const blocked = await request(app)
      .post('/api/games')
      .set('X-Forwarded-For', '3.3.3.3')
      .expect(429);
    expect(blocked.body.error).toContain('今日牌桌已满');
    // 24h 滑动窗口过期恢复。
    at = 24 * 3_600_000 + 1;
    await request(app).post('/api/games').set('X-Forwarded-For', '3.3.3.3').expect(201);
  });

  it('IP 隔离:一个 IP 触限不影响另一个 IP', async () => {
    const app = guardedApp({ now: () => 0, maxCommandsPerIpPerMinute: 1 });
    await request(app).post('/api/games/x/describe').set('X-Forwarded-For', '1.1.1.1').expect(200);
    await request(app).post('/api/games/x/describe').set('X-Forwarded-For', '1.1.1.1').expect(429);
    await request(app).post('/api/games/x/describe').set('X-Forwarded-For', '9.9.9.9').expect(200);
  });
});

describe('公网守卫 · 挂载开关', () => {
  afterEach(() => {
    delete process.env.PUBLIC_MODE;
  });

  it('PUBLIC_MODE=1:createApp 生效限频;未设:同样的请求序列畅通(零行为差异)', async () => {
    process.env.PUBLIC_MODE = '1';
    process.env.PUBLIC_MAX_GAMES_PER_IP_HOUR = '1';
    try {
      const { app } = createApp(new FakeGameModel());
      await request(app).post('/api/games').expect(201);
      await request(app).post('/api/games').expect(429);
    } finally {
      delete process.env.PUBLIC_MAX_GAMES_PER_IP_HOUR;
    }

    delete process.env.PUBLIC_MODE;
    const { app: openApp } = createApp(new FakeGameModel());
    await request(openApp).post('/api/games').expect(201);
    await request(openApp).post('/api/games').expect(201); // 不挂载 → 无限频
  });
});
