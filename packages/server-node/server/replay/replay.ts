import { SCHEMA_VERSION, envelope, parseVersioned } from '../schema.js';
import type { GameEvent } from '../types.js';
import { type ReplayLog, canonicalRecord, chainChecksum } from './log.js';

/**
 * 回放校验 + 重建(OpenSpec 04 · §5.1 / design.md 决策 8)
 *
 * 校验四关:① schema/version(迁移守卫)② 单调 ID(缺口/重复)③ 篡改(链式校验和)。
 * 全过后 `reconstructTimeline` 从有序事件**重建公开决策时间线**——**签名里没有模型**,
 * 故结构上不可能重跑模型(§5.1 的"without rerunning models" + §3.3 的 accepted 复放侧)。
 */

const CHAIN_SEED = '00000000';

export type ReplayIssueCode =
  | 'schema_version' // 日志/记录版本与当前 SCHEMA_VERSION 不符
  | 'schema' // 记录结构不满足登记的 event schema
  | 'gap' // seq 与位置不符(缺口/乱序:丢事件或换序)
  | 'duplication' // seq 重复(重放/重复写入)
  | 'tamper'; // 链式校验和失配(内容被改/截断/追加)

/** 回放完整性错误:带机器可读 `code` 与出错 `seq`,便于定位到"具体哪一条"。 */
export class ReplayIntegrityError extends Error {
  constructor(
    readonly code: ReplayIssueCode,
    message: string,
    readonly seq?: number,
  ) {
    super(message);
    this.name = 'ReplayIntegrityError';
  }
}

/**
 * 校验日志完整性。任一关不过即抛 `ReplayIntegrityError`(含 code + seq)。
 * 纯校验、无副作用;既可独立调用(门禁),也被 `reconstructTimeline` 前置调用。
 */
export function validateReplayLog(log: ReplayLog): void {
  // 关①a:日志信封版本(迁移守卫)。
  if (log.v !== SCHEMA_VERSION) {
    throw new ReplayIntegrityError(
      'schema_version',
      `回放日志版本不兼容:期望 v${SCHEMA_VERSION},实际 v${String(log.v)};请迁移或重建`,
    );
  }

  let prev = CHAIN_SEED;
  const seen = new Set<number>();
  log.records.forEach((record, index) => {
    // 关②:单调 ID —— seq 必须等于位置(0,1,2,…)。先判重复(seq 已见),再判缺口/乱序(seq≠位置)。
    if (seen.has(record.seq)) {
      throw new ReplayIntegrityError('duplication', `seq ${record.seq} 重复:疑似重放或重复写入`, record.seq);
    }
    seen.add(record.seq);
    if (record.seq !== index) {
      throw new ReplayIntegrityError(
        'gap',
        `位置 ${index} 期望 seq ${index},实际 ${record.seq}:疑似丢事件或换序`,
        record.seq,
      );
    }

    // 关①b:记录结构过登记的 `event` strict schema(结构 + 版本);非法 type/多余字段即抛。
    const artifact: GameEvent = {
      id: `evt-${record.seq}`,
      type: record.type,
      text: record.text,
      round: record.round,
    };
    if (record.playerId !== undefined) artifact.playerId = record.playerId;
    try {
      parseVersioned('event', envelope('event', artifact));
    } catch (error) {
      throw new ReplayIntegrityError(
        'schema',
        `seq ${record.seq} 结构非法:${error instanceof Error ? error.message : String(error)}`,
        record.seq,
      );
    }

    // 关③:链式校验和 —— 重算并与存储值比对;任一字段被改即失配,可定位到 seq。
    const expected = chainChecksum(
      prev,
      canonicalRecord({
        seq: record.seq,
        type: record.type,
        round: record.round,
        playerId: record.playerId,
        text: record.text,
      }),
    );
    if (expected !== record.checksum) {
      throw new ReplayIntegrityError('tamper', `seq ${record.seq} 校验和失配:内容被篡改或换序`, record.seq);
    }
    prev = expected;
  });

  // 关③(末):整段链尾校验和须与日志声明一致(截断/追加即失配)。
  if (prev !== log.checksum) {
    throw new ReplayIntegrityError('tamper', '日志尾校验和失配:疑似截断或追加');
  }
}

export interface ReconstructedTimeline {
  gameId: string;
  /** 按轮聚合的已接受描述(公开动作)。 */
  rounds: Array<{ round: number; descriptions: Array<{ playerId?: string; text: string }> }>;
  /** 票型公告(平票加票等)。 */
  ballots: Array<{ round: number; text: string }>;
  /** 出局序列(公开公告,身份不在此揭晓)。 */
  eliminations: Array<{ round: number; playerId?: string; text: string }>;
  /** 高光锚点(供 05-H 前端做呈现):出局与轮次系统标记。 */
  highlights: Array<{ seq: number; type: GameEvent['type']; round: number; text: string }>;
  eventCount: number;
}

/**
 * 从有序日志重建公开决策时间线。**无模型参数** → 结构上不可能重跑模型。
 * 先 `validateReplayLog`(完整性四关),再纯折叠 —— 只读日志、只吐公开结构。
 */
export function reconstructTimeline(log: ReplayLog): ReconstructedTimeline {
  validateReplayLog(log);

  const roundMap = new Map<number, Array<{ playerId?: string; text: string }>>();
  const ballots: ReconstructedTimeline['ballots'] = [];
  const eliminations: ReconstructedTimeline['eliminations'] = [];
  const highlights: ReconstructedTimeline['highlights'] = [];

  for (const record of log.records) {
    switch (record.type) {
      case 'description': {
        const bucket = roundMap.get(record.round) ?? [];
        bucket.push({ ...(record.playerId ? { playerId: record.playerId } : {}), text: record.text });
        roundMap.set(record.round, bucket);
        break;
      }
      case 'vote_result':
        ballots.push({ round: record.round, text: record.text });
        highlights.push({ seq: record.seq, type: record.type, round: record.round, text: record.text });
        break;
      case 'elimination':
        eliminations.push({
          round: record.round,
          ...(record.playerId ? { playerId: record.playerId } : {}),
          text: record.text,
        });
        highlights.push({ seq: record.seq, type: record.type, round: record.round, text: record.text });
        break;
      case 'system':
        highlights.push({ seq: record.seq, type: record.type, round: record.round, text: record.text });
        break;
    }
  }

  const rounds = [...roundMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, descriptions]) => ({ round, descriptions }));

  return { gameId: log.gameId, rounds, ballots, eliminations, highlights, eventCount: log.records.length };
}
