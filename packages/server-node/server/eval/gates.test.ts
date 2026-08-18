import { describe, expect, it } from 'vitest';
import { parseVersioned } from '../schema.js';
import { FakeGameModel } from '../test-utils.js';
import type { AgentContext, Description, GameState, Player, Role, Vote } from '../types.js';
import { buildReport, evaluateGates, evaluateSelfPlay, scanReportSentinels } from './report.js';
import { aggregate, extractGameMetrics } from './metrics.js';
import { runSelfPlayBatch } from './self-play.js';
import type { SelfPlayResult } from './self-play.js';

/**
 * 确定性非零门禁(OpenSpec 04 · Task 2.3)+ 报告逐字节稳定(Task 1.2)。
 * 证明:泄题 / 非法动作 / 未完成 / 隐私哨兵 / 阈值突破任一命中都会让门禁 `passed=false`;
 * 干净 fixture 稳过且报告通过版本信封校验;同批两次运行的报告 JSON 完全一致。
 */

function player(id: string, role: Role, word: string): Player {
  return { id, name: id, avatar: id, isHuman: id === 'human', role, word, alive: true };
}

function craft(overrides: {
  descriptions?: Description[];
  votes?: Vote[];
  completed?: boolean;
}): SelfPlayResult {
  const players = [
    player('human', 'civilian', '拿铁'),
    player('ai-1', 'undercover', '卡布奇诺'),
    player('ai-2', 'civilian', '拿铁'),
    player('ai-3', 'civilian', '拿铁'),
    player('ai-4', 'civilian', '拿铁'),
  ];
  const internal: GameState = {
    id: 'g',
    phase: 'finished',
    round: 1,
    ballot: 1,
    players,
    descriptions: overrides.descriptions ?? [],
    votes: overrides.votes ?? [],
    events: [],
    eligibleTargetIds: null,
    winner: 'civilian',
    review: null,
    createdAt: 0,
  };
  return {
    gameId: 'g',
    internal,
    beliefs: {},
    calls: { describeCalls: 4, voteCalls: 4, reviewCalls: 1 },
    completed: overrides.completed ?? true,
  };
}

function gateOf(results: SelfPlayResult[], thresholds?: Parameters<typeof evaluateSelfPlay>[1]['thresholds']) {
  return evaluateSelfPlay(results, { suite: 'test', milestone: 'B3', thresholds }).gate;
}

describe('干净 fixture · 门禁通过 + 报告合规', () => {
  it('8 局假模型自博弈:门禁全绿,报告过版本信封校验,sampleSize 一致', async () => {
    const results = await runSelfPlayBatch(new FakeGameModel(), { games: 8, seed: 1 });
    const { report, gate } = evaluateSelfPlay(results, { suite: 'fixture', milestone: 'B3-current' });
    expect(gate.passed).toBe(true);
    expect(gate.failures).toHaveLength(0);
    // 报告必须能被版本信封解回(strict 校验:metrics 每行恰 {key,value,n})。
    const data = parseVersioned('report', report);
    expect(data.sampleSize).toBe(8);
    expect(data.metrics.length).toBeGreaterThan(10);
    // 关键指标存在且数值合理。
    const byKey = new Map(data.metrics.map((m) => [m.key, m]));
    expect(byKey.get('leak_count')?.value).toBe(0);
    expect(byKey.get('illegal_vote_count')?.value).toBe(0);
    expect(byKey.get('completion_rate')?.value).toBe(1);
    expect(byKey.get('strategy_distinguishability')?.value).toBeGreaterThan(0.5);
  });
});

describe('报告逐字节稳定(Task 1.2)', () => {
  it('同 seed 同批两次运行,报告 JSON 完全一致', async () => {
    const a = await runSelfPlayBatch(new FakeGameModel(), { games: 6, seed: 3 });
    const b = await runSelfPlayBatch(new FakeGameModel(), { games: 6, seed: 3 });
    const ra = evaluateSelfPlay(a, { suite: 's', milestone: 'm' }).report;
    const rb = evaluateSelfPlay(b, { suite: 's', milestone: 'm' }).report;
    expect(JSON.stringify(ra)).toBe(JSON.stringify(rb));
  });
});

