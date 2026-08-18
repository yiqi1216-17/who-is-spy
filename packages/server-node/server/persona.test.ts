import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { parseVersioned, envelope } from './schema.js';
import { SEED_STRATEGIES } from './strategies.js';
import { FakeGameModel } from './test-utils.js';

/**
 * B4 · 策略传导(OpenSpec 03 · Task 5.1 / §4 策略接入编排)
 *
 * 反转 B0 的 CH-2:AgentContext 现在带 strategy 投影通道,四个角色拿到互不相同的
 * 可解释策略(persona / tactics / 三个连续量),从而"同样局面说出不一样的话"。
 * 隔离约束保持:strategy 是每个 Agent 自己的,绝不进入公开 DTO,也不含元数据(来源/样本 ID)。
 */

const DETERMINISTIC = () => 0;
const STYLES = ['谨慎观察', '直觉敏锐', '逻辑派', '出其不意'];

describe('B4 · 策略传导通道', () => {
  it('每个 AI 的上下文都带 strategy 投影(persona/tactics/三个连续量)', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    expect(model.descriptionContexts).toHaveLength(4);
    for (const ctx of model.descriptionContexts) {
      expect(Object.keys(ctx).sort()).toEqual(['game', 'identity', 'strategy']);
      expect(Object.keys(ctx.strategy).sort()).toEqual([
        'novelty',
        'persona',
        'risk',
        'specificity',
        'tactics',
      ]);
    }
  });

  it('四个角色拿到互不相同的 persona,恰为四种既定风格', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    const personas = model.descriptionContexts.map((c) => c.strategy.persona);
    expect(new Set(personas).size).toBe(4);
    expect(personas.sort()).toEqual([...STYLES].sort());
  });

  it('strategy 投影不携带来源/ID 等元数据(只暴露渲染所需)', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    await engine.submitHumanDescription(game.id, '人类先给出的一句描述');

    const serialized = JSON.stringify(model.descriptionContexts.map((c) => c.strategy));
    expect(serialized).not.toContain('provenance');
    expect(serialized).not.toContain('synthetic');
    expect(serialized).not.toContain('sampleIds');
  });

  it('strategy 绝不进入公开 DTO', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    const voting = await engine.submitHumanDescription(game.id, '人类先给出的一句描述');
    const serialized = JSON.stringify(voting);
    for (const style of STYLES) {
      expect(serialized).not.toContain(style);
    }
    expect(serialized).not.toContain('tactics');
  });
});

describe('B4 · 种子策略符合 schema', () => {
  it('每个 SEED_STRATEGY 都能通过版本化 strategy schema', () => {
    expect(SEED_STRATEGIES).toHaveLength(4);
    for (const strategy of SEED_STRATEGIES) {
      expect(() => parseVersioned('strategy', envelope('strategy', strategy))).not.toThrow();
    }
    // id 唯一
    expect(new Set(SEED_STRATEGIES.map((s) => s.id)).size).toBe(4);
    // 种子策略诚实标注为合成来源(C 阶段用真实数据回填替换)
    for (const strategy of SEED_STRATEGIES) {
      expect(strategy.provenance.kind).toBe('synthetic');
    }
  });
});
