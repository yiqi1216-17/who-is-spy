import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';

/**
 * B1 · 顺序编排(OpenSpec 03 · Task 5.3)
 *
 * 反转 B0 的 CH-1:后发言的 AI 必须能看到本轮更早公开的描述(人类 + 更早座次的 AI),
 * 且座次是确定性的;与此同时,信息隔离不变量保持——谁都读不到别人的 role/word。
 */

const DETERMINISTIC = () => 0;

describe('B1 · 顺序编排:后发看得到本轮先发', () => {
  it('第 k 个座次的 AI 恰好看到人类 + 前 k-1 个 AI 的本轮描述', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    expect(model.descriptionContexts).toHaveLength(4);
    // 座次确定性:调用顺序 = players 座次 ai-1..ai-4
    expect(model.descriptionContexts.map((c) => c.identity.playerId)).toEqual([
      'ai-1',
      'ai-2',
      'ai-3',
      'ai-4',
    ]);

    model.descriptionContexts.forEach((ctx, index) => {
      const sameRound = ctx.game.publicDescriptions.filter((d) => d.round === 1);
      // 第 index 个座次应看到:人类 1 条 + 之前 index 个 AI
      expect(sameRound).toHaveLength(1 + index);
      // 第一条永远是人类
      expect(sameRound[0].playerId).toBe('human');
      // 其余恰好是更早座次的 AI,顺序一致
      const earlierAi = model.descriptionContexts
        .slice(0, index)
        .map((c) => c.identity.playerId);
      expect(sameRound.slice(1).map((d) => d.playerId)).toEqual(earlierAi);
      // 绝不包含自己或更晚座次的描述(不能预览未来)
      expect(sameRound.some((d) => d.playerId === ctx.identity.playerId)).toBe(false);
    });
  });

  it('最后一个座次能看到人类 + 其余全部三名 AI', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    const last = model.descriptionContexts[3];
    const ids = last.game.publicDescriptions
      .filter((d) => d.round === 1)
      .map((d) => d.playerId);
    expect(ids).toEqual(['human', 'ai-1', 'ai-2', 'ai-3']);
  });

  it('信息隔离保持:顺序可见的前提下,仍读不到其他玩家的 word', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();
    const internal = engine.getInternalGame(game.id);

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    for (const ctx of model.descriptionContexts) {
      const serialized = JSON.stringify(ctx);
      for (const other of internal.players) {
        if (other.word !== ctx.identity.word) {
          expect(serialized).not.toContain(other.word);
        }
      }
    }
  });
});
