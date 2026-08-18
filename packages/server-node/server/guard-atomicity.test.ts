import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';
import type { AgentContext } from './types.js';

/**
 * B6 · 每局守卫 + 原子提交(OpenSpec 03 · Task 5.6)
 *
 * - 并发:同一对局的命令串行执行,后一条看到前一条**已提交**的状态,不交错、不重复生成。
 * - 原子:命令在草稿上改动,成功才整体写回;中途抛错则回滚,已提交状态原样保留,
 *   且命令链不被一次失败卡死(后续命令仍能正常执行)。
 */

const DETERMINISTIC = () => 0;

/** 第一次 describe 注入失败,之后恢复正常 —— 验证回滚 + 命令链存活。 */
class FlakyOnceModel extends FakeGameModel {
  private failed = false;
  async describe(context: AgentContext): Promise<string> {
    if (!this.failed) {
      this.failed = true;
      throw new Error('首次注入失败');
    }
    return super.describe(context);
  }
}

describe('B6 · 每局守卫 · 并发命令串行化', () => {
  it('对同一对局并发提交两次描述:恰好一条成功,另一条被拒,且只生成一轮', async () => {
    const engine = new GameEngine(new FakeGameModel(), DETERMINISTIC);
    const game = engine.createGame();

    const [a, b] = await Promise.allSettled([
      engine.submitHumanDescription(game.id, '人类的第一句描述'),
      engine.submitHumanDescription(game.id, '人类的第二句描述'),
    ]);

    const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
    const rejected = [a, b].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const internal = engine.getInternalGame(game.id);
    expect(internal.phase).toBe('voting');
    // 只推进了一轮:1 人类 + 4 AI = 5 条,没有因并发而重复生成
    expect(internal.descriptions).toHaveLength(5);
  });
});

describe('B6 · 原子提交 · 失败回滚且命令链存活', () => {
  it('一次命令中途失败则整体回滚,随后同局命令仍能正常提交', async () => {
    const engine = new GameEngine(new FlakyOnceModel(), DETERMINISTIC);
    const game = engine.createGame();

    // 第一次:AI 生成注入失败 → 命令拒绝,已提交状态回滚为开局原样
    await expect(engine.submitHumanDescription(game.id, '人类的描述')).rejects.toThrow();
    const afterFail = engine.getInternalGame(game.id);
    expect(afterFail.descriptions).toHaveLength(0);
    expect(afterFail.phase).toBe('describing');
    expect(afterFail.round).toBe(1);

    // 命令链未被卡死:第二次照常成功推进
    const ok = await engine.submitHumanDescription(game.id, '人类的描述');
    expect(ok.phase).toBe('voting');
    expect(ok.descriptions).toHaveLength(5);
  });
});
