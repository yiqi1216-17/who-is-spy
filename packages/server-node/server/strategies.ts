import type { Strategy } from './schema.js';
import type { Player, StrategyView } from './types.js';

/**
 * 种子策略原型(OpenSpec 03 · §4 的手写起点)
 *
 * 四个角色各持一份可解释策略:persona 是性格标签,tactics 是话术倾向,
 * specificity/novelty/risk 三个连续量分别指示描述的具体度、换角度倾向、冒险度。
 * 现阶段诚实标注为 synthetic(手写);C 阶段用真实语料抽取的分布回填替换,
 * 届时只换这份数据、不动编排代码(这正是策略与代码解耦的价值)。
 */
export const SEED_STRATEGIES: readonly Strategy[] = [
  {
    id: 'cautious-observer',
    version: 1,
    role: 'any',
    persona: '谨慎观察',
    tactics: ['先给上位概念', '回避独有细节', '留有余地不抢先定性'],
    specificity: 0.35,
    novelty: 0.5,
    risk: 0.2,
    provenance: { kind: 'synthetic' },
  },
  {
    id: 'intuitive-reader',
    version: 1,
    role: 'any',
    persona: '直觉敏锐',
    tactics: ['抓整体感觉与联想', '用氛围与情绪词', '顺着场上语气接话'],
    specificity: 0.45,
    novelty: 0.7,
    risk: 0.45,
    provenance: { kind: 'synthetic' },
  },
  {
    id: 'logical-deducer',
    version: 1,
    role: 'any',
    persona: '逻辑派',
    tactics: ['结构化归类', '强调功能与用途', '对齐并比对他人措辞'],
    specificity: 0.55,
    novelty: 0.4,
    risk: 0.35,
    provenance: { kind: 'synthetic' },
  },
  {
    id: 'wildcard',
    version: 1,
    role: 'any',
    persona: '出其不意',
    tactics: ['换一个新颖角度', '制造反差', '避免与前面雷同'],
    specificity: 0.5,
    novelty: 0.85,
    risk: 0.6,
    provenance: { kind: 'synthetic' },
  },
];

/** 完整策略 → 投影视图(剥离来源/ID/version 等元数据,只留渲染所需)。 */
export function projectStrategy(strategy: Strategy): StrategyView {
  return {
    persona: strategy.persona,
    tactics: [...strategy.tactics],
    specificity: strategy.specificity,
    novelty: strategy.novelty,
    risk: strategy.risk,
  };
}

/**
 * 按 AI 座次确定性地取策略:`ai-${n}` → 第 n-1 份种子策略。
 * 座次由 createGame 固定,因此策略分配也是确定性的(便于消融复现)。
 */
export function strategyForAgent(agent: Player): StrategyView {
  if (agent.isHuman) {
    throw new Error('Human players do not carry an AI strategy');
  }
  const seat = Number.parseInt(agent.id.replace(/^ai-/, ''), 10);
  const strategy = SEED_STRATEGIES[(seat - 1) % SEED_STRATEGIES.length];
  return projectStrategy(strategy);
}
