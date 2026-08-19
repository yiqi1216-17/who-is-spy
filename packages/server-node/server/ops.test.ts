import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { deterministicSafeHuman } from './eval/self-play.js';
import { FaultSwitch } from './ops.js';
import { FakeGameModel } from './test-utils.js';
import type { PublicGameState } from './types.js';

/**
 * 观测台端点 · 端到端(题面任务线③的前端呈现层 · 后端侧)
 * 钉死:trace 的「哪一局」维度、故障开关的注入→重试恢复/恒失败→原子回滚(HTTP 侧 CH-4)、
 * 评测端点的记分卡与门禁,以及生产环境的三重禁用闸。
 */

async function createGame(app: ReturnType<typeof createApp>['app']): Promise<PublicGameState> {
  return (await request(app).post('/api/games').expect(201)).body as PublicGameState;
}

describe('观测台 · trace 只读快照(哪一局维度)', () => {
  it('一次描述命令后,trace 可按 gameId 过滤,且传输与纠偏世系同局归属', async () => {
    const { app } = createApp(new FakeGameModel());
    const game = await createGame(app);
    await request(app)
      .post(`/api/games/${game.id}/describe`)
      .send({ text: deterministicSafeHuman.describe(game, game.round) })
      .expect(200);

    const res = await request(app).get(`/api/ops/trace?gameId=${game.id}`).expect(200);
    expect(res.body.scanClean).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);
    const events = res.body.events as Array<{ data: Record<string, unknown> }>;
    // 每一条都归属本局(哪一局),且携带 轮/AI/尝试/结局 其余四维。
    for (const event of events) {
      expect(event.data.gameId).toBe(game.id);
      expect(event.data.round).toBe(1);
      expect(event.data.attempt).toBeGreaterThanOrEqual(1);
      expect(['accepted', 'rejected', 'error']).toContain(event.data.outcome);
    }
    // 传输世系(TracedModel)与决策纠偏世系(引擎)都在同一把汇里且都归属本局。
    expect(events.some((e) => e.data.boundary === 'model.describe')).toBe(true);

    // boundary 过滤:投票边界此刻应为空。
    const votes = await request(app)
      .get(`/api/ops/trace?gameId=${game.id}&boundary=model.vote`)
      .expect(200);
    expect(votes.body.total).toBe(0);
  });
});

