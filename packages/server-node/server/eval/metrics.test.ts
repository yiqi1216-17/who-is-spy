import { describe, expect, it } from 'vitest';
import type { Belief } from '../schema.js';
import type { Description, GameState, Player, Role, Vote } from '../types.js';
import { extractGameMetrics } from './metrics.js';
import type { SelfPlayResult } from './self-play.js';

/**
 * 指标抽取的纯函数正确性(OpenSpec 04 · Task 2.2)。
 * 用**手搓快照**精确钉住:泄题计数、非法票计数、同轮跨 AI 差异化、自我重复、信念校准命中。
 * 不经引擎 → 可注入引擎结构上不可能出现的越界样本(泄题/幽灵票),验证指标**能真的看见**它们。
 */

function player(id: string, role: Role, word: string, alive = true): Player {
  return { id, name: id, avatar: id, isHuman: id === 'human', role, word, alive };
}

function desc(playerId: string, text: string, round: number): Description {
  return { playerId, text, round };
}

function vote(voterId: string, targetId: string, round = 1, ballot = 1): Vote {
  return { voterId, targetId, reason: 'r', round, ballot };
}

function belief(suspicions: Array<[string, number]>): Belief {
  return {
    round: 1,
    suspicions: suspicions.map(([playerId, score]) => ({ playerId, score })),
    selfExposure: 0,
    evidenceRefs: [],
  };
}

function makeResult(overrides: {
  players: Player[];
  descriptions?: Description[];
  votes?: Vote[];
  winner?: Role | null;
  round?: number;
  beliefs?: Record<string, Belief>;
  completed?: boolean;
  describeCalls?: number;
}): SelfPlayResult {
  const internal: GameState = {
    id: 'g',
    phase: 'finished',
    round: overrides.round ?? 1,
    ballot: 1,
    players: overrides.players,
    descriptions: overrides.descriptions ?? [],
    votes: overrides.votes ?? [],
    events: [],
    eligibleTargetIds: null,
    winner: overrides.winner ?? 'civilian',
    review: null,
    createdAt: 0,
  };
  const aiDescs = internal.descriptions.filter((d) => d.playerId !== 'human').length;
  return {
    gameId: 'g',
    internal,
    beliefs: overrides.beliefs ?? {},
    calls: { describeCalls: overrides.describeCalls ?? aiDescs, voteCalls: 4, reviewCalls: 1 },
    completed: overrides.completed ?? true,
  };
}

const FOUR_PLAYERS = (): Player[] => [
  player('human', 'civilian', '拿铁'),
  player('ai-1', 'undercover', '卡布奇诺'),
  player('ai-2', 'civilian', '拿铁'),
  player('ai-3', 'civilian', '拿铁'),
  player('ai-4', 'civilian', '拿铁'),
];

describe('泄题计数', () => {
  it('AI 描述含自身密词记为泄题;人类描述不计入', () => {
    const result = makeResult({
      players: FOUR_PLAYERS(),
      descriptions: [
        desc('human', '拿铁真好喝', 1), // 人类含词 → 不计(评测只看 AI)
        desc('ai-1', '我的词是卡布奇诺', 1), // AI 卧底含自身密词 → 泄题
        desc('ai-2', '一种安静的饮品', 1),
        desc('ai-3', '带点奶香', 1),
        desc('ai-4', '午后常见', 1),
      ],
    });
    const m = extractGameMetrics(result);
    expect(m.leakCount).toBe(1);
    expect(m.aiDescriptionCount).toBe(4);
  });
});

describe('非法票计数', () => {
  it('目标为幽灵 id 或自投都计非法;人类票不计入', () => {
    const result = makeResult({
      players: FOUR_PLAYERS(),
      votes: [
        vote('human', 'ai-1'), // 合法人类票 → 不计(只看 AI)
        vote('ai-1', 'ghost'), // 幽灵目标 → 非法
        vote('ai-2', 'ai-2'), // 自投 → 非法
        vote('ai-3', 'ai-1'), // 合法
        vote('ai-4', 'ai-1'), // 合法
      ],
    });
    const m = extractGameMetrics(result);
    expect(m.illegalVoteCount).toBe(2);
    expect(m.aiVoteCount).toBe(4);
  });
});

