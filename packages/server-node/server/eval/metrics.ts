import { SIMILARITY_THRESHOLD, similarity } from '../quality-policy.js';
import type { Belief } from '../schema.js';
import type { Description, GameState, Role } from '../types.js';
import type { SelfPlayResult } from './self-play.js';

/**
 * 评测指标(OpenSpec 04 · Task 2.2:completion / validity / leakage / repetition /
 * diversity / strategy-distinguishability / belief-calibration / usage / retries / role-outcomes,
 * **均带分母**;比率类另给 95% 近似置信半宽作不确定度)。
 *
 * 全部为**纯函数**、只吃自博弈快照(内部对局 + 私有信念),不触模型、不依赖墙钟——
 * 故同输入恒得同输出,是 Task 1.2「逐字节稳定报告」的计算侧保证。
 * 私有信念只作**离线**特征,永不回流任何 AgentContext(残余风险 R2)。
 */

/** 逐局抽取的原始计数(可跨局相加聚合;分子/分母都在此)。 */
export interface GameMetrics {
  gameId: string;
  completed: boolean;
  aborted: boolean;
  rounds: number;
  winner: Role | null;
  humanUndercover: boolean;

  aiDescriptionCount: number;
  /** 泄题:AI 描述含自身密词的条数。结构上应恒为 0(引擎质量门在前置守卫)。 */
  leakCount: number;

  aiVoteCount: number;
  /** 非法票:目标非真实存活玩家 / 自投。结构上应恒为 0(引擎在 generateVotes 重新裁决)。 */
  illegalVoteCount: number;

  /** 同轮跨 AI 描述对数(diversity / distinguishability 的分母)。 */
  crossAgentPairs: number;
  /** 同轮跨 AI 描述对的 (1 − 相似度) 之和 → diversity 分子。 */
  diversitySum: number;
  /** 同轮跨 AI 描述对中「相似度 < 阈值」的对数 → distinguishability 分子。 */
  distinguishablePairs: number;

  /** 同一 AI 相邻两轮自述的对数(repetition 的分母)。 */
  selfRepeatPairs: number;
  /** 同一 AI 相邻两轮自述相似度之和 → repetition 分子(越低越好)。 */
  selfRepeatSum: number;

  /** 参与「找卧底」的平民 AI 且有信念者(belief-calibration 分母)。 */
  hunters: number;
  /** 平民 AI 中「最高怀疑 == 真卧底」的命中数 → calibration 分子。 */
  beliefHits: number;
  /** 各 hunter 的(对真卧底怀疑 − 对他人平均怀疑)之和 → 怀疑差聚合。 */
  suspicionGapSum: number;

  describeCalls: number;
  voteCalls: number;
  reviewCalls: number;
  /** 描述重试数 = describe 调用数 − 落地 AI 描述数(质量门有界重试的可观测代理)。 */
  describeRetries: number;
}

const AI_SEATS = ['ai-1', 'ai-2', 'ai-3', 'ai-4'] as const;

