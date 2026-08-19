import { describe, expect, it } from 'vitest';
import { CountingModel, mulberry32, playSelfPlayGame } from '../eval/self-play.js';
import { GameEngine } from '../game-engine.js';
import { scanSecrets } from '../redaction.js';
import { FakeGameModel } from '../test-utils.js';
import { WORD_PAIRS } from '../words.js';
import { type ReplayLog, buildReplayLog } from './log.js';
import { ReplayIntegrityError, reconstructTimeline, validateReplayLog } from './replay.js';

/** 驱动一局到终局,返回引擎 + 内部快照(承载 role/word,只离线用)。 */
async function finishedGame(seed = 1) {
  const engine = new GameEngine(new FakeGameModel(), mulberry32(seed));
  const result = await playSelfPlayGame(engine);
  return { engine, result };
}

/** 深拷贝一份日志,便于在副本上做篡改而不动原件。 */
function cloneLog(log: ReplayLog): ReplayLog {
  return structuredClone(log);
}

describe('录制器 · 确定性 + 单调链(§5.1)', () => {
  it('同 seed 两局 → records/末校验和逐字节相同(不含随机 id/时钟)', async () => {
    const a = await finishedGame(1);
    const b = await finishedGame(1);
    const logA = a.engine.getReplayLog(a.result.gameId);
    const logB = b.engine.getReplayLog(b.result.gameId);
    // gameId 是引擎的 randomUUID 句柄(两局不同);但事件内容/序号/校验和确定性相等。
    expect(logA.gameId).not.toBe(logB.gameId);
    expect(JSON.stringify(logA.records)).toBe(JSON.stringify(logB.records));
    expect(logA.checksum).toBe(logB.checksum);
  });

  it('单调序号 0..n-1 连续;末校验和 == 最后一条记录', async () => {
    const { engine, result } = await finishedGame(1);
    const log = engine.getReplayLog(result.gameId);
    expect(log.records.length).toBeGreaterThan(0);
    expect(log.records.map((r) => r.seq)).toEqual(log.records.map((_, i) => i));
    expect(log.checksum).toBe(log.records[log.records.length - 1].checksum);
    expect(log.records.every((r) => /^[0-9a-f]{8}$/.test(r.checksum))).toBe(true);
  });

  it('日志里不出现引擎内部 randomUUID 事件 id(只用位置序号)', async () => {
    const { engine, result } = await finishedGame(1);
    const internal = engine.getInternalGame(result.gameId);
    const log = engine.getReplayLog(result.gameId);
    const serialized = JSON.stringify(log);
    for (const event of internal.events) {
      expect(serialized).not.toContain(event.id); // 随机 id 被丢弃 → 逐字节稳定
    }
  });
});

