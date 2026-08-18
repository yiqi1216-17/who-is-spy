import { describe, expect, it } from 'vitest';
import { buildAgentContext } from './agent-context.js';
import { strategyForAgent } from './strategies.js';
import { emptyBelief, observeRound } from './beliefs.js';
import type { GameState, Player, StrategyView } from './types.js';

/**
 * §6.1 · 配对消融证明(OpenSpec 03 · Task 6.1)
 *
 * 对三条改造轴,在**同一 scenario + 同一 seed** 下对照 baseline(病)与 improved(愈),
 * 断言一个可度量的 delta。这把散落在 orchestration/persona/quality/beliefs 各测试里的
 * 反转,收敛成一张"病 → 愈"的消融表,便于现场投屏对照。
 *
 *   轴A 顺序编排(§5.3):后发者可见的"本轮先发公开描述"条数  baseline 0 → improved 3
 *   轴B 人设策略(§4)  :四 AI 的可区分人设数              baseline 1 → improved 4
 *   轴C 信念校准(§5.1):离群者与随大流者的怀疑度差         baseline 0 → improved >0
 */

const NEUTRAL_STRATEGY: StrategyView = {
  persona: '(无策略通道)',
  tactics: [],
  specificity: 0,
  novelty: 0,
  risk: 0,
};

function player(id: string, name: string, isHuman = false): Player {
  return { id, name, avatar: name[0], isHuman, role: 'civilian', word: '拿铁', alive: true };
}

/** 固定 scenario:第 1 轮,human / ai-1 / ai-2 已公开描述,轮到后发的 ai-3。 */
function scenario(): { game: GameState; speaker: Player } {
  const players: Player[] = [
    player('human', '你', true),
    player('ai-1', '阿序'),
    player('ai-2', '弥生'),
    player('ai-3', '老墨'),
    player('ai-4', '小满'),
  ];
  const game: GameState = {
    id: 'ablation',
    phase: 'describing',
    round: 1,
    ballot: 1,
    players,
    descriptions: [
      { playerId: 'human', text: '早晨常喝的那种带奶的热饮', round: 1 },
      { playerId: 'ai-1', text: '咖啡馆里点得最多的一杯', round: 1 },
      { playerId: 'ai-2', text: '奶香和微苦平衡得刚好', round: 1 },
    ],
    votes: [],
    events: [],
    eligibleTargetIds: null,
    winner: null,
    review: null,
    createdAt: 1,
  };
  return { game, speaker: players[3] }; // ai-3
}

describe('§6.1 · 轴A 顺序编排消融', () => {
  it('baseline(并行快照)后发者看不到本轮先发;improved(座次串行)看得到 3 条', () => {
    const { game, speaker } = scenario();

    // baseline:并行 —— 每个 Agent 只见开局快照(本轮尚无任何公开描述)
    const openingSnapshot: GameState = { ...game, descriptions: [] };
    const baselineCtx = buildAgentContext(openingSnapshot, speaker);
    const baselineVisible = baselineCtx.game.publicDescriptions.filter(
      (d) => d.round === 1 && d.playerId !== speaker.id,
    ).length;

    // improved:座次串行 —— 后发者看到本轮 human/ai-1/ai-2 的公开描述
    const improvedCtx = buildAgentContext(game, speaker);
    const improvedVisible = improvedCtx.game.publicDescriptions.filter(
      (d) => d.round === 1 && d.playerId !== speaker.id,
    ).length;

    expect(baselineVisible).toBe(0);
    expect(improvedVisible).toBe(3);
    expect(improvedVisible).toBeGreaterThan(baselineVisible);
  });
});

describe('§6.1 · 轴B 人设策略消融', () => {
  it('baseline(无策略通道)四 AI 人设同质=1;improved(版本化策略)可区分=4', () => {
    const { game } = scenario();
    const ais = game.players.filter((p) => !p.isHuman);

    const baselinePersonas = new Set(
      ais.map((a) => buildAgentContext(game, a, NEUTRAL_STRATEGY).strategy.persona),
    );
    const improvedPersonas = new Set(
      ais.map((a) => buildAgentContext(game, a, strategyForAgent(a)).strategy.persona),
    );

    expect(baselinePersonas.size).toBe(1);
    expect(improvedPersonas.size).toBe(4);
  });
});

describe('§6.1 · 轴C 信念校准消融', () => {
  it('baseline(无信念)怀疑度无差;improved(observeRound)离群者更可疑', () => {
    // 同一轮:ai-3 明显离群,ai-2/ai-4 随大流。
    const round = {
      round: 1,
      selfId: 'ai-1',
      descriptions: [
        { playerId: 'ai-1', text: '一杯常见的热饮' },
        { playerId: 'ai-2', text: '一杯常见的热饮料' },
        { playerId: 'ai-4', text: '常见的一杯热饮品' },
        { playerId: 'ai-3', text: '深夜呼啸而过的地铁列车' },
      ],
    };

    // baseline:没有信念更新 —— 对谁都没有校准信号
    const baseline = emptyBelief();
    const baselineOutlier = baseline.suspicions.find((s) => s.playerId === 'ai-3')?.score ?? 0;
    const baselineBlender = baseline.suspicions.find((s) => s.playerId === 'ai-2')?.score ?? 0;

    // improved:observeRound 之后 —— 离群者怀疑度显著高于随大流者
    const improved = observeRound(emptyBelief(), round);
    const outlier = improved.suspicions.find((s) => s.playerId === 'ai-3')!.score;
    const blender = improved.suspicions.find((s) => s.playerId === 'ai-2')!.score;

    expect(baselineOutlier - baselineBlender).toBe(0);
    expect(outlier - blender).toBeGreaterThan(0);
    expect(outlier).toBeGreaterThan(blender);
  });
});
