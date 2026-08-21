import type { Strategy } from './schema.js';
import type { Player, StrategyView } from './types.js';
import { TRANSFER_STRATEGIES } from './strategies.data.js';

/**
 * 种子策略原型(OpenSpec 03 · §4;C 阶段语料回填已完成,tasks 4.1/4.2)
 *
 * 四个角色各持一份可解释策略:persona 是性格标签,tactics 是话术倾向,
 * specificity/novelty/risk 三个连续量分别指示描述的具体度、换角度倾向、冒险度。
 *
 * v1 是手写 synthetic 种子(见 git 历史);v2 起改为 **transfer 实测分布**——
 * werewolf-among-us train split(109 局、475 个玩家样本)句级说服策略标注的
 * 簇统计,由 `npm run data:strategies` 生成 `strategies.data.ts`(勿手改),
 * 溯源见 provenance.sampleIds 与 data/normalized/strategy-extraction-report.json。
 * 本次替换只动数据、不动编排代码——正是策略与代码解耦的价值兑现。
 */
export const SEED_STRATEGIES: readonly Strategy[] = TRANSFER_STRATEGIES;

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
