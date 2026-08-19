import { safeDigest } from '../redaction.js';
import { SCHEMA_VERSION } from '../schema.js';
import type { GameEvent } from '../types.js';

/**
 * 事件式回放日志(OpenSpec 04 · §5.1 / design.md 决策 8)
 *
 * 决策 8:回放是**事件式、脱敏、诚实**的——它校验 schema 版本,从**有序事件**重建"已接受的
 * 公开决策 / 票型 / 出局 / 终局 / 高光锚点",**绝不重跑模型**,也**不声称能重建被拒私有候选**;
 * **单调 ID + 校验和**用于探测重复、缺口、篡改。
 *
 * 关键诚实边界:引擎的 `game.events` 里**只有已接受的公开动作**(被拒候选只在 04-F trace 里留
 * hash/length,从不进 events)。所以本日志天然只含可复放的公开动作——这正是 §3.3 的"accepted 侧"。
 *
 * 确定性:记录用**位置序号** `seq`(0,1,2,…)作单调 ID,并对**语义字段**(剥掉引擎内部 randomUUID
 * 事件 id 与时钟)做 FNV-1a **链式校验和**。故同一局内容 → 逐字节相同的日志(不含随机/墙钟量),
 * 呼应 04-E 的可复现口径。
 */

/** 链式校验和的固定种子(seq=0 的 prevChecksum)。 */
const CHAIN_SEED = '00000000';

export interface ReplayRecord {
  /** 单调序号(0,1,2,…):既是记录身份,也用于缺口/重复检测。 */
  seq: number;
  type: GameEvent['type'];
  round: number;
  playerId?: string;
  /** 已接受的公开文本:描述经质量门、系统/票型/出局为引擎公开公告,均不含密词。 */
  text: string;
  /** 链式校验和 `FNV(prevChecksum + '#' + canonical(record))` → 篡改/换序即失配,可定位到具体 seq。 */
  checksum: string;
}

export interface ReplayLog {
  /** 版本信封:回放前先过版本守卫(迁移守卫,§5.1 的 schema/version 侧)。 */
  v: number;
  gameId: string;
  records: ReplayRecord[];
  /** 末条链式校验和(== 最后一条记录的 checksum);空日志为种子值。 */
  checksum: string;
}

/** 记录的**规范串**:只取语义字段,顺序固定 → 确定性、不含随机 id/时钟。 */
export function canonicalRecord(input: {
  seq: number;
  type: GameEvent['type'];
  round: number;
  playerId?: string;
  text: string;
}): string {
  return `${input.seq}|${input.type}|${input.round}|${input.playerId ?? ''}|${input.text}`;
}

/** 单步链式校验和:把上一条校验和与本条规范串拼接后取 FNV-1a 8-hex。 */
export function chainChecksum(prevChecksum: string, canonical: string): string {
  return safeDigest(`${prevChecksum}#${canonical}`).hash;
}

/**
 * 录制器(纯函数):把引擎有序事件折成回放日志。
 * - 位置序号作单调 ID;引擎内部 randomUUID 事件 id **被丢弃**(不进日志 → 保逐字节稳定)。
 * - 只读不改:不触碰引擎状态,可对进行中或已终局的对局随时调用。
 */
export function buildReplayLog(gameId: string, events: readonly GameEvent[]): ReplayLog {
  let prev = CHAIN_SEED;
  const records: ReplayRecord[] = events.map((event, seq) => {
    const canonical = canonicalRecord({
      seq,
      type: event.type,
      round: event.round,
      playerId: event.playerId,
      text: event.text,
    });
    const checksum = chainChecksum(prev, canonical);
    prev = checksum;
    const record: ReplayRecord = { seq, type: event.type, round: event.round, text: event.text, checksum };
    if (event.playerId !== undefined) record.playerId = event.playerId;
    return record;
  });
  return { v: SCHEMA_VERSION, gameId, records, checksum: prev };
}
