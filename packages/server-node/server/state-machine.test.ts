import { describe, expect, it } from 'vitest';
import {
  PHASE_ACTIONS,
  PHASE_TRANSITIONS,
  canAct,
  canTransition,
  legalActions,
  type GameAction,
} from './state-machine.js';
import type { Phase } from './types.js';

/**
 * A2 · 显式域状态机(OpenSpec 03 · Task 2.2)
 *
 * 把"相位允许哪些动作 / 相位如何转移"从引擎里散落的 if 抽成一张显式转移表。
 * 现场任务④(临场规则变体)的落点:新规则 = 改这张表 + 加一条转移表测试,
 * 不必翻动编排/契约代码。
 */

const ALL_PHASES: Phase[] = ['describing', 'voting', 'finished'];
const ALL_ACTIONS: GameAction[] = ['describe', 'vote'];

describe('A2 · 动作合法性(相位 × 动作)', () => {
  it('每个相位只允许表中列出的动作', () => {
    expect(legalActions('describing')).toEqual(['describe']);
    expect(legalActions('voting')).toEqual(['vote']);
    expect(legalActions('finished')).toEqual([]);
  });

  it('describe 只在 describing、vote 只在 voting 合法', () => {
    expect(canAct('describing', 'describe')).toBe(true);
    expect(canAct('voting', 'describe')).toBe(false);
    expect(canAct('finished', 'describe')).toBe(false);

    expect(canAct('voting', 'vote')).toBe(true);
    expect(canAct('describing', 'vote')).toBe(false);
    expect(canAct('finished', 'vote')).toBe(false);
  });

  it('canAct 与 PHASE_ACTIONS 表在整张 相位×动作 网格上一致', () => {
    for (const phase of ALL_PHASES) {
      for (const action of ALL_ACTIONS) {
        expect(canAct(phase, action)).toBe(PHASE_ACTIONS[phase].includes(action));
      }
    }
  });
});

describe('A2 · 相位转移', () => {
  it('合法转移:describing→voting、voting→{voting,describing,finished}', () => {
    expect(canTransition('describing', 'voting')).toBe(true);
    expect(canTransition('voting', 'voting')).toBe(true); // 同票加票,留在投票
    expect(canTransition('voting', 'describing')).toBe(true); // 淘汰后进入下一轮
    expect(canTransition('voting', 'finished')).toBe(true); // 淘汰后分出胜负
  });

  it('非法转移被拒:跳过投票、回到自身描述、从终局复活', () => {
    expect(canTransition('describing', 'finished')).toBe(false);
    expect(canTransition('describing', 'describing')).toBe(false);
    expect(canTransition('finished', 'describing')).toBe(false);
    expect(canTransition('finished', 'voting')).toBe(false);
    expect(canTransition('finished', 'finished')).toBe(false);
  });

  it('canTransition 与 PHASE_TRANSITIONS 表在整张 相位×相位 网格上一致', () => {
    for (const from of ALL_PHASES) {
      for (const to of ALL_PHASES) {
        expect(canTransition(from, to)).toBe(PHASE_TRANSITIONS[from].includes(to));
      }
    }
  });

  it('finished 是终态:无出边、无动作', () => {
    expect(PHASE_TRANSITIONS.finished).toEqual([]);
    expect(PHASE_ACTIONS.finished).toEqual([]);
  });
});