describe('观测台 · 故障注入开关(注入→世系→恢复/回滚)', () => {
  it('瞬时 upstream(times=1):对局照常完成,trace 留下 error→accepted 重试世系', async () => {
    const { app } = createApp(new FakeGameModel());
    const game = await createGame(app);

    await request(app)
      .post('/api/ops/faults')
      .send({ boundary: 'describe', failClass: 'upstream', times: 1 })
      .expect(201);

    await request(app)
      .post(`/api/games/${game.id}/describe`)
      .send({ text: deterministicSafeHuman.describe(game, game.round) })
      .expect(200); // 有界重试把瞬时故障扛了下来,对局不受影响

    const status = (await request(app).get('/api/ops/faults').expect(200)).body;
    expect(status).toMatchObject({ armed: true, injected: 1, remaining: 0 });

    const res = await request(app)
      .get(`/api/ops/trace?gameId=${game.id}&boundary=model.describe`)
      .expect(200);
    const rows = (res.body.events as Array<{ data: Record<string, unknown> }>).map((e) => e.data);
    const failed = rows.filter((r) => r.outcome === 'error');
    expect(failed.length).toBe(1);
    expect(failed[0].policyCode).toBe('upstream');
    // 同一 correlationId 的世系:attempt 1 失败 → attempt 2 成功。
    const lineage = rows.filter((r) => r.correlationId === failed[0].correlationId);
    expect(lineage.map((r) => [r.attempt, r.outcome])).toEqual([
      [1, 'error'],
      [2, 'accepted'],
    ]);

    await request(app).delete('/api/ops/faults').expect(200);
    expect((await request(app).get('/api/ops/faults').expect(200)).body.armed).toBe(false);
  });

  it('恒失败 auth_config:不可重试快速失败,权威状态原样回滚(HTTP 侧 CH-4);解除后恢复', async () => {
    const { app } = createApp(new FakeGameModel());
    const game = await createGame(app);
    const before = (await request(app).get(`/api/games/${game.id}`).expect(200))
      .body as PublicGameState;

    await request(app)
      .post('/api/ops/faults')
      .send({ boundary: 'describe', failClass: 'auth_config' }) // 缺省 times = 恒失败
      .expect(201);

    await request(app)
      .post(`/api/games/${game.id}/describe`)
      .send({ text: deterministicSafeHuman.describe(game, game.round) })
      .expect(500); // 明确中止,而不是留下做了一半的状态

    const after = (await request(app).get(`/api/games/${game.id}`).expect(200))
      .body as PublicGameState;
    expect(after.descriptions).toEqual(before.descriptions); // 人类描述也随草稿一并丢弃
    expect(after.events.length).toBe(before.events.length);
    expect(after.phase).toBe(before.phase);

    // trace 里能精确看到:本局、第 1 轮、model.describe 边界、attempt 1、auth_config,且无成功条目。
    const res = await request(app)
      .get(`/api/ops/trace?gameId=${game.id}&outcome=error`)
      .expect(200);
    const rows = (res.body.events as Array<{ data: Record<string, unknown> }>).map((e) => e.data);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.policyCode === 'auth_config' && r.attempt === 1)).toBe(true);

    // 解除故障后同一局照常推进(优雅降级收尾)。
    await request(app).delete('/api/ops/faults').expect(200);
    const recovered = (
      await request(app)
        .post(`/api/games/${game.id}/describe`)
        .send({ text: deterministicSafeHuman.describe(game, game.round) })
        .expect(200)
    ).body as PublicGameState;
    expect(recovered.descriptions.length).toBe(5); // 人类 + 4 AI
  });
});

describe('观测台 · 进程内评测端点', () => {
  it('确定性自博弈批:同 seed 记分卡可复现,门禁应绿', async () => {
    const { app } = createApp(new FakeGameModel());
    const run = async () =>
      (await request(app).post('/api/ops/eval').send({ games: 2, seed: 7 }).expect(200)).body;
    const first = await run();
    expect(first.report.data.sampleSize).toBe(2);
    expect(first.report.data.metrics.length).toBeGreaterThan(0);
    expect(first.gate.passed).toBe(true);
    // 复现性:同 seed 同批,报告逐字节相等(评测跑在独立引擎上,不触碰线上对局)。
    const second = await run();
    expect(JSON.stringify(second.report)).toBe(JSON.stringify(first.report));
  });

  it('demoFail 泄题演示:门禁变红并给出可执行失败项', async () => {
    const { app } = createApp(new FakeGameModel());
    const res = await request(app)
      .post('/api/ops/eval')
      .send({ games: 1, seed: 1, demoFail: true })
      .expect(200);
    expect(res.body.gate.passed).toBe(false);
    expect(res.body.gate.failures.length).toBeGreaterThan(0);
  });
});

describe('观测台 · 生产禁用三重闸', () => {
  it('NODE_ENV=production:路由不挂载(404)、链上无开关(null)、arm 即抛', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { app, faultSwitch } = createApp(new FakeGameModel());
      expect(faultSwitch).toBeNull(); // 第 2 重:生产模型链根本不装故障面
      await request(app).get('/api/ops/trace').expect(404); // 第 1 重:路由不挂载
      await request(app)
        .post('/api/ops/faults')
        .send({ boundary: 'describe', failClass: 'upstream' })
        .expect(404);
      // 第 3 重:即便拿到实例,arm 也自校环境拒绝。
      expect(() => new FaultSwitch(new FakeGameModel()).arm({ boundary: 'describe', failClass: 'upstream' })).toThrow(
        /生产环境禁止/,
      );
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
