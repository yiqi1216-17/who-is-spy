import type { SelfPlayResult } from './self-play.js';
import { similarity } from '../quality-policy.js';

/**
 * 军备竞赛**逐局逐轮 trace**(回答「胜率是怎么打出来的」——不止聚合数字,要能看到每一局的
 * 描述→离群度→投票→出局→终局全过程)。
 *
 * 隐私:秘密词**一律不落**——描述文本保留(本就是公开信息),但玩家的 `word` 只以 `wordTag`
 * (FNV-1a 8-hex 假名)呈现,平民/卧底靠 `sameWordTag` 是否一致即可分辨阵营而无需泄词;
 * `scanSecrets` 因此恒为空。角色(role)在**终局后**呈现(与生产终局揭示同口径,不违反终局前隔离)。
 *
 * 关键可读性:每条描述带 `divergence`(与本轮其余 AI 描述的平均不相似度)——这正是平民投票所依据的
 * 信号。读者能亲眼看到:卧底(异词)描述的 divergence 通常最高,平民票如何(在高技能档)集中向它。
 */

import { safeDigest } from '../redaction.js';

export interface TraceDescription {
  round: number;
  playerId: string;
  /** 该玩家词的假名(同词同 tag);用于分辨阵营而不泄词。 */
  wordTag: string;
  text: string;
  /** 与本轮其余 AI 描述的平均不相似度(离群度)——平民识别卧底的信号面。round 内计算。 */
  divergence: number;
}

export interface TraceVote {
  round: number;
  ballot: number;
  voterId: string;
  targetId: string;
  reason: string;
}

export interface TracePlayer {
  id: string;
  name: string;
  isHuman: boolean;
  wordTag: string;
  /** 终局后揭示(与生产终局揭示同口径)。 */
  role: 'civilian' | 'undercover';
  /** 是否活到终局。 */
  survived: boolean;
}

export interface GameTrace {
  skill: string;
  gameIndex: number;
  rounds: number;
  completed: boolean;
  abortCode?: string;
  winner: 'civilian' | 'undercover' | null;
  /** 本局卧底座位(终局后揭示),便于一眼核对「平民有没有抓对」。 */
  undercoverId: string | null;
  players: TracePlayer[];
  descriptions: TraceDescription[];
  votes: TraceVote[];
  /** 出局顺序(playerId,按发生先后);末位常即终局被抓/误抓者。 */
  eliminations: string[];
}

/** 一条描述相对本轮其余**AI**描述的离群度 = 1 − 平均相似度(排除 human 陪跑,与模型识别口径一致)。 */
function divergenceInRound(
  text: string,
  playerId: string,
  sameRoundAi: ReadonlyArray<{ playerId: string; text: string }>,
): number {
  const rest = sameRoundAi.filter((d) => d.playerId !== playerId);
  if (rest.length === 0) return 0;
  const mean = rest.reduce((acc, d) => acc + similarity(text, d.text), 0) / rest.length;
  return Math.round((1 - mean) * 1e4) / 1e4;
}

/** 把单局 SelfPlayResult 抽成**脱敏**的逐轮 trace。 */
export function extractGameTrace(result: SelfPlayResult, skill: string, gameIndex: number): GameTrace {
  const g = result.internal;
  const tagOf = new Map<string, string>();
  for (const p of g.players) tagOf.set(p.id, safeDigest(p.word).hash);

  const aiByRound = new Map<number, Array<{ playerId: string; text: string }>>();
  for (const d of g.descriptions) {
    if (d.playerId === 'human') continue;
    aiByRound.set(d.round, [...(aiByRound.get(d.round) ?? []), { playerId: d.playerId, text: d.text }]);
  }

  const descriptions: TraceDescription[] = g.descriptions.map((d) => ({
    round: d.round,
    playerId: d.playerId,
    wordTag: tagOf.get(d.playerId) ?? '????????',
    text: d.text,
    divergence:
      d.playerId === 'human' ? 0 : divergenceInRound(d.text, d.playerId, aiByRound.get(d.round) ?? []),
  }));

  const undercover = g.players.find((p) => p.role === 'undercover');
  return {
    skill,
    gameIndex,
    rounds: g.round,
    completed: result.completed,
    abortCode: result.abortCode,
    winner: g.winner,
    undercoverId: undercover?.id ?? null,
    players: g.players.map((p) => ({
      id: p.id,
      name: p.name,
      isHuman: p.isHuman,
      wordTag: tagOf.get(p.id) ?? '????????',
      role: p.role,
      survived: p.alive,
    })),
    descriptions,
    votes: g.votes.map((v) => ({
      round: v.round,
      ballot: v.ballot,
      voterId: v.voterId,
      targetId: v.targetId,
      reason: v.reason,
    })),
    eliminations: g.events.filter((e) => e.type === 'elimination' && e.playerId).map((e) => e.playerId as string),
  };
}

/**
 * 把单局 trace 渲染成人类可读的逐轮复盘(stdout / 报告用)。
 * 展示:每轮各人描述 + 离群度(卧底常最高)+ 该轮票型 + 出局者 + 终局谁赢、平民有没有抓对。
 */
export function renderGameTraceText(t: GameTrace): string {
  const nameOf = new Map(t.players.map((p) => [p.id, p.name]));
  const roleMark = (id: string): string => (id === t.undercoverId ? '卧底' : '平民');
  const label = (id: string): string => `${nameOf.get(id) ?? id}(${roleMark(id)})`;

  const out: string[] = [];
  const win = t.winner === 'civilian' ? '平民胜' : t.winner === 'undercover' ? '卧底胜' : '未决';
  out.push('');
  out.push(`── [${t.skill}] 第 ${t.gameIndex} 局 · ${t.rounds} 轮 · ${win}${t.completed ? '' : `(未完局:${t.abortCode})`} ──`);
  const rounds = [...new Set(t.descriptions.map((d) => d.round))].sort((a, b) => a - b);
  for (const r of rounds) {
    out.push(`  【第 ${r} 轮 · 描述】`);
    for (const d of t.descriptions.filter((x) => x.round === r)) {
      const flag = d.playerId === t.undercoverId ? ' ←卧底' : '';
      out.push(`    ${label(d.playerId).padEnd(10)} 离群度 ${d.divergence.toFixed(2)}${flag}  “${d.text}”`);
    }
    const votes = t.votes.filter((v) => v.round === r);
    if (votes.length > 0) {
      out.push(`  【第 ${r} 轮 · 投票】`);
      for (const v of votes) {
        const hit = v.targetId === t.undercoverId ? ' ✓抓对' : '';
        out.push(`    ${label(v.voterId).padEnd(10)} → ${label(v.targetId)}${hit}  「${v.reason}」`);
      }
    }
  }
  if (t.eliminations.length > 0) {
    out.push(`  出局顺序:${t.eliminations.map((id) => label(id)).join(' → ')}`);
  }
  return out.join('\n');
}
