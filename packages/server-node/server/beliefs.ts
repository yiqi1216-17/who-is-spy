import { similarity } from './quality-policy.js';
import type { Belief } from './schema.js';

/**
 * 私有结构化信念(OpenSpec 03 · Task 5.1)
 *
 * 每个 AI Agent 维护一份**私有**的结构化信念,替代自由文本的 chain-of-thought:
 *   - suspicions:对每位其他存活玩家的怀疑度(0–1),由公开描述的"离群度"确定性推导;
 *   - selfExposure:自己本轮描述相对全场的离群度(卧底越突出越危险),用于自我收敛;
 *   - evidenceRefs:每条判断只保存 (playerId, round) 公开引用,**不存任何自由文本/推理**。
 *
 * 三条硬性质,由本模块的纯函数保证、由引擎的存储位置保证:
 *   1. 结构化无自由文本:信念只有分数与公开引用,天然通过 belief 的 strict schema。
 *   2. 确定性可校准:observeRound 是纯函数,同输入恒得同输出;离群度→怀疑度用 EMA 平滑,
 *      单调有界(更离群→更可疑,永在 [0,1])。
 *   3. 跨 Agent 非干扰:observeRound 只接收"该 Agent 自己的上一份信念 + 本轮公开描述",
 *      签名上就拿不到任何他人信念;引擎把每份信念私有存储,绝不进公开 DTO / 他人上下文。
 */

/** EMA 平滑因子:新观测占比。0.5 → 新旧各半,既跟得上又不过度抖动。 */
export const BELIEF_EMA_ALPHA = 0.5;

/** 一轮的公开观测:只含公开可见的 (playerId, text)。 */
export interface RoundObservation {
  round: number;
  /** 观测主体(该 Agent)自己的 id;其自述用于 selfExposure,不计入对他人的怀疑。 */
  selfId: string;
  /** 本轮全部公开描述(含自己),只取公开字段。 */
  descriptions: ReadonlyArray<{ playerId: string; text: string }>;
}

/** 一份空信念(开局前)。round=0 表示尚未观测。 */
export function emptyBelief(): Belief {
  return { round: 0, suspicions: [], selfExposure: 0, evidenceRefs: [] };
}

/**
 * 依据一轮公开描述更新信念。纯函数:不修改 prev,不读取任何他人信念。
 *
 * 离群度(divergence):一条描述与本轮其余描述的平均字符 bigram 相似度越低,越离群。
 *   divergence = clamp(1 − mean_similarity_to_others)。
 * 怀疑度按 EMA 更新:score = (1−α)·prevScore + α·divergence,故单调有界。
 * 本轮未出现的旧怀疑对象:分数原样保留(无新证据不臆断),其历史证据引用保留。
 */
export function observeRound(prev: Belief, obs: RoundObservation): Belief {
  const priorScore = new Map(prev.suspicions.map((s) => [s.playerId, s.score]));
  const others = obs.descriptions.filter((d) => d.playerId !== obs.selfId);
  const self = obs.descriptions.find((d) => d.playerId === obs.selfId);

  // 本轮观测到的每位他人:EMA 更新怀疑度。
  const observed = new Map<string, number>();
  for (const d of others) {
    const prevScore = priorScore.get(d.playerId) ?? 0;
    const div = divergenceOf(d.text, obs.descriptions, d.playerId);
    observed.set(d.playerId, ema(prevScore, div));
  }

  // 合并:本轮观测到的用新分,未观测到的沿用旧分(证据不足不改判)。
  const ids = new Set<string>([...priorScore.keys(), ...observed.keys()]);
  const suspicions = [...ids].map((playerId) => ({
    playerId,
    score: observed.has(playerId) ? observed.get(playerId)! : (priorScore.get(playerId) ?? 0),
  }));

  // 自我暴露:自己本轮描述相对全场的离群度,EMA 平滑;无自述则保留旧值。
  const selfExposure =
    self !== undefined
      ? ema(prev.selfExposure, divergenceOf(self.text, obs.descriptions, obs.selfId))
      : prev.selfExposure;

  // 证据引用:旧引用 + 本轮为每位观测到的他人各记一条 (playerId, round)。只存公开引用。
  const evidenceRefs = [
    ...prev.evidenceRefs,
    ...others.map((d) => ({ playerId: d.playerId, round: obs.round })),
  ];

  return normalizeBelief({
    round: Math.max(prev.round, obs.round),
    suspicions,
    selfExposure,
    evidenceRefs,
  });
}

/**
 * 归一化:分数夹到 [0,1],怀疑对象按 playerId 去重(留后者)并排序,
 * 证据引用去重并排序。使信念规范化、可确定性比较、稳定序列化。
 */
export function normalizeBelief(belief: Belief): Belief {
  const byId = new Map<string, number>();
  for (const s of belief.suspicions) byId.set(s.playerId, clamp01(s.score));
  const suspicions = [...byId.entries()]
    .map(([playerId, score]) => ({ playerId, score }))
    .sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));

  const refSeen = new Set<string>();
  const evidenceRefs = belief.evidenceRefs
    .filter((ref) => {
      const key = `${ref.playerId}#${ref.round}`;
      if (refSeen.has(key)) return false;
      refSeen.add(key);
      return true;
    })
    .sort((a, b) =>
      a.playerId !== b.playerId ? (a.playerId < b.playerId ? -1 : 1) : a.round - b.round,
    );

  return {
    round: belief.round,
    suspicions,
    selfExposure: clamp01(belief.selfExposure),
    evidenceRefs,
  };
}

/** 一条描述相对本轮其余描述的离群度 = 1 − 与其余描述的平均相似度,夹到 [0,1]。 */
function divergenceOf(
  text: string,
  all: ReadonlyArray<{ playerId: string; text: string }>,
  ownId: string,
): number {
  const rest = all.filter((d) => d.playerId !== ownId);
  if (rest.length === 0) return 0;
  const mean = rest.reduce((acc, d) => acc + similarity(text, d.text), 0) / rest.length;
  return clamp01(1 - mean);
}

function ema(prev: number, observation: number): number {
  return clamp01((1 - BELIEF_EMA_ALPHA) * prev + BELIEF_EMA_ALPHA * observation);
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
