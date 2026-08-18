import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';
import type { AgentContext, GameModel, GameReview, GameState, Player } from './types.js';

/**
 * B0 特征化测试(OpenSpec 03 · Task 1.3)
 *
 * 目的:把"收到时"的基线行为钉成可执行事实,作为二次开发的对照原点。
 * 这些断言描述的是 **当前(B0)行为**,当前应全部通过。
 *
 * 其中三条是任务线① 要修复的"病":
 *   - CH-1 顺序:后发 AI 看不到本轮先发 AI 的描述(接缝落地后反转为"看得到")。
 *   - CH-2 人设:AgentContext 无策略/人设传导通道,style 字段对行为零影响(接缝后新增 strategy 通道)。
 *   - CH-3 质量:同轮同质/重复描述不被任何机制拦截(接缝后由 QualityPolicy 拦下)。
 * 一条是必须 **保持** 的不变量:
 *   - CH-4 原子性:单个 AI 失败时,这一回合不留半成品状态。
 */

const DETERMINISTIC = () => 0;

/** 所有 AI 返回同一句话,用于验证"同质不拦截"。 */
class HomogeneousFakeModel extends FakeGameModel {
  constructor(private readonly line: string) {
    super();
  }
  async describe(context: AgentContext): Promise<string> {
    this.descriptionContexts.push(structuredClone(context));
    return this.line;
  }
}

/** 指定某个 AI 的 describe 抛错,用于验证失败原子性。 */
class FailingFakeModel extends FakeGameModel {
  constructor(private readonly failingPlayerId: string) {
    super();
  }
  async describe(context: AgentContext): Promise<string> {
    if (context.identity.playerId === this.failingPlayerId) {
      throw new Error(`模拟 ${this.failingPlayerId} 生成失败`);
    }
    return super.describe(context);
  }
}

describe('B0 特征化 · 描述阶段编排', () => {
  it('CH-1 顺序:四个 AI 并行,后发看不到本轮先发 AI 的描述', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    // 四个 AI 都被调用
    expect(model.descriptionContexts).toHaveLength(4);
    for (const ctx of model.descriptionContexts) {
      const sameRoundEntries = ctx.game.publicDescriptions.filter((d) => d.round === 1);
      // 只看得到人类那一条,看不到任何本轮 AI 的描述(这是 B0 的"病")
      expect(sameRoundEntries.every((d) => d.playerId === 'human')).toBe(true);
      expect(sameRoundEntries.filter((d) => d.playerId !== 'human')).toHaveLength(0);
    }
  });

  it('CH-2 人设:AgentContext 无策略/人设通道,style 不传导', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    const ctx = model.descriptionContexts[0];
    // 上下文顶层只有 identity 与 game,没有 strategy/persona 通道
    expect(Object.keys(ctx).sort()).toEqual(['game', 'identity']);
    expect(Object.keys(ctx.identity).sort()).toEqual(['name', 'playerId', 'role', 'word']);

    // AI_PROFILES 里的 style 文案从未进入任何 AI 的上下文
    const serialized = JSON.stringify(model.descriptionContexts);
    for (const style of ['谨慎观察', '直觉敏锐', '逻辑派', '出其不意']) {
      expect(serialized).not.toContain(style);
    }
  });

  it('CH-3 质量:四个 AI 输出完全相同也不被拦截,直接进入投票', async () => {
    const model = new HomogeneousFakeModel('一句一模一样的描述');
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    const voting = await engine.submitHumanDescription(game.id, '人类的独特描述');

    expect(voting.phase).toBe('voting');
    const aiTexts = voting.descriptions
      .filter((d) => d.playerId !== 'human')
      .map((d) => d.text);
    expect(aiTexts).toHaveLength(4);
    // 四条完全相同,却没有任何同质化门禁拦下(这是 B0 的"病")
    expect(new Set(aiTexts).size).toBe(1);
  });

  it('CH-4 原子性:单个 AI 描述失败时,这一回合不留半成品状态', async () => {
    const model = new FailingFakeModel('ai-2');
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await expect(
      engine.submitHumanDescription(game.id, '人类的描述'),
    ).rejects.toThrow();

    const internal = engine.getInternalGame(game.id);
    // 失败前未持久化任何本轮描述,阶段与轮次保持不变
    expect(internal.descriptions).toHaveLength(0);
    expect(internal.phase).toBe('describing');
    expect(internal.round).toBe(1);
  });
});

describe('B0 特征化 · 信息隔离(必须保持的不变量)', () => {
  it('每个 AI 的上下文都读不到其他玩家的 role/word', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();
    const internal = engine.getInternalGame(game.id);

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    const others = internal.players.filter((p) => p.id !== 'ai-1');
    for (const ctx of model.descriptionContexts) {
      const serialized = JSON.stringify(ctx);
      for (const other of others) {
        if (other.word !== ctx.identity.word) {
          expect(serialized).not.toContain(other.word);
        }
      }
    }
  });
});

// 编译期占位:确保测试内的假模型与 GameModel 契约保持一致。
const _typecheck: GameModel = new FakeGameModel();
void _typecheck;
void (undefined as unknown as GameReview);
void (undefined as unknown as GameState);
void (undefined as unknown as Player);
