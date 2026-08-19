import { type Versioned, envelope, parseVersioned } from '../schema.js';
import type { GameState } from '../types.js';

/**
 * 数据记录导出(OpenSpec 04 · §5 数据记录侧;人类/迁移/合成分离)
 *
 * 把一局对局投影成登记过的 `datasetRecord` 信封,用于**离线学习/复盘**。三条隐私纪律:
 *  1. **假名化**:真实 playerId / name / avatar **全部丢弃**,只留按座次派生的 `pseudoId`(p0..p4)。
 *  2. **无密词位**:`datasetRecord` schema **结构上没有 word 字段** → 密词永不落盘(role 是终局公开标签,可留)。
 *  3. **来源分离**:`provenance` 显式传入(human/transfer/synthetic),不自动混写 —— 呼应
 *     「human/transfer/synthetic 三源分离」的既定纪律。自博弈合成局标 `synthetic`。
 *
 * 只投影**公开动作**:描述(已过质量门)与投票(targetId 同样假名化)。经 `parseVersioned` strict 往返,
 * 任何越界字段都会被拒 → 导出物结构安全。
 */
export function toDatasetRecord(
  game: GameState,
  provenance: 'human' | 'transfer' | 'synthetic',
  license?: string,
): Versioned<'datasetRecord'> {
  // 座次假名表:真实 id → p{seat};投影里一切玩家引用都过这张表。
  const pseudo = new Map<string, string>();
  game.players.forEach((player, seat) => pseudo.set(player.id, `p${seat}`));
  const alias = (id: string): string => pseudo.get(id) ?? 'p?';

  const players = game.players.map((player) => ({ pseudoId: alias(player.id), role: player.role }));

  const describeActions = game.descriptions.map((description) => ({
    round: description.round,
    playerId: alias(description.playerId),
    kind: 'describe' as const,
    text: description.text,
  }));
  const voteActions = game.votes.map((vote) => ({
    round: vote.round,
    playerId: alias(vote.voterId),
    kind: 'vote' as const,
    targetId: alias(vote.targetId),
  }));

  // 动作按(轮,座次)稳定排序 → 导出逐字节可复现,不泄露原始产出时序里的随机性。
  const actions = [...describeActions, ...voteActions].sort(
    (a, b) => a.round - b.round || a.playerId.localeCompare(b.playerId) || a.kind.localeCompare(b.kind),
  );

  const record = {
    gameId: game.id,
    provenance,
    players,
    actions,
    ...(license ? { license } : {}),
  };
  // strict 往返:越界字段即抛;返回版本化信封(带迁移守卫)。
  return envelope('datasetRecord', parseVersioned('datasetRecord', envelope('datasetRecord', record)));
}
