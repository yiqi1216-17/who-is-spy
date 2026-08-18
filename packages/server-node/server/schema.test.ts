import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  SchemaVersionError,
  envelope,
  parseVersioned,
  type SchemaKind,
} from './schema.js';

/**
 * A1 · 版本化 schema 底座(OpenSpec 03 · Task 2.1)
 *
 * 生产者/消费者兼容性:每个跨边界工件都带 { v, kind, data } 信封。
 * 消费者只接受与自己期望主版本一致的信封;版本/种类不符 → 可执行的 SchemaVersionError。
 * strict schema 让"私有字段(词/prompt/信念自由文本)"无法混进 trace / hook 投影。
 */

/** 每个 kind 一个合法样本,用于 round-trip 与兼容性断言。 */
const VALID: Record<SchemaKind, unknown> = {
  publicState: {
    id: 'g1',
    phase: 'describing',
    round: 1,
    ballot: 1,
    players: [{ id: 'human', name: '你', avatar: '你', isHuman: true, alive: true }],
    descriptions: [{ playerId: 'human', text: '一句描述', round: 1 }],
    votes: [],
    events: [{ id: 'e1', type: 'system', text: '开局', round: 1 }],
    eligibleTargetIds: null,
    winner: null,
    review: null,
    human: { playerId: 'human', role: 'civilian', word: '苹果' },
    model: 'fake',
  },
  event: { id: 'e1', type: 'description', text: '一句描述', round: 1, playerId: 'human' },
  agentContext: {
    identity: { playerId: 'ai-1', name: '阿序', role: 'civilian', word: '苹果' },
    game: {
      round: 1,
      alivePlayers: [{ id: 'ai-1', name: '阿序' }],
      publicDescriptions: [{ playerId: 'human', playerName: '你', text: '一句描述', round: 1 }],
      publicEliminations: [],
    },
  },
  belief: {
    round: 2,
    suspicions: [{ playerId: 'ai-2', score: 0.7 }],
    selfExposure: 0.2,
    evidenceRefs: [{ playerId: 'ai-2', round: 1 }],
  },
  strategy: {
    id: 'cautious-observer',
    version: 1,
    role: 'any',
    persona: '谨慎观察',
    tactics: ['先给上位概念', '回避独有细节'],
    specificity: 0.4,
    novelty: 0.6,
    risk: 0.3,
    provenance: { kind: 'synthetic' },
  },
  modelDescribeOutput: { description: '让我想到日常场景', private_reasoning_summary: '含蓄' },
  modelVoteOutput: { targetId: 'ai-2', reason: '措辞太笼统' },
  modelReviewOutput: {
    headline: '平民锁定偏差',
    summary: '本局四轮,终局票型决定阵营胜负,描述细节暴露了卧底。',
    turningPoints: ['第二轮出现措辞分歧'],
    playerInsights: [{ playerId: 'ai-1', insight: '始终给上位概念' }],
  },
  datasetRecord: {
    gameId: 'src-001',
    provenance: 'transfer',
    players: [{ pseudoId: 'p1', role: 'civilian' }],
    actions: [{ round: 1, playerId: 'p1', kind: 'describe', text: '一句描述' }],
    license: 'CC-BY-4.0',
  },
  hookPayload: {
    hook: 'onRoundPublished',
    round: 1,
    public: {
      descriptions: [{ playerId: 'human', text: '一句描述', round: 1 }],
      eliminations: [],
    },
  },
  traceEvent: {
    correlationId: 'g1:r1:ai-1',
    round: 1,
    boundary: 'model.describe',
    playerId: 'ai-1',
    attempt: 1,
    outcome: 'accepted',
  },
  report: {
    suite: 'orchestration',
    milestone: 'B1',
    sampleSize: 20,
    metrics: [{ key: 'leakageRate', value: 0, n: 20 }],
  },
};

const KINDS = Object.keys(VALID) as SchemaKind[];