/** 从单局自博弈快照抽取指标(纯函数)。 */
export function extractGameMetrics(result: SelfPlayResult): GameMetrics {
  const game = result.internal;
  const undercover = game.players.find((p) => p.role === 'undercover');
  const undercoverId = undercover?.id;
  const aiDescriptions = game.descriptions.filter((d) => d.playerId !== 'human');

  // —— 泄题:AI 描述是否含自身密词 ——
  const wordById = new Map(game.players.map((p) => [p.id, p.word] as const));
  let leakCount = 0;
  for (const d of aiDescriptions) {
    const w = wordById.get(d.playerId);
    if (w && d.text.includes(w)) leakCount += 1;
  }

  // —— 非法票:目标非真实存活玩家 / 自投 ——
  const realIds = new Set(game.players.map((p) => p.id));
  const aiVotes = game.votes.filter((v) => v.voterId !== 'human');
  let illegalVoteCount = 0;
  for (const v of aiVotes) {
    if (!realIds.has(v.targetId) || v.targetId === v.voterId) illegalVoteCount += 1;
  }

  // —— diversity / distinguishability:逐轮取跨 AI 描述对 ——
  let crossAgentPairs = 0;
  let diversitySum = 0;
  let distinguishablePairs = 0;
  const byRound = groupByRound(aiDescriptions);
  for (const round of byRound.values()) {
    for (let i = 0; i < round.length; i += 1) {
      for (let j = i + 1; j < round.length; j += 1) {
        const sim = similarity(round[i].text, round[j].text);
        crossAgentPairs += 1;
        diversitySum += 1 - sim;
        if (sim < SIMILARITY_THRESHOLD) distinguishablePairs += 1;
      }
    }
  }

  // —— repetition:同一 AI 相邻两轮自述相似度 ——
  let selfRepeatPairs = 0;
  let selfRepeatSum = 0;
  for (const seat of AI_SEATS) {
    const own = aiDescriptions
      .filter((d) => d.playerId === seat)
      .sort((a, b) => a.round - b.round);
    for (let i = 1; i < own.length; i += 1) {
      selfRepeatPairs += 1;
      selfRepeatSum += similarity(own[i - 1].text, own[i].text);
    }
  }

  // —— belief-calibration:平民 AI 的最高怀疑是否命中真卧底 ——
  let hunters = 0;
  let beliefHits = 0;
  let suspicionGapSum = 0;
  if (undercoverId) {
    for (const p of game.players) {
      if (p.isHuman || p.role !== 'civilian') continue; // 卧底不猎捕自己,排除出分母
      const belief = result.beliefs[p.id];
      if (!belief || belief.suspicions.length === 0) continue;
      hunters += 1;
      const top = topSuspect(belief);
      if (top === undercoverId) beliefHits += 1;
      suspicionGapSum += suspicionGap(belief, undercoverId);
    }
  }

  const describeRetries = Math.max(0, result.calls.describeCalls - aiDescriptions.length);

  return {
    gameId: result.gameId,
    completed: result.completed,
    aborted: !result.completed,
    rounds: game.round,
    winner: game.winner,
    humanUndercover: game.players.find((p) => p.isHuman)?.role === 'undercover',
    aiDescriptionCount: aiDescriptions.length,
    leakCount,
    aiVoteCount: aiVotes.length,
    illegalVoteCount,
    crossAgentPairs,
    diversitySum,
    distinguishablePairs,
    selfRepeatPairs,
    selfRepeatSum,
    hunters,
    beliefHits,
    suspicionGapSum,
    describeCalls: result.calls.describeCalls,
    voteCalls: result.calls.voteCalls,
    reviewCalls: result.calls.reviewCalls,
    describeRetries,
  };
}

/** 最高怀疑对象(并列时按 playerId 升序取首,确定性)。 */
function topSuspect(belief: Belief): string | undefined {
  let best: { id: string; score: number } | undefined;
  for (const s of [...belief.suspicions].sort((a, b) => (a.playerId < b.playerId ? -1 : 1))) {
    if (!best || s.score > best.score) best = { id: s.playerId, score: s.score };
  }
  return best?.id;
}

/** 对真卧底的怀疑 − 对其余被怀疑者的平均怀疑。正值表示校准正确方向。 */
function suspicionGap(belief: Belief, undercoverId: string): number {
  const onUc = belief.suspicions.find((s) => s.playerId === undercoverId)?.score ?? 0;
  const others = belief.suspicions.filter((s) => s.playerId !== undercoverId);
  const meanOthers = others.length
    ? others.reduce((acc, s) => acc + s.score, 0) / others.length
    : 0;
  return onUc - meanOthers;
}

function groupByRound(descriptions: Description[]): Map<number, Description[]> {
  const map = new Map<number, Description[]>();
  for (const d of descriptions) {
    const arr = map.get(d.round) ?? [];
    arr.push(d);
    map.set(d.round, arr);
  }
  return map;
}

// —— 聚合 ——

/** 报告指标行:key/value/n(n 即分母,兼作样本量)。与 schema.ts 的 `report.metrics` 一致。 */
export interface ReportMetric {
  key: string;
  value: number;
  n: number;
}

/** 聚合口径:所有比率的分子/分母都来自逐局计数的相加,故聚合本身也是确定性纯函数。 */
export interface AggregateResult {
  games: number;
  metrics: ReportMetric[];
  /** 供门禁直接读取的关键聚合值(避免门禁再从 metrics 数组里翻找)。 */
  gateInputs: {
    completionRate: number;
    totalLeaks: number;
    totalIllegalVotes: number;
    diversityRate: number;
    beliefHitRate: number;
  };
}

