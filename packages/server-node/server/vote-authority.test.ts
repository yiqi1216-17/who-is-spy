import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';
import type { AgentContext, VoteTarget } from './types.js';

/**
 * 投票边界的隐私 × 授权双回归(OpenSpec 03 · Task 6.4 · 两份独立评审的收敛缺陷)
 *
 * 两位互相独立的评审员(隐私审计 + 架构审计)不约而同指到同一处 generateVotes:
 *   ①×M(隐私):曾把完整 `Player[]`(挟带 role/word)作为 vote 第二参递给模型——机密靠
 *     适配器"自觉不读"来兜底,而**哨兵扫描只记录第一个参数(context)**,越界通道对扫描隐形。
 *   [HIGH](授权):AI 返回的 targetId 合法性被托付给模型;越界/自投/已出局的 id 可直达
 *     resolveBallot,轻则计票污染、重则 `find(id)===undefined` 抛 500,状态被腐坏。
 *
 * 结构性封堵后,这两条不变量必须由**类型 + 确定性代码**保证,而非模型的自律:
 *   1. vote 第二参在结构上只含 {id,name,isHuman,alive},机密无从随之越界(哪怕模型想读也没有)。
 *   2. targetId 的合法性由引擎重新裁决;非法一律回落到确定性首选合法目标,绝不腐坏对局。
 */

const DETERMINISTIC = () => 0;

/** 记录每次 vote 收到的**第二参**(此前哨兵扫描的盲区),返回合法目标以免干扰隐私断言。 */
class TargetRecordingModel extends FakeGameModel {
  readonly seenTargets: VoteTarget[][] = [];
  async vote(
    _context: AgentContext,
    allowedTargets: VoteTarget[],
  ): Promise<{ targetId: string; reason: string }> {
    this.seenTargets.push(structuredClone(allowedTargets));
    return { targetId: allowedTargets[0].id, reason: '记录用合法投票' };
  }
}

/** 恒返回一个**不存在**的目标 id:未加裁决时会让 resolveBallot 的 find 落空并抛 500。 */
class GhostVoteModel extends FakeGameModel {
  async vote(): Promise<{ targetId: string; reason: string }> {
    return { targetId: 'ghost-nobody', reason: '越界目标(测试注入)' };
  }
}

/** 恒返回**投票者自己**的 id(自投,永远不在 allowedTargets 内):未加裁决时会污染计票。 */
class SelfVoteModel extends FakeGameModel {
  async vote(
    context: AgentContext,
  ): Promise<{ targetId: string; reason: string }> {
    return { targetId: context.identity.playerId, reason: '自投(测试注入)' };
  }
}

async function reachVoting(engine: GameEngine): Promise<string> {
  const game = engine.createGame();
  await engine.submitHumanDescription(game.id, '人类给出的一句独特描述');
  return game.id;
}

describe('投票隐私 · vote 第二参在结构上不含任何机密', () => {
  it('每个候选只暴露 {id,name,isHuman,alive},role/word/密词无从越界(封堵哨兵盲区)', async () => {
    const model = new TargetRecordingModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const id = await reachVoting(engine);

    await engine.submitHumanVote(id, 'ai-1');

    // 四名存活 AI 各投一次,每次收到 4 个候选(5 存活 − 自己)。
    expect(model.seenTargets).toHaveLength(4);
    for (const targets of model.seenTargets) {
      expect(targets).toHaveLength(4);
      for (const t of targets) {
        // 键集必须**恰好**是这四个非机密字段——多一个都算越界。
        expect(Object.keys(t).sort()).toEqual(['alive', 'id', 'isHuman', 'name']);
      }
    }
    // 整个第二参序列化后不得出现任何机密字段名或密词字面量。
    const serialized = JSON.stringify(model.seenTargets);
    for (const secret of ['role', 'word', '卡布奇诺', '拿铁', 'civilian', 'undercover']) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('投票授权 · targetId 合法性由引擎裁决而非模型', () => {
  it('模型返回不存在的目标 id 时,引擎回落到合法目标,而非 find 落空崩溃', async () => {
    const model = new GhostVoteModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const id = await reachVoting(engine);

    // 未加裁决时,四张 ghost 票会让 resolveBallot 的 find(id) 落空并抛 500;这里必须平稳收束。
    const after = await engine.submitHumanVote(id, 'ai-1');

    const realIds = new Set(after.players.map((p) => p.id));
    expect(after.players.filter((p) => p.alive)).toHaveLength(4); // 恰一人出局,未腐坏
    for (const vote of after.votes) {
      expect(vote.targetId).not.toBe('ghost-nobody'); // 越界目标被改判
      expect(realIds.has(vote.targetId)).toBe(true); // 目标必为真实存在的玩家
      expect(vote.voterId).not.toBe(vote.targetId); // 且不是自投
    }
  });

  it('模型试图自投(非法目标)时,引擎改判为确定性合法目标,且无一张自投票落地', async () => {
    const model = new SelfVoteModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const id = await reachVoting(engine);

    const after = await engine.submitHumanVote(id, 'ai-1');

    expect(after.players.filter((p) => p.alive)).toHaveLength(4);
    // 每一张落地的选票都指向"他人",没有任何一张自投穿透到计票。
    for (const vote of after.votes) {
      expect(vote.voterId).not.toBe(vote.targetId);
    }
  });
});
