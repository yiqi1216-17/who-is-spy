import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';

/**
 * 上帝模式(附加能力)行为与隔离测试。
 *
 * 关键主张:
 *  1) 一次调用把全 AI 对局解算到 finished,产出 winner + review;
 *  2) 每个 agent 的公开描述都配一句内心 OS(thoughts 与 descriptions 一一对应);
 *  3) **隔离不减**——尽管上帝 DTO 对旁观者揭示所有词,每个 agent 内部拿到的上下文
 *     里**只**有自己的词,读不到他人的词(反转 CH-1 在上帝模式下仍成立)。
 */
describe('god mode · 全 AI 旁观 + 内心 OS', () => {
  it('一次性解算到终局,揭示全部身份并给出复盘', async () => {
    const engine = new GameEngine(new FakeGameModel());
    const god = await engine.createGodGame();

    expect(god.phase).toBe('finished');
    expect(god.winner === 'civilian' || god.winner === 'undercover').toBe(true);
    expect(god.review).not.toBeNull();

    // 四席全 AI,复用 ai-1..ai-4,且上帝可见全部 role/word/strategy。
    expect(god.players.map((p) => p.id)).toEqual(['ai-1', 'ai-2', 'ai-3', 'ai-4']);
    for (const player of god.players) {
      expect(player.role === 'civilian' || player.role === 'undercover').toBe(true);
      expect(player.word.length).toBeGreaterThan(0);
      expect(player.strategy.persona.length).toBeGreaterThan(0);
    }
    // 恰好 1 名卧底。
    expect(god.players.filter((p) => p.role === 'undercover')).toHaveLength(1);
  });

  it('每条公开描述都配一句内心 OS,锚定到对应的 (round, playerId)', async () => {
    const engine = new GameEngine(new FakeGameModel());
    const god = await engine.createGodGame();

    expect(god.thoughts.length).toBe(god.descriptions.length);
    for (const description of god.descriptions) {
      const os = god.thoughts.find(
        (t) => t.round === description.round && t.playerId === description.playerId,
      );
      expect(os, `缺少 ${description.playerId}@R${description.round} 的内心 OS`).toBeTruthy();
      expect(os!.text.length).toBeGreaterThan(0);
    }
  });

  it('隔离不变量:每个 agent 拿到的上下文只含自己的词,读不到他人的词', async () => {
    const fake = new FakeGameModel();
    const engine = new GameEngine(fake);
    const god = await engine.createGodGame();

    const wordOf = new Map(god.players.map((p) => [p.id, p.word]));
    const allContexts = [...fake.descriptionContexts, ...fake.voteContexts];
    expect(allContexts.length).toBeGreaterThan(0);

    for (const context of allContexts) {
      const selfWord = wordOf.get(context.identity.playerId)!;
      // 自己的词就在 identity 里(符合预期)。
      expect(context.identity.word).toBe(selfWord);
      // 任何**他人**的、与自己不同的词,都不得出现在交给模型的上下文里。
      const serialized = JSON.stringify(context.game);
      for (const [id, word] of wordOf) {
        if (id === context.identity.playerId || word === selfWord) continue;
        expect(
          serialized.includes(word),
          `${context.identity.playerId} 的上下文泄漏了 ${id} 的词「${word}」`,
        ).toBe(false);
      }
    }
  });

  it('上帝局与人类局存储隔离:上帝局 id 不能当作 PublicGameState 取回', async () => {
    const engine = new GameEngine(new FakeGameModel());
    const god = await engine.createGodGame();
    // 人类局出口拿上帝局 id → 404(两套存储互不串台,杜绝误揭身份)。
    expect(() => engine.getGame(god.id)).toThrowError(/不存在/);
  });
});
