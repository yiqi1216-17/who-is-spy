import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';
import type { PublicGameState } from './types.js';

/**
 * §6.2 · 哨兵越界证明(OpenSpec 03 · Task 6.2)—— 全局收口
 *
 * 跑一整局确定性对局到终局,捕获三类跨界工件:
 *   - model 边界:FakeGameModel 记下的每一次 describe / vote 上下文;
 *   - hook 边界:注册的观察者收到的每一份 onRoundPublished 投影;
 *   - 公开 DTO 边界:每一步返回的 PublicGameState 快照(区分终局前 / 终局)。
 * 再对五类哨兵逐一断言:它们绝不越过上述任一边界(持久化边界以"可导出的公开 DTO"为代表)。
 *
 * 五类哨兵:①终局前他人 role/word ②跨 Agent 信念 ③完整内部状态 ④私有 prompt/策略溯源 ⑤未结算票。
 *
 * 种子 () => 0 下:human=卧底(卡布奇诺),ai-1..4=平民(拿铁)。故:
 *   - "卡布奇诺" 是他人(卧底)的词:任一 AI 的 model 上下文里都不该出现;
 *   - "undercover" 在四个平民 AI 的上下文里也不该出现(它们的 identity.role 均为 civilian)。
 */

const DETERMINISTIC = () => 0;

/** 信念结构标记:任何边界工件里出现即为跨 Agent 信念泄漏。 */
const BELIEF_MARKERS = ['suspicions', 'selfExposure', 'evidenceRefs'];
/** 内部完整状态独有字段:投影后不该出现。 */
const INTERNAL_MARKERS = ['createdAt'];
/** 策略溯源 / 私有原型元数据:投影严格剥离,不该出现在任何跨界工件。 */
const PROVENANCE_MARKERS = ['provenance', 'synthetic', 'sampleIds', 'cautious-observer'];
/** 未结算票标记:选票结构绝不进 model 上下文。 */
const VOTE_MARKERS = ['voterId'];

interface Swept {
  modelContexts: string[]; // 每个 describe/vote 上下文的 JSON
  hookPayloads: string[];
  preFinalePublic: PublicGameState[];
  finalePublic: PublicGameState;
}

async function playToFinish(): Promise<{ swept: Swept; engine: GameEngine; gameId: string }> {
  const model = new FakeGameModel();
  const engine = new GameEngine(model, DETERMINISTIC);
  const hookPayloads: string[] = [];
  engine.registerRoundHook('sentinel-audit', (p) => void hookPayloads.push(JSON.stringify(p)));

  const snapshots: PublicGameState[] = [];
  let state = engine.createGame();
  const gameId = state.id;
  snapshots.push(state);

  let guard = 0;
  while (state.phase !== 'finished' && guard < 30) {
    guard += 1;
    const human = state.players.find((p) => p.isHuman)!;
    if (state.phase === 'describing') {
      state = human.alive
        ? await engine.submitHumanDescription(gameId, `人类在第 ${state.round} 轮给出的独特描述`)
        : await engine.continueAsSpectator(gameId);
    } else {
      if (human.alive) {
        const target = state.players.find((p) => !p.isHuman && p.alive)!;
        state = await engine.submitHumanVote(gameId, target.id);
      } else {
        state = await engine.continueAsSpectator(gameId);
      }
    }
    snapshots.push(state);
  }

  expect(state.phase).toBe('finished');
  const swept: Swept = {
    modelContexts: [...model.descriptionContexts, ...model.voteContexts].map((c) => JSON.stringify(c)),
    hookPayloads,
    preFinalePublic: snapshots.filter((s) => s.phase !== 'finished'),
    finalePublic: state,
  };
  return { swept, engine, gameId };
}

