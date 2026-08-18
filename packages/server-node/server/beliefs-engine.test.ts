import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';

/**
 * B7 · 私有信念接入引擎(OpenSpec 03 · Task 5.1)
 *
 * 证明:回合公开后每个存活 AI 都获得一份私有信念,但该信念
 *   ① 绝不出现在公开 DTO(toPublic)里;
 *   ② 绝不出现在任何 Agent 的上下文(buildAgentContext 投影)里;
 *   ③ 只保存分数 + (playerId, round) 引用,不含自由文本推理。
 */

const DETERMINISTIC = () => 0;

describe('B7 · 引擎私有信念', () => {
  it('一轮描述公开后,每个存活 AI 各得一份结构化信念', async () => {
    const engine = new GameEngine(new FakeGameModel(), DETERMINISTIC);
    const game = engine.createGame();

    await engine.submitHumanDescription(game.id, '人类给出的一句独特描述');

    const internal = engine.getInternalGame(game.id);
    for (const ai of internal.players.filter((p) => !p.isHuman && p.alive)) {
      const belief = engine.getAgentBelief(game.id, ai.id);
      expect(belief).toBeDefined();
      expect(belief!.round).toBe(1);
      // 只对他人建怀疑,不含自己
      expect(belief!.suspicions.some((s) => s.playerId === ai.id)).toBe(false);
      // 每条怀疑都有公开引用背书;引用只有 (playerId, round)
      for (const s of belief!.suspicions) {
        const refs = belief!.evidenceRefs.filter((r) => r.playerId === s.playerId);
        expect(refs.length).toBeGreaterThan(0);
      }
      for (const ref of belief!.evidenceRefs) {
        expect(Object.keys(ref).sort()).toEqual(['playerId', 'round']);
      }
    }
  });

  it('信念绝不进公开 DTO,也绝不进任何 Agent 的模型上下文', async () => {
    const model = new FakeGameModel();
    const engine = new GameEngine(model, DETERMINISTIC);
    const game = engine.createGame();

    const publicState = await engine.submitHumanDescription(game.id, '人类给出的一句独特描述');

    // ① 公开 DTO 里没有 belief / suspicion / selfExposure 等私有字段
    const publicSerialized = JSON.stringify(publicState);
    for (const marker of ['suspicion', 'selfExposure', 'evidenceRef', 'belief']) {
      expect(publicSerialized).not.toContain(marker);
    }

    // ② 每次 describe 传入模型的上下文都不含任何信念结构
    expect(model.descriptionContexts.length).toBeGreaterThan(0);
    for (const ctx of model.descriptionContexts) {
      const s = JSON.stringify(ctx);
      for (const marker of ['suspicion', 'selfExposure', 'evidenceRef', 'belief']) {
        expect(s).not.toContain(marker);
      }
    }
  });
});