describe('门禁 · 泄题(secret_leak)', () => {
  it('AI 描述含自身密词 → 门禁失败并给出 secret_leak', () => {
    const leaked = craft({
      descriptions: [
        { playerId: 'ai-1', text: '就是卡布奇诺', round: 1 }, // 卧底泄自身密词
        { playerId: 'ai-2', text: '一种温热饮品', round: 1 },
      ],
    });
    const gate = gateOf([leaked]);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.code === 'secret_leak')).toBe(true);
  });
});

describe('门禁 · 非法动作(illegal_action)', () => {
  it('AI 幽灵票 / 自投 → 门禁失败并给出 illegal_action', () => {
    const illegal = craft({
      votes: [
        { voterId: 'ai-1', targetId: 'ghost', reason: 'r', round: 1, ballot: 1 },
        { voterId: 'ai-2', targetId: 'ai-1', reason: 'r', round: 1, ballot: 1 },
      ],
    });
    const gate = gateOf([illegal]);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.code === 'illegal_action')).toBe(true);
  });
});

describe('门禁 · 未完成对局(incomplete_game)', () => {
  /** 注入泄题模型 → 质量穷尽 → 原子终止 → 完成率 < 1 → 门禁失败。 */
  class LeakyModel extends FakeGameModel {
    async describe(context: AgentContext): Promise<string> {
      return context.identity.word;
    }
  }
  it('批量含未完成对局 → completion_rate<1 → incomplete_game 触发,非零退出信号', async () => {
    const results = await runSelfPlayBatch(new LeakyModel(), { games: 3, seed: 1 });
    const gate = gateOf(results);
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.code === 'incomplete_game')).toBe(true);
  });
});

describe('门禁 · 阈值突破(threshold)', () => {
  it('把可区分率下限设为不可能的 1.1 → threshold_distinguishability 触发', async () => {
    const results = await runSelfPlayBatch(new FakeGameModel(), { games: 4, seed: 1 });
    const gate = gateOf(results, {
      minCompletionRate: 1,
      minDiversityRate: 0,
      minStrategyDistinguishability: 1.1,
      minBeliefHitRate: 0,
    });
    expect(gate.passed).toBe(false);
    expect(gate.failures.some((f) => f.code === 'threshold_distinguishability')).toBe(true);
  });
});

describe('门禁 · 隐私哨兵(privacy_sentinel)', () => {
  it('把密词偷渡进 suite 串 → 哨兵扫描命中', () => {
    // 直接构造一份 suite 含密词「拿铁」的报告,证明哨兵能拦住报告工件里的机密字面量。
    const report = buildReport('拿铁-suite', 'B3', []);
    const failures = scanReportSentinels(report);
    expect(failures.some((f) => f.code === 'privacy_sentinel')).toBe(true);
  });

  it('正常 fixture 报告哨兵零命中', async () => {
    const results = await runSelfPlayBatch(new FakeGameModel(), { games: 4, seed: 1 });
    const report = evaluateSelfPlay(results, { suite: 'fixture', milestone: 'B3' }).report;
    expect(scanReportSentinels(report)).toHaveLength(0);
  });
});

describe('聚合口径 · 分母与不确定度', () => {
  it('每个比率指标都带非负分母 n;比率类附 ci95 行', async () => {
    const results = await runSelfPlayBatch(new FakeGameModel(), { games: 5, seed: 2 });
    const agg = aggregate(results.map(extractGameMetrics));
    for (const m of agg.metrics) {
      expect(Number.isFinite(m.value)).toBe(true);
      expect(Number.isInteger(m.n)).toBe(true);
      expect(m.n).toBeGreaterThanOrEqual(0);
    }
    const keys = new Set(agg.metrics.map((m) => m.key));
    expect(keys.has('completion_rate_ci95')).toBe(true);
    expect(keys.has('belief_hit_rate_ci95')).toBe(true);
    expect(keys.has('strategy_distinguishability_ci95')).toBe(true);
  });
});
