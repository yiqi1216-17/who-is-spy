import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';
import type { AgentContext, VoteTarget } from './types.js';

/**
 * B5 · 隐藏投票(OpenSpec 03 · Task 5.4)
 *
 * 两条投票阶段的不变量:
 *   1. 后投的 AI 看不到本轮**未结算**的选票——选票在结构上根本不进 AgentContext。
 *   2. 目标与 ballot 的裁决权留在**确定性代码**里(平票→加票由引擎驱动,模型无从干预)。
 */

const DETERMINISTIC = () => 0;

/** 固定映射投票,制造一次五方平票,用于验证 ballot 裁决权在代码侧。 */
const VOTE_MAP: Record<string, string> = {
  'ai-1': 'human',
  'ai-2': 'ai-3',
  'ai-3': 'ai-4',
  'ai-4': 'ai-2',
};

class SplitVoteModel extends FakeGameModel {
  async vote(
    context: AgentContext,
    allowedTargets: VoteTarget[],
  ): Promise<{ targetId: string; reason: string }> {
    this.voteContexts.push(structuredClone(context));
    const want = VOTE_MAP[context.identity.playerId];
    const target = allowedTargets.find((p) => p.id === want) ?? allowedTargets[0];
    return { targetId: target.id, reason: '固定映射投票' };
  }
}

async function reachVoting(engine: GameEngine): Promise<string> {
  const game = engine.createGame();
  await engine.submitHumanDescription(game.id, '人类给出的一句独特描述');
  return game.id;
}

describe('B5 · 隐藏投票 · 未结算选票不可见', () => {
  it('每个 AI 投票上下文只含 identity/strategy/game,绝无任何选票或 ballot 字段', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const id = await reachVoting(engine);

    await engine.submitHumanVote(id, 'ai-1');

    expect(model.voteContexts).toHaveLength(4);
    for (const ctx of model.voteContexts) {
      expect(Object.keys(ctx).sort()).toEqual(['game', 'identity', 'strategy']);
      // game 投影里没有 votes/ballot 之类的通道
      expect(Object.keys(ctx.game)).not.toContain('votes');
      expect(Object.keys(ctx.game)).not.toContain('ballot');
    }
    // 任何投票理由都不曾出现在某个 AI 的上下文中(后投者读不到先投者的选择)
    const serialized = JSON.stringify(model.voteContexts);
    for (const leak of ['targetId', 'voterId', 'ballot', '固定映射投票', '措辞最可疑']) {
      expect(serialized).not.toContain(leak);
    }
  });
});

describe('B5 · 隐藏投票 · 裁决权在确定性代码', () => {
  it('五方平票时由引擎升入 ballot 2 并给出加票名单,模型无从干预', async () => {
    const model = new SplitVoteModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const id = await reachVoting(engine);

    const afterFirst = await engine.submitHumanVote(id, 'ai-1');

    // 平票未淘汰任何人,而是由代码升入第二票
    expect(afterFirst.phase).toBe('voting');
    expect(afterFirst.ballot).toBe(2);
    expect(afterFirst.eligibleTargetIds).not.toBeNull();
    expect(afterFirst.eligibleTargetIds).toHaveLength(5);
    expect(afterFirst.players.every((p) => p.alive)).toBe(true);
  });
});
