import type { Phase } from './types.js';

/**
 * 显式域状态机(OpenSpec 03 · Task 2.2)
 *
 * 纯谓词、零依赖:把"相位允许哪些玩家动作 / 相位可以转移到哪里"集中成两张
 * 显式表。引擎的相位切换与动作校验都过这两张表,散落的 if 变成可穷举、可测试
 * 的转移集合。现场任务④(临场规则变体)只需改表 + 补一条转移表测试。
 *
 * 抛错留给引擎(GameRuleError 承载 HTTP 状态语义),此处不引入引擎依赖,避免循环。
 */

export type GameAction = 'describe' | 'vote';

/** 每个相位允许发起的玩家动作。 */
export const PHASE_ACTIONS: Record<Phase, readonly GameAction[]> = {
  describing: ['describe'],
  voting: ['vote'],
  finished: [],
};

/**
 * 合法的相位后继集合。round/ballot 由引擎依据裁决结果决定走哪一条:
 * - describing → voting:本轮描述收齐
 * - voting → voting:同票加票,留在投票
 * - voting → describing:淘汰后进入下一轮
 * - voting → finished:淘汰后分出胜负
 */
export const PHASE_TRANSITIONS: Record<Phase, readonly Phase[]> = {
  describing: ['voting'],
  voting: ['voting', 'describing', 'finished'],
  finished: [],
};

export function legalActions(phase: Phase): readonly GameAction[] {
  return PHASE_ACTIONS[phase];
}

export function canAct(phase: Phase, action: GameAction): boolean {
  return PHASE_ACTIONS[phase].includes(action);
}

export function canTransition(from: Phase, to: Phase): boolean {
  return PHASE_TRANSITIONS[from].includes(to);
}
