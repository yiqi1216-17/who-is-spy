import { describe, expect, it } from 'vitest';
import { GameEngine, QualityExhaustedError, MAX_DESCRIBE_ATTEMPTS } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';
import type { AgentContext } from './types.js';

/**
 * B3 · 质量门在生成边界的接入(OpenSpec 03 · Task 5.5,反转 CH-3)
 *
 * 引擎对每个 AI 描述做"有界重试(correction)→ 穷尽即原子终止(exhaustion)":
 * 合规才入库;反复不合规则整回合安全终止,绝不留半成品(与 CH-4 原子性同源)。
 * 基线 CH-3 的正向反转(同质四连不再被静默接受)在此钉住。
 */

const DETERMINISTIC = () => 0;

/** 各座次互不雷同的干净描述,用于纠正后放行。 */
const CLEAN_LINES = [
  '早上很提神，带点微苦的暖意',
  '和放松的午后时光联系在一起',
  '需要一点耐心才能慢慢体会',
  '在寒冷的季节里格外受欢迎',
] as const;

/** 首次泄题(说出自己的词),之后给出各座次互不雷同的干净描述 —— 用于验证 correction。 */
class CorrectingModel extends FakeGameModel {
  readonly attempts = new Map<string, number>();
  async describe(context: AgentContext): Promise<string> {
    const key = context.identity.playerId;
    const n = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, n);
    if (n === 1) return context.identity.word; // 应被 exact_leak 拦下并触发重试
    const seat = Number(key.replace(/\D/g, '')) || 1;
    return CLEAN_LINES[(seat - 1) % CLEAN_LINES.length];
  }
}

/** 永远泄题 —— 用于验证 exhaustion 后原子终止。 */
class StubbornLeakModel extends FakeGameModel {
  calls = 0;
  async describe(context: AgentContext): Promise<string> {
    this.calls += 1;
    return context.identity.word;
  }
}

/** 所有 AI 返回同一句话 —— 基线 CH-3 的"病",B3 后应被拦截。 */
class HomogeneousModel extends FakeGameModel {
  constructor(private readonly line: string) {
    super();
  }
  async describe(): Promise<string> {
    return this.line;
  }
}

describe('B3 · 质量门 · correction(有界重试)', () => {
  it('首次泄题被拦下,重试给出合规描述后照常入库进入投票', async () => {
    const model = new CorrectingModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    const voting = await engine.submitHumanDescription(game.id, '人类给出的独特描述');

    expect(voting.phase).toBe('voting');
    const aiTexts = voting.descriptions.filter((d) => d.playerId !== 'human').map((d) => d.text);
    expect(aiTexts).toHaveLength(4);
    // 每个 AI 都经历了一次纠正(第 1 次泄题、第 2 次通过)
    for (const [, n] of model.attempts) expect(n).toBe(2);
    // 没有任何入库描述等于秘密词
    const internal = engine.getInternalGame(game.id);
    const civilianWord = internal.players.find((p) => p.role === 'civilian')!.word;
    expect(aiTexts).not.toContain(civilianWord);
  });
});

describe('B3 · 质量门 · exhaustion(穷尽即原子终止)', () => {
  it('反复泄题耗尽重试 → 抛 QualityExhaustedError,且本回合不留半成品', async () => {
    const model = new StubbornLeakModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await expect(engine.submitHumanDescription(game.id, '人类的描述')).rejects.toBeInstanceOf(
      QualityExhaustedError,
    );

    // 恰好用满上限次数(只有首个 AI 尝试,之后整回合中止)
    expect(model.calls).toBe(MAX_DESCRIBE_ATTEMPTS);
    const internal = engine.getInternalGame(game.id);
    expect(internal.descriptions).toHaveLength(0);
    expect(internal.phase).toBe('describing');
    expect(internal.round).toBe(1);
  });
});

describe('B3 · 质量门 · 反转 CH-3(同质不再被静默接受)', () => {
  it('四个 AI 想说同一句话时被同质门拦截,回合原子终止而非进入投票', async () => {
    const model = new HomogeneousModel('一句一模一样的描述');
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await expect(
      engine.submitHumanDescription(game.id, '人类的独特描述'),
    ).rejects.toBeInstanceOf(QualityExhaustedError);

    const internal = engine.getInternalGame(game.id);
    expect(internal.descriptions).toHaveLength(0);
    expect(internal.phase).toBe('describing');
  });
});
