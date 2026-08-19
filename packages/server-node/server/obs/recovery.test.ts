import { describe, expect, it } from 'vitest';
import { deterministicSafeHuman, mulberry32 } from '../eval/self-play.js';
import { GameEngine } from '../game-engine.js';
import { FakeGameModel } from '../test-utils.js';
import type { AgentContext, VoteTarget } from '../types.js';
import { type FailureClass } from './failure-taxonomy.js';
import { FaultInjectingModel } from './fault-injection.js';
import { recordingClock } from './retry.js';
import { MemoryTraceSink } from './tracer.js';
import { TracedModel } from './traced-model.js';

function fakeContext(playerId = 'ai-1', round = 1): AgentContext {
  return {
    identity: { playerId, name: '测试', role: 'civilian', word: '密词占位' },
    strategy: { persona: '谨慎', tactics: ['含蓄'], specificity: 0.5, novelty: 0.5, risk: 0.5 },
    game: {
      round,
      alivePlayers: [{ id: playerId, name: '测试' }],
      publicDescriptions: [],
      publicEliminations: [],
    },
  };
}

describe('TracedModel · 边界 trace + 尝试世系', () => {
  it('成功路径:一条 accepted,带 correlationId / attempt / latency', async () => {
    const sink = new MemoryTraceSink();
    let clock = 0;
    const traced = new TracedModel(new FakeGameModel(), {
      sink,
      now: () => (clock += 5),
      newCorrelationId: () => 'corr-1',
    });
    const text = await traced.describe(fakeContext());
    expect(typeof text).toBe('string');
    const ev = sink.byBoundary('model.describe');
    expect(ev).toHaveLength(1);
    expect(ev[0].data).toMatchObject({
      correlationId: 'corr-1',
      boundary: 'model.describe',
      attempt: 1,
      outcome: 'accepted',
      playerId: 'ai-1',
    });
    expect(ev[0].data.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('瞬时故障后恢复:error@1(upstream) → accepted@2', async () => {
    const sink = new MemoryTraceSink();
    const faulty = new FaultInjectingModel(new FakeGameModel(), [
      { boundary: 'describe', failClass: 'upstream', times: 1 },
    ]);
    const traced = new TracedModel(faulty, {
      sink,
      clock: recordingClock(1),
      policy: { maxAttempts: 3, baseDelayMs: 10, maxDelayMs: 100 },
    });
    const text = await traced.describe(fakeContext());
    expect(typeof text).toBe('string');
    const ev = sink.byBoundary('model.describe');
    expect(ev.map((e) => e.data.outcome)).toEqual(['error', 'accepted']);
    expect(ev[0].data.policyCode).toBe('upstream');
    expect(ev.map((e) => e.data.attempt)).toEqual([1, 2]);
  });

  it('vote / review 边界各自打点(review 无 playerId)', async () => {
    const sink = new MemoryTraceSink();
    const traced = new TracedModel(new FakeGameModel(), { sink });
    const allowed: VoteTarget[] = [{ id: 'ai-2', name: '甲', isHuman: false, alive: true }];
    await traced.vote(fakeContext(), allowed);
    const engine = new GameEngine(new FakeGameModel(), mulberry32(1));
    const created = engine.createGame();
    await traced.review(engine.getInternalGame(created.id));
    expect(sink.byBoundary('model.vote')).toHaveLength(1);
    expect(sink.byBoundary('model.review')).toHaveLength(1);
    expect(sink.byBoundary('model.review')[0].data.playerId).toBeUndefined();
  });
});

describe('§4.4 每类故障 × 描述边界:trace 分类正确', () => {
  const EXPECT: Record<FailureClass, { code: string; outcome: string; retryable: boolean }> = {
    timeout: { code: 'timeout', outcome: 'error', retryable: true },
    rate_limit: { code: 'rate_limit', outcome: 'error', retryable: true },
    upstream: { code: 'upstream', outcome: 'error', retryable: true },
    malformed_json: { code: 'malformed_json', outcome: 'error', retryable: true },
    schema: { code: 'schema', outcome: 'rejected', retryable: true },
    illegal_target: { code: 'illegal_target', outcome: 'rejected', retryable: true },
    policy: { code: 'exact_leak', outcome: 'rejected', retryable: false },
    auth_config: { code: 'auth_config', outcome: 'error', retryable: false },
    unknown: { code: 'unknown', outcome: 'error', retryable: true },
  };

  it.each(Object.keys(EXPECT) as FailureClass[])('注入 %s → trace 末条分类正确', async (cls) => {
    const sink = new MemoryTraceSink();
    const faulty = new FaultInjectingModel(new FakeGameModel(), [{ boundary: 'describe', failClass: cls }]);
    const traced = new TracedModel(faulty, {
      sink,
      clock: recordingClock(0),
      policy: { maxAttempts: 2, baseDelayMs: 1, maxDelayMs: 10 },
    });
    await expect(traced.describe(fakeContext())).rejects.toThrow();
    const ev = sink.byBoundary('model.describe');
    const last = ev[ev.length - 1];
    expect(last.data.policyCode).toBe(EXPECT[cls].code);
    expect(last.data.outcome).toBe(EXPECT[cls].outcome);
    // 可重试类打满 maxAttempts=2 条;不可重试类仅 1 条(快速失败)
    expect(ev).toHaveLength(EXPECT[cls].retryable ? 2 : 1);
  });
});

describe('§4.4 终局失败 → 权威状态前后相等(CH-4 优雅降级)', () => {
  it('AI 描述恒失败时 submitHumanDescription 拒绝,且内部状态逐字节不变', async () => {
    const sink = new MemoryTraceSink();
    const faulty = new FaultInjectingModel(new FakeGameModel(), [{ boundary: 'describe', failClass: 'auth_config' }]);
    const traced = new TracedModel(faulty, { sink, clock: recordingClock() });
    const engine = new GameEngine(traced, mulberry32(1));
    const created = engine.createGame();

    const before = JSON.stringify(structuredClone(engine.getInternalGame(created.id)));
    const safe = deterministicSafeHuman.describe(created, created.round);
    await expect(engine.submitHumanDescription(created.id, safe)).rejects.toThrow();
    const after = JSON.stringify(structuredClone(engine.getInternalGame(created.id)));

    expect(after).toBe(before);
    const ev = sink.byBoundary('model.describe');
    expect(ev[ev.length - 1].data.policyCode).toBe('auth_config');
  });
});

describe('§4.3 生产环境拒绝故障开关', () => {
  it('NODE_ENV=production 时构造 FaultInjectingModel 抛错', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(
        () => new FaultInjectingModel(new FakeGameModel(), [{ boundary: 'describe', failClass: 'timeout' }]),
      ).toThrow();
    } finally {
      process.env.NODE_ENV = prev;
    }
  });
});
