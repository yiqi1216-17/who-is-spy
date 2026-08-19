import { describe, expect, it } from 'vitest';
import { deterministicSafeHuman, mulberry32 } from '../eval/self-play.js';
import { GameEngine } from '../game-engine.js';
import { safeDigest, scanSecrets } from '../redaction.js';
import { type TraceEvent, envelope, parseVersioned } from '../schema.js';
import { FakeGameModel } from '../test-utils.js';
import type { AgentContext } from '../types.js';
import { WORD_PAIRS } from '../words.js';
import { MemoryTraceSink, scanTraceArtifacts } from './tracer.js';

/** 每次描述都吐出自己的秘密词(×3 保证长度)→ 必触发 exact_leak,质量门恒拒、重试耗尽。 */
class LeakySecretModel extends FakeGameModel {
  override describe(context: AgentContext): Promise<string> {
    return Promise.resolve(context.identity.word.repeat(3));
  }
}

describe('引擎级可观测缝 · 决策纠偏世系(§3.1/§3.2/§3.3)', () => {
  it('被拒候选只落 hash/length/短码,原文(即便是密词本身)绝不入 trace', async () => {
    const sink = new MemoryTraceSink();
    const engine = new GameEngine(new LeakySecretModel(), mulberry32(1), { sink });
    const created = engine.createGame();

    // 首个 AI 描述恒泄题 → 质量门 3 次尽拒 → QualityExhaustedError → 人类命令原子回滚。
    const safe = deterministicSafeHuman.describe(created, created.round);
    await expect(engine.submitHumanDescription(created.id, safe)).rejects.toThrow();

    const ev = sink.byBoundary('model.describe');
    expect(ev).toHaveLength(3); // MAX_DESCRIBE_ATTEMPTS
    for (const e of ev) {
      expect(e.data.outcome).toBe('rejected');
      expect(e.data.policyCode).toBe('exact_leak');
      expect(e.data.candidateHash).toMatch(/^[0-9a-f]{8}$/);
      expect(e.data.candidateLength).toBeGreaterThan(0);
    }
    // 同一 Agent 同一轮 → 同一 correlationId 贯穿三次纠偏尝试。
    expect(new Set(ev.map((e) => e.data.correlationId)).size).toBe(1);
    expect(ev.map((e) => e.data.attempt)).toEqual([1, 2, 3]);

    // 杀手级隐私证明:被拒候选**就是密词本身**,但 trace 工件里扫不出任何机密字面量。
    expect(scanTraceArtifacts(sink.events())).toEqual([]);
  });

  it('健康路径:每个 AI 描述一条 accepted;hook 边界各一条 accepted;工件干净', async () => {
    const sink = new MemoryTraceSink();
    const engine = new GameEngine(new FakeGameModel(), mulberry32(1), { sink });
    engine.registerRoundHook('scoreboard', () => {
      /* 只读观察者:什么都不做即 ok */
    });
    const created = engine.createGame();

    const safe = deterministicSafeHuman.describe(created, created.round);
    await engine.submitHumanDescription(created.id, safe);

    const describes = sink.byBoundary('model.describe');
    expect(describes.filter((e) => e.data.outcome === 'accepted')).toHaveLength(4); // 4 个 AI
    expect(describes.filter((e) => e.data.outcome === 'rejected')).toHaveLength(0);
    for (const e of describes) {
      expect(e.data.policyCode).toBeUndefined();
      expect(e.data.candidateHash).toBeUndefined(); // accepted 不留指纹
    }

    const hooks = sink.byBoundary('hook');
    expect(hooks).toHaveLength(1);
    expect(hooks[0].data.outcome).toBe('accepted');
    expect(hooks[0].data.policyCode).toBeUndefined();

    expect(scanTraceArtifacts(sink.events())).toEqual([]);
  });

  it('不注入 obs 时零发射:同一局跑完 sink 恒空(向后兼容,行为不变)', async () => {
    const sink = new MemoryTraceSink();
    const engine = new GameEngine(new FakeGameModel(), mulberry32(1)); // 不传 obs
    const created = engine.createGame();
    const safe = deterministicSafeHuman.describe(created, created.round);
    await engine.submitHumanDescription(created.id, safe);
    expect(sink.events()).toHaveLength(0);
  });
});

describe('safeDigest · 不可逆指纹(§3.3 的隐私原语)', () => {
  it('8 位十六进制 + 确定性', () => {
    expect(safeDigest('苹果苹果').hash).toMatch(/^[0-9a-f]{8}$/);
    expect(safeDigest('abc').hash).toBe(safeDigest('abc').hash);
    expect(safeDigest('a').hash).not.toBe(safeDigest('b').hash);
    expect(safeDigest('').length).toBe(0);
    expect(safeDigest('苹果').length).toBe(2); // 码点计数
  });

  it('对密词取指纹后,序列化里扫不出该密词', () => {
    const secret = WORD_PAIRS[0][0];
    expect(scanSecrets(secret)).toContain(secret); // 尺子确实认得这个密词
    expect(scanSecrets(JSON.stringify(safeDigest(secret)))).toEqual([]); // 指纹把它藏住了
  });
});

describe('traceEvent · 指纹字段版本化往返(§3.3)', () => {
  const base: TraceEvent = {
    correlationId: 'eng-1',
    round: 1,
    boundary: 'model.describe',
    playerId: 'ai-1',
    attempt: 1,
    outcome: 'rejected',
    policyCode: 'exact_leak',
    candidateHash: 'deadbeef',
    candidateLength: 6,
  };

  it('合法 hash/length 通过 strict 校验', () => {
    expect(() => parseVersioned('traceEvent', envelope('traceEvent', base))).not.toThrow();
  });

  it('非 8-hex 的 candidateHash 被拒(结构上堵死自由文本旁路)', () => {
    const bad = { ...base, candidateHash: '泄露的原文' };
    expect(() => parseVersioned('traceEvent', envelope('traceEvent', bad as never))).toThrow();
  });
});