/** 95% 近似置信半宽(正态近似 p̂ ± 1.96·√(p(1−p)/n));n=0 记 0。仅作不确定度展示。 */
function ci95(p: number, n: number): number {
  if (n <= 0) return 0;
  return round6(1.96 * Math.sqrt((p * (1 - p)) / n));
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : round6(numerator / denominator);
}

/** 六位定点四舍五入:抹平浮点尾差,保证跨平台/跨运行逐字节稳定。 */
function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

/**
 * 把逐局指标聚合成**冻结 keyset** 的报告指标表(残余风险 R3:keyset 必须钉死)。
 * 比率类同时产出 `<key>_ci95` 行表达不确定度——在 `report.metrics` 的 {key,value,n} 结构内诚实表达。
 */
export function aggregate(perGame: GameMetrics[]): AggregateResult {
  const games = perGame.length;
  const sum = (f: (m: GameMetrics) => number): number => perGame.reduce((acc, m) => acc + f(m), 0);

  const completed = perGame.filter((m) => m.completed).length;
  const totalLeaks = sum((m) => m.leakCount);
  const totalIllegalVotes = sum((m) => m.illegalVoteCount);

  const crossPairs = sum((m) => m.crossAgentPairs);
  const diversityRate = ratio(sum((m) => m.diversitySum), crossPairs);
  const distinguishRate = ratio(sum((m) => m.distinguishablePairs), crossPairs);

  const selfRepeatPairs = sum((m) => m.selfRepeatPairs);
  const repetitionRate = ratio(sum((m) => m.selfRepeatSum), selfRepeatPairs);

  const hunters = sum((m) => m.hunters);
  const beliefHitRate = ratio(sum((m) => m.beliefHits), hunters);
  const meanSuspicionGap = ratio(sum((m) => m.suspicionGapSum), hunters);

  const undercoverWins = perGame.filter((m) => m.winner === 'undercover').length;
  const civilianWins = perGame.filter((m) => m.winner === 'civilian').length;
  const totalRounds = sum((m) => m.rounds);

  const completionRate = ratio(completed, games);

  const metrics: ReportMetric[] = [
    // —— 安全不变量(结构上应恒 0;跨 N 局验证) ——
    { key: 'leak_count', value: totalLeaks, n: sum((m) => m.aiDescriptionCount) },
    { key: 'illegal_vote_count', value: totalIllegalVotes, n: sum((m) => m.aiVoteCount) },
    // —— completion ——
    { key: 'completion_rate', value: completionRate, n: games },
    { key: 'completion_rate_ci95', value: ci95(completionRate, games), n: games },
    // —— 差异化三指标 ——
    { key: 'diversity_rate', value: diversityRate, n: crossPairs },
    { key: 'strategy_distinguishability', value: distinguishRate, n: crossPairs },
    { key: 'strategy_distinguishability_ci95', value: ci95(distinguishRate, crossPairs), n: crossPairs },
    { key: 'self_repetition_rate', value: repetitionRate, n: selfRepeatPairs },
    // —— 信念校准 ——
    { key: 'belief_hit_rate', value: beliefHitRate, n: hunters },
    { key: 'belief_hit_rate_ci95', value: ci95(beliefHitRate, hunters), n: hunters },
    { key: 'mean_suspicion_gap', value: meanSuspicionGap, n: hunters },
    // —— 角色结果 ——
    { key: 'undercover_win_rate', value: ratio(undercoverWins, games), n: games },
    { key: 'civilian_win_rate', value: ratio(civilianWins, games), n: games },
    { key: 'mean_rounds', value: ratio(totalRounds, games), n: games },
    // —— usage / retries(fixture 下确定;墙钟时延/成本留真机模式单列) ——
    { key: 'model_calls_total', value: sum((m) => m.describeCalls + m.voteCalls + m.reviewCalls), n: games },
    { key: 'describe_retries_total', value: sum((m) => m.describeRetries), n: sum((m) => m.aiDescriptionCount) },
  ];

  return {
    games,
    metrics,
    gateInputs: {
      completionRate,
      totalLeaks,
      totalIllegalVotes,
      diversityRate,
      beliefHitRate,
    },
  };
}