describe('回放校验 · 完整性四关(§5.1 / 决策 8)', () => {
  it('健康日志:validateReplayLog 不抛,reconstructTimeline 成功', async () => {
    const { engine, result } = await finishedGame(1);
    const log = engine.getReplayLog(result.gameId);
    expect(() => validateReplayLog(log)).not.toThrow();
    const timeline = reconstructTimeline(log);
    expect(timeline.rounds.length).toBeGreaterThan(0);
  });

  it('schema/version:v 不符 → schema_version(迁移守卫)', async () => {
    const { engine, result } = await finishedGame(1);
    const log = cloneLog(engine.getReplayLog(result.gameId));
    (log as { v: number }).v = 999;
    try {
      validateReplayLog(log);
      throw new Error('应当抛出');
    } catch (error) {
      expect(error).toBeInstanceOf(ReplayIntegrityError);
      expect((error as ReplayIntegrityError).code).toBe('schema_version');
    }
  });

  it('缺口:删中间一条 → gap(定位到出错 seq)', async () => {
    const { engine, result } = await finishedGame(1);
    const log = cloneLog(engine.getReplayLog(result.gameId));
    log.records.splice(1, 1); // 删掉 seq=1,位置 1 现在是 seq=2
    try {
      validateReplayLog(log);
      throw new Error('应当抛出');
    } catch (error) {
      expect((error as ReplayIntegrityError).code).toBe('gap');
      expect((error as ReplayIntegrityError).seq).toBe(2);
    }
  });

  it('重复:复制一条(同 seq)→ duplication', async () => {
    const { engine, result } = await finishedGame(1);
    const log = cloneLog(engine.getReplayLog(result.gameId));
    log.records.splice(1, 0, structuredClone(log.records[0])); // 位置 1 插入 seq=0 的副本
    try {
      validateReplayLog(log);
      throw new Error('应当抛出');
    } catch (error) {
      expect((error as ReplayIntegrityError).code).toBe('duplication');
      expect((error as ReplayIntegrityError).seq).toBe(0);
    }
  });

  it('篡改内容:改一条 text 而不动 checksum → tamper', async () => {
    const { engine, result } = await finishedGame(1);
    const log = cloneLog(engine.getReplayLog(result.gameId));
    log.records[0] = { ...log.records[0], text: `${log.records[0].text}（被改）` };
    try {
      validateReplayLog(log);
      throw new Error('应当抛出');
    } catch (error) {
      expect((error as ReplayIntegrityError).code).toBe('tamper');
      expect((error as ReplayIntegrityError).seq).toBe(0);
    }
  });

  it('截断:删最后一条 → 尾校验和失配 tamper', async () => {
    const { engine, result } = await finishedGame(1);
    const log = cloneLog(engine.getReplayLog(result.gameId));
    log.records.pop(); // 记录仍连续,但 log.checksum 是完整链的尾值 → 失配
    try {
      validateReplayLog(log);
      throw new Error('应当抛出');
    } catch (error) {
      expect((error as ReplayIntegrityError).code).toBe('tamper');
    }
  });

  it('非法 type:注入未登记事件类型 → schema', async () => {
    const { engine, result } = await finishedGame(1);
    const log = cloneLog(engine.getReplayLog(result.gameId));
    // 直接改 type 为非法值(并不修其 checksum);schema 关先于 tamper 命中。
    (log.records[0] as { type: string }).type = 'not_a_real_type';
    try {
      validateReplayLog(log);
      throw new Error('应当抛出');
    } catch (error) {
      expect((error as ReplayIntegrityError).code).toBe('schema');
    }
  });
});

describe('重建 · 不重跑模型 + accepted 可复放(§5.1 / §3.3)', () => {
  it('重建期间模型调用数为 0(结构上无模型参数)', async () => {
    const counting = new CountingModel(new FakeGameModel());
    const engine = new GameEngine(counting, mulberry32(1));
    const result = await playSelfPlayGame(engine);
    const log = engine.getReplayLog(result.gameId);

    const before = counting.counts();
    for (let i = 0; i < 5; i += 1) reconstructTimeline(log); // 反复重建
    const after = counting.counts();
    expect(after).toEqual(before); // 一次都没再调模型
  });

  it('重建的描述与本局公开描述逐条一致(accepted 可复放)', async () => {
    const { engine, result } = await finishedGame(1);
    const internal = engine.getInternalGame(result.gameId);
    const timeline = reconstructTimeline(engine.getReplayLog(result.gameId));

    const flatReplay = timeline.rounds.flatMap((r) =>
      r.descriptions.map((d) => `${r.round}:${d.playerId ?? ''}:${d.text}`),
    );
    const flatTruth = internal.descriptions.map((d) => `${d.round}:${d.playerId}:${d.text}`);
    expect(flatReplay).toEqual(flatTruth);
  });

  it('日志里扫不出任何密词字面量(被拒候选从不进事件流)', async () => {
    const { engine, result } = await finishedGame(1);
    const log = engine.getReplayLog(result.gameId);
    expect(scanSecrets(JSON.stringify(log))).toEqual([]);
  });

  it('高光锚点覆盖出局事件(供 05-H 呈现)', async () => {
    const { engine, result } = await finishedGame(1);
    const timeline = reconstructTimeline(engine.getReplayLog(result.gameId));
    expect(timeline.eliminations.length).toBeGreaterThan(0);
    // 每个出局都应出现在高光锚点里。
    for (const elimination of timeline.eliminations) {
      expect(timeline.highlights.some((h) => h.type === 'elimination' && h.text === elimination.text)).toBe(true);
    }
  });
});

