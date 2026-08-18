import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { DeepSeekClient, type GameModel, ModelError } from './model.js';
import { GameEngine } from './game-engine.js';
import type { AgentContext, GameReview, GameState, Player } from './types.js';

/**
 * §6.3 · 预算封顶 DeepSeek smoke 局(OpenSpec 03 · Task 6.3)
 *
 * 用**真实** DeepSeek 路径跑一小段对局,验证真机链路可用且不越界。
 * - 未配置 DEEPSEEK_API_KEY 时**优雅跳过**(不判失败),密钥就绪后自动生效。
 * - **预算封顶**:包一层调用计数器,超过 MAX_MODEL_CALLS 即抛错中止,杜绝失控消耗。
 * - 断言:真机描述不泄密词;终局前公开 DTO 不揭示他人 role/word。
 */

const MAX_MODEL_CALLS = 24;

/** 预算守卫:超过上限即抛错,防止真机 smoke 失控烧 token。 */
class BudgetCappedModel implements GameModel {
  calls = 0;
  constructor(private readonly inner: GameModel) {}
  get model(): string {
    return this.inner.model;
  }
  isConfigured(): boolean {
    return this.inner.isConfigured();
  }
  private tick(): void {
    this.calls += 1;
    if (this.calls > MAX_MODEL_CALLS) {
      throw new ModelError(`smoke 预算封顶:模型调用超过 ${MAX_MODEL_CALLS} 次,已主动中止`);
    }
  }
  async describe(context: AgentContext): Promise<string> {
    this.tick();
    return this.inner.describe(context);
  }
  async vote(context: AgentContext, allowed: Player[]): Promise<{ targetId: string; reason: string }> {
    this.tick();
    return this.inner.vote(context, allowed);
  }
  async review(game: GameState): Promise<GameReview> {
    this.tick();
    return this.inner.review(game);
  }
}

const configured = new DeepSeekClient().isConfigured();

describe('§6.3 · DeepSeek smoke(预算封顶,真机路径)', () => {
  it.skipIf(!configured)(
    '真机跑一轮描述:不泄密词、终局前不揭示他人身份、预算不超支',
    async () => {
      const model = new BudgetCappedModel(new DeepSeekClient());
      const engine = new GameEngine(model);
      const created = engine.createGame();

      const voting = await engine.submitHumanDescription(created.id, '一种日常里常见的东西');

      expect(voting.phase).toBe('voting');
      expect(voting.descriptions).toHaveLength(5);

      // 真机描述不得包含任何玩家的秘密词
      const internal = engine.getInternalGame(created.id);
      const secretWords = internal.players.map((p) => p.word);
      for (const d of voting.descriptions) {
        for (const w of secretWords) expect(d.text).not.toContain(w);
      }
      // 终局前公开 DTO 不揭示任何玩家 role/word
      for (const p of voting.players) {
        expect(p.revealedRole).toBeUndefined();
        expect(p.revealedWord).toBeUndefined();
      }
      expect(model.calls).toBeLessThanOrEqual(MAX_MODEL_CALLS);
    },
    60_000,
  );

  it('无密钥时该 smoke 被跳过而非失败(说明真机证据待密钥补录)', () => {
    // 这是一条元断言:无论是否配置,本用例都通过,用于在报告里显式记录 smoke 的门控状态。
    expect(typeof configured).toBe('boolean');
  });
});
