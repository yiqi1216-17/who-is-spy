import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  SchemaVersionError,
  parseVersioned,
} from './schema.js';
import { validateReplayLog } from './replay/replay.js';
import type { ReplayLog } from './replay/log.js';

/**
 * 迁移守卫 · 持久化工件版本 fixtures(OpenSpec 03 · §2.3 / 04 · §5.1 收口)
 *
 * spec:「不兼容的持久化 dataset / trace / replay 信封 / report 必须以**可执行的版本错误**失败」。
 * 这里用**当前主版本 + 1** 与**降级到 v0** 两种真实「未来/过期工件」fixture,逐类证明:
 *   - 消费入口 `parseVersioned` 抛 `SchemaVersionError`,消息含 kind 名与期望/实际版本(可执行:告诉运维要迁移谁);
 *   - 回放日志的完整性入口 `validateReplayLog` 把版本不符归为 `schema_version` 关并定位。
 * 覆盖四类下游工件:datasetRecord / traceEvent / event(replay 信封)/ report。
 */

const FUTURE = SCHEMA_VERSION + 1;
const PAST = 0;

/** 一份最小合法的各 kind data(只为通过 data 层 schema,版本层才是被测点)。 */
const SAMPLE = {
  datasetRecord: {
    gameId: 'g1',
    provenance: 'synthetic' as const,
    players: [{ pseudoId: 'p0', role: 'civilian' as const }],
    actions: [{ round: 1, playerId: 'p0', kind: 'describe' as const, text: '一句公开描述' }],
  },
  traceEvent: {
    correlationId: 'corr-1',
    round: 1,
    boundary: 'model.describe' as const,
    attempt: 1,
    outcome: 'accepted' as const,
  },
  report: {
    suite: 's',
    milestone: 'm',
    sampleSize: 1,
    metrics: [{ key: 'completion_rate', value: 1, n: 1 }],
  },
  event: { id: 'ev-1', type: 'description' as const, text: '公开事件', round: 1 },
};

const KINDS = ['datasetRecord', 'traceEvent', 'report', 'event'] as const;

describe('§2.3 迁移守卫 · 持久化工件版本不兼容即可执行失败', () => {
  it.each(KINDS)('%s:未来版本(v%i)工件被 parseVersioned 拒绝且消息可执行', (kind) => {
    const future = { v: FUTURE, kind, data: SAMPLE[kind] };
    try {
      parseVersioned(kind, future);
      throw new Error('应当抛 SchemaVersionError 却通过了');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionError);
      const msg = (err as Error).message;
      expect(msg).toContain(kind); // 指名道姓哪个工件
      expect(msg).toContain(`v${SCHEMA_VERSION}`); // 期望版本
      expect(msg).toContain(`v${FUTURE}`); // 实际版本
    }
  });

  it.each(KINDS)('%s:过期版本(v0)工件同样被拒', (kind) => {
    const past = { v: PAST, kind, data: SAMPLE[kind] };
    expect(() => parseVersioned(kind, past)).toThrow(SchemaVersionError);
  });

  it('kind 张冠李戴(report 冒充 datasetRecord)被识破', () => {
    const mislabeled = { v: SCHEMA_VERSION, kind: 'report', data: SAMPLE.report };
    try {
      parseVersioned('datasetRecord', mislabeled);
      throw new Error('应当抛错');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionError);
      expect((err as Error).message).toContain('datasetRecord');
    }
  });

  it('缺版本信封的裸工件被拒(而非静默消费)', () => {
    expect(() => parseVersioned('datasetRecord', SAMPLE.datasetRecord)).toThrow(SchemaVersionError);
  });
});

describe('§2.3 迁移守卫 · 回放日志版本不符归 schema_version 关', () => {
  it('未来版本的 replay 日志被 validateReplayLog 定位为 schema_version', () => {
    const log: ReplayLog = { v: FUTURE, gameId: 'g1', records: [], checksum: '00000000' };
    try {
      validateReplayLog(log);
      throw new Error('应当抛回放完整性错误');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('schema_version');
      expect((err as Error).message).toContain(`v${SCHEMA_VERSION}`);
    }
  });
});