describe('数据记录导出 · 假名化 + 无密词 + 来源分离(§5 数据记录侧)', () => {
  it('假名化:真实姓名与人类席位标识全不出现,只留 p0..p4', async () => {
    const { engine, result } = await finishedGame(1);
    const record = engine.exportDataset(result.gameId, 'synthetic');
    const serialized = JSON.stringify(record);
    // 假名集合 = 座次派生。
    expect(record.data.players.map((p) => p.pseudoId)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4']);
    // 真实展示名(含人类席「你」与 AI 人设名)不得出现在导出物里。
    for (const name of ['你', '阿序', '弥生', '老墨', '小满']) {
      expect(serialized).not.toContain(`"${name}"`);
    }
    // 动作里的玩家引用也已假名化(不出现原始 'human'/'ai-1' 之类的裸 id 作为独立值)。
    expect(record.data.actions.every((a) => /^p[0-4]$/.test(a.playerId))).toBe(true);
  });

  it('无密词:导出物里扫不出任何秘密词(schema 无 word 字段)', async () => {
    const { engine, result } = await finishedGame(1);
    const record = engine.exportDataset(result.gameId, 'synthetic');
    expect(scanSecrets(JSON.stringify(record))).toEqual([]);
    // 结构上也不存在 word 键。
    expect(JSON.stringify(record)).not.toContain('"word"');
  });

  it('动作数 == 公开描述数 + 投票数;来源标签如实透传', async () => {
    const { engine, result } = await finishedGame(1);
    const internal = engine.getInternalGame(result.gameId);
    const record = engine.exportDataset(result.gameId, 'synthetic', 'CC-BY-4.0');
    expect(record.data.provenance).toBe('synthetic');
    expect(record.data.license).toBe('CC-BY-4.0');
    expect(record.data.actions.length).toBe(internal.descriptions.length + internal.votes.length);
    const describes = record.data.actions.filter((a) => a.kind === 'describe');
    const votes = record.data.actions.filter((a) => a.kind === 'vote');
    expect(describes.length).toBe(internal.descriptions.length);
    expect(votes.length).toBe(internal.votes.length);
    // vote 动作的 targetId 也已假名化。
    expect(votes.every((a) => a.targetId !== undefined && /^p[0-4]$/.test(a.targetId))).toBe(true);
  });

  it('三源分离:同一局按不同来源标签导出互不混写', async () => {
    const { engine, result } = await finishedGame(1);
    const asSynthetic = engine.exportDataset(result.gameId, 'synthetic');
    const asHuman = engine.exportDataset(result.gameId, 'human');
    expect(asSynthetic.data.provenance).toBe('synthetic');
    expect(asHuman.data.provenance).toBe('human');
    // 除来源标签外内容一致(同一局的公开投影);来源不自动推断、由调用方显式声明。
    expect({ ...asSynthetic.data, provenance: 'x' }).toEqual({ ...asHuman.data, provenance: 'x' });
  });
});

describe('录制器纯函数边界', () => {
  it('空事件 → 空日志,末校验和为种子值,重建为空时间线', () => {
    const log = buildReplayLog('g-empty', []);
    expect(log.records).toEqual([]);
    expect(log.checksum).toBe('00000000');
    expect(() => validateReplayLog(log)).not.toThrow();
    const timeline = reconstructTimeline(log);
    expect(timeline).toEqual({
      gameId: 'g-empty',
      rounds: [],
      ballots: [],
      eliminations: [],
      highlights: [],
      eventCount: 0,
    });
  });

  it('WORD_PAIRS 任一密词即便混入事件文本,也会被 scanSecrets 认出(尺子有效性自证)', () => {
    const secret = WORD_PAIRS[0][0];
    const log = buildReplayLog('g', [{ id: 'x', type: 'system', text: `含密词 ${secret}`, round: 1 }]);
    // 这是**反向自证**:证明扫描尺认得密词,故前面"扫不出"的断言不是假阴性。
    expect(scanSecrets(JSON.stringify(log))).toContain(secret);
  });
});