describe('§6.2 · 哨兵越界证明(全局收口)', () => {
  it('捕获到足量的跨界工件(model 上下文 / hook 投影 / 公开快照)', async () => {
    const { swept } = await playToFinish();
    expect(swept.modelContexts.length).toBeGreaterThanOrEqual(4);
    expect(swept.hookPayloads.length).toBeGreaterThanOrEqual(1);
    expect(swept.preFinalePublic.length).toBeGreaterThanOrEqual(2);
  });

  it('① 终局前他人 role/word:公开 DTO 不揭示任何玩家的 revealedRole/revealedWord', async () => {
    const { swept } = await playToFinish();
    for (const snap of swept.preFinalePublic) {
      for (const p of snap.players) {
        expect(p.revealedRole).toBeUndefined();
        expect(p.revealedWord).toBeUndefined();
      }
    }
    // 终局才揭示,证明"揭示点"存在且被推迟到终局。
    for (const p of swept.finalePublic.players) {
      expect(p.revealedRole).toBeDefined();
      expect(p.revealedWord).toBeDefined();
    }
  });

  it('① 他人的词/角色绝不进任一 AI 的 model 上下文(卧底词与 undercover 都不出现)', async () => {
    const { swept } = await playToFinish();
    for (const ctx of swept.modelContexts) {
      const parsed = JSON.parse(ctx) as { identity: { role: string; word: string } };
      // 每个上下文只带自己的身份(平民),他人的卧底词/角色都不出现
      expect(parsed.identity.role).toBe('civilian');
      expect(ctx).not.toContain('卡布奇诺'); // 卧底(他人)的词
      expect(ctx).not.toContain('undercover'); // 场上唯一卧底是人类,不属于任何 AI 上下文
    }
    // hook 投影是纯公开信息,词与角色一律不出现
    for (const payload of swept.hookPayloads) {
      for (const marker of ['卡布奇诺', '拿铁', 'undercover', 'civilian']) {
        expect(payload).not.toContain(marker);
      }
    }
  });

  it('② 跨 Agent 信念:信念存在于私有存储,但绝不进 model / hook / 公开 DTO', async () => {
    const { swept, engine, gameId } = await playToFinish();
    // 私有信念确实被计算并留存(至少 ai-1)
    expect(engine.getAgentBelief(gameId, 'ai-1')).toBeDefined();
    const boundaries = [
      ...swept.modelContexts,
      ...swept.hookPayloads,
      ...swept.preFinalePublic.map((s) => JSON.stringify(s)),
      JSON.stringify(swept.finalePublic),
    ];
    for (const artifact of boundaries) {
      for (const marker of BELIEF_MARKERS) expect(artifact).not.toContain(marker);
    }
  });

  it('③ 完整内部状态:内部独有字段(createdAt)不进 model / hook / 公开 DTO', async () => {
    const { swept } = await playToFinish();
    const boundaries = [
      ...swept.modelContexts,
      ...swept.hookPayloads,
      ...swept.preFinalePublic.map((s) => JSON.stringify(s)),
      JSON.stringify(swept.finalePublic),
    ];
    for (const artifact of boundaries) {
      for (const marker of INTERNAL_MARKERS) expect(artifact).not.toContain(marker);
    }
    // model 上下文顶层只有允许列三键
    for (const ctx of swept.modelContexts) {
      expect(Object.keys(JSON.parse(ctx)).sort()).toEqual(['game', 'identity', 'strategy']);
    }
  });

  it('④ 私有 prompt / 策略溯源:provenance / 原型 id / synthetic 不进任一边界', async () => {
    const { swept } = await playToFinish();
    const boundaries = [
      ...swept.modelContexts,
      ...swept.hookPayloads,
      ...swept.preFinalePublic.map((s) => JSON.stringify(s)),
      JSON.stringify(swept.finalePublic),
    ];
    for (const artifact of boundaries) {
      for (const marker of PROVENANCE_MARKERS) expect(artifact).not.toContain(marker);
    }
  });

  it('⑤ 未结算票:选票结构绝不进任一 AI 的 model 上下文', async () => {
    const { swept } = await playToFinish();
    for (const ctx of swept.modelContexts) {
      for (const marker of VOTE_MARKERS) expect(ctx).not.toContain(marker);
    }
    // hook 投影(回合公开点,先于投票)也不含任何选票
    for (const payload of swept.hookPayloads) {
      for (const marker of VOTE_MARKERS) expect(payload).not.toContain(marker);
    }
  });
});