describe('差异化:同轮跨 AI 描述', () => {
  it('四条互异描述 → 6 对全可区分、多样度高', () => {
    const result = makeResult({
      players: FOUR_PLAYERS(),
      descriptions: [
        desc('ai-1', '温热的午后时光很惬意', 1),
        desc('ai-2', '钢铁机械冷硬的质感', 1),
        desc('ai-3', '森林里潮湿的青苔气息', 1),
        desc('ai-4', '数字屏幕闪烁的蓝光', 1),
      ],
    });
    const m = extractGameMetrics(result);
    expect(m.crossAgentPairs).toBe(6); // C(4,2)
    expect(m.distinguishablePairs).toBe(6); // 互异 → 全部低于相似度阈值
    expect(m.diversitySum).toBeGreaterThan(5); // 每对 (1−sim)≈1
  });

  it('两条完全相同描述 → 该对不可区分、贡献多样度≈0', () => {
    const result = makeResult({
      players: FOUR_PLAYERS().slice(0, 3).concat(FOUR_PLAYERS()[3]),
      descriptions: [
        desc('ai-1', '完全一样的一句话', 1),
        desc('ai-2', '完全一样的一句话', 1),
      ],
    });
    const m = extractGameMetrics(result);
    expect(m.crossAgentPairs).toBe(1);
    expect(m.distinguishablePairs).toBe(0); // 相同 → 相似度=1 ≥ 阈值
    expect(m.diversitySum).toBeCloseTo(0, 5);
  });
});

describe('自我重复:同一 AI 相邻两轮', () => {
  it('同一 AI 两轮几乎逐字重复 → 高自我重复相似度', () => {
    const result = makeResult({
      players: FOUR_PLAYERS(),
      round: 2,
      descriptions: [
        desc('ai-1', '这是一段很长的固定描述用来测重复', 1),
        desc('ai-1', '这是一段很长的固定描述用来测重复', 2),
      ],
    });
    const m = extractGameMetrics(result);
    expect(m.selfRepeatPairs).toBe(1);
    expect(m.selfRepeatSum).toBeGreaterThan(0.9);
  });
});

describe('信念校准:最高怀疑是否命中真卧底', () => {
  it('平民 AI 最高怀疑指向真卧底 → 命中;卧底自身不入分母', () => {
    const result = makeResult({
      players: FOUR_PLAYERS(), // ai-1 是卧底
      beliefs: {
        // ai-1 是卧底:即便给它信念也应被排除出 hunter 分母
        'ai-1': belief([['ai-2', 0.9]]),
        'ai-2': belief([['ai-1', 0.8], ['ai-3', 0.2]]), // 命中
        'ai-3': belief([['ai-1', 0.7], ['ai-2', 0.3]]), // 命中
        'ai-4': belief([['ai-2', 0.6], ['ai-1', 0.5]]), // 未命中(最高是 ai-2)
      },
    });
    const m = extractGameMetrics(result);
    expect(m.hunters).toBe(3); // ai-2/3/4,排除卧底 ai-1
    expect(m.beliefHits).toBe(2); // ai-2、ai-3 命中
    expect(m.suspicionGapSum).toBeGreaterThan(0); // 平均对真卧底更怀疑
  });

  it('无信念时 hunter 分母为 0,不产生除零', () => {
    const m = extractGameMetrics(makeResult({ players: FOUR_PLAYERS(), beliefs: {} }));
    expect(m.hunters).toBe(0);
    expect(m.beliefHits).toBe(0);
    expect(m.suspicionGapSum).toBe(0);
  });
});

describe('重试代理:describe 调用数 − 落地描述数', () => {
  it('调用数多于落地描述 → 记为重试', () => {
    const result = makeResult({
      players: FOUR_PLAYERS(),
      descriptions: [desc('ai-1', 'x一段描述', 1), desc('ai-2', 'y另一段', 1)],
      describeCalls: 5, // 2 条落地 + 3 次被质量门驳回的重试
    });
    const m = extractGameMetrics(result);
    expect(m.describeRetries).toBe(3);
  });
});