/** 弱类型信封构造器:测试需要故意塞入非法/残缺 data,绕过 envelope() 的强类型守卫。 */
const wrap = (kind: SchemaKind, data: unknown) => ({ v: SCHEMA_VERSION, kind, data });

describe('A1 · 版本化信封与兼容性', () => {
  it('每个 kind 都能 wrap → parseVersioned round-trip', () => {
    for (const kind of KINDS) {
      const wrapped = wrap(kind, VALID[kind]);
      expect(wrapped.v).toBe(SCHEMA_VERSION);
      expect(wrapped.kind).toBe(kind);
      const back = parseVersioned(kind, wrapped);
      expect(back).toEqual(VALID[kind]);
    }
  });

  it('envelope() 用当前主版本与正确 kind 打上信封(强类型入口)', () => {
    const wrapped = envelope('strategy', VALID.strategy as never);
    expect(wrapped).toEqual({ v: SCHEMA_VERSION, kind: 'strategy', data: VALID.strategy });
    expect(parseVersioned('strategy', wrapped)).toEqual(VALID.strategy);
  });

  it('版本不匹配 → SchemaVersionError,消息含 kind 与期望版本', () => {
    const stale = { v: SCHEMA_VERSION - 1, kind: 'strategy', data: VALID.strategy };
    expect(() => parseVersioned('strategy', stale)).toThrow(SchemaVersionError);
    try {
      parseVersioned('strategy', stale);
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('strategy');
      expect(message).toContain(String(SCHEMA_VERSION));
    }
  });

  it('kind 不匹配 → SchemaVersionError', () => {
    const wrapped = wrap('belief', VALID.belief);
    expect(() => parseVersioned('strategy', wrapped)).toThrow(SchemaVersionError);
  });

  it('缺少 v / kind 字段 → SchemaVersionError(而非静默通过)', () => {
    expect(() => parseVersioned('strategy', { data: VALID.strategy })).toThrow(SchemaVersionError);
    expect(() => parseVersioned('strategy', { v: SCHEMA_VERSION, data: VALID.strategy })).toThrow(
      SchemaVersionError,
    );
    expect(() => parseVersioned('strategy', null)).toThrow(SchemaVersionError);
  });
});

describe('A1 · 各域 schema 校验非法数据', () => {
  it('strategy 的连续量越界被拒', () => {
    const bad = { ...(VALID.strategy as object), specificity: 1.5 };
    expect(() => parseVersioned('strategy', wrap('strategy', bad))).toThrow();
  });

  it('belief 怀疑度越界被拒', () => {
    const bad = { ...(VALID.belief as object), suspicions: [{ playerId: 'ai-2', score: 2 }] };
    expect(() => parseVersioned('belief', wrap('belief', bad))).toThrow();
  });

  it('datasetRecord 的 provenance 只能是 human/transfer/synthetic', () => {
    const bad = { ...(VALID.datasetRecord as object), provenance: 'unknown' };
    expect(() => parseVersioned('datasetRecord', wrap('datasetRecord', bad))).toThrow();
  });
});

describe('A1 · 隐私不变量:strict schema 拒绝私有字段混入投影', () => {
  it('traceEvent 拒绝夹带 word/prompt/belief 等未知字段', () => {
    for (const leak of ['word', 'prompt', 'belief', 'apiKey']) {
      const tainted = { ...(VALID.traceEvent as object), [leak]: '苹果' };
      expect(() => parseVersioned('traceEvent', wrap('traceEvent', tainted))).toThrow();
    }
  });

  it('hookPayload 拒绝夹带完整 game / 身份等未知字段', () => {
    const tainted = { ...(VALID.hookPayload as object), game: { players: [] } };
    expect(() => parseVersioned('hookPayload', wrap('hookPayload', tainted))).toThrow();
  });

  it('belief 不接受自由文本推理字段(无 CoT 落盘)', () => {
    const tainted = { ...(VALID.belief as object), reasoning: '我一步步推理…' };
    expect(() => parseVersioned('belief', wrap('belief', tainted))).toThrow();
  });
});
