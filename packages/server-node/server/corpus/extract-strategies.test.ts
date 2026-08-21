import { describe, expect, it } from 'vitest';
import { envelope, parseVersioned } from '../schema.js';
import { werewolfGameId } from './normalize.js';
import { TAG_TACTIC, extractStrategies } from './extract-strategies.js';

/**
 * 策略抽取(data/README.md 执行路线第 4 步;OpenSpec 03 · tasks 4.1/4.2 拾取)
 *
 * 从 werewolf-among-us **train split** 的句级说服策略标注统计玩家级分布,分桶为
 * 四个可解释原型。护栏:
 * - frozen/rolling/holdout 局**绝不进拟合**(spec:splits prevent leakage → strategy fitting);
 * - provenance 诚实:kind='transfer'(狼人杀→谁是卧底是跨游戏迁移),sampleIds ⊆ train;
 * - 全程确定性:同输入同输出,无随机源。
 */

/** 造一局:speakers 每人若干句,每句一个标注标签。 */
function makeGame(
  ytId: string,
  gameNo: string,
  videoName: string,
  players: Array<{ name: string; tags: string[] }>,
): Record<string, unknown> {
  return {
    YT_ID: ytId,
    Game_ID: gameNo,
    video_name: videoName,
    playerNames: players.map((p) => p.name),
    votingOutcome: players.map(() => 0),
    startRoles: players.map(() => 'Villager'),
    endRoles: players.map(() => 'Villager'),
    Dialogue: players.flatMap((p, i) =>
      p.tags.map((tag, j) => ({
        Rec_Id: i * 100 + j,
        speaker: p.name,
        timestamp: '00:00',
        utterance: `utt-${i}-${j}`,
        annotation: [tag],
      })),
    ),
  };
}

// 四种"纯型"玩家(≥5 句阈值),覆盖四个簇
const pure = (tag: string): string[] => Array.from({ length: 6 }, () => tag);
const TRAIN_GAMES = [
  makeGame('p1', 'Game1', 'video A', [
    { name: 'Ann', tags: pure('Interrogation') },
    { name: 'Bob', tags: pure('Accusation') },
  ]),
  makeGame('p2', 'Game1', 'video B', [
    { name: 'Cid', tags: pure('Defense') },
    { name: 'Dee', tags: pure('Evidence') },
  ]),
];
// frozen 局:极端标注(全 Call for Action),若泄入拟合会明显改变 informer 簇分布
const FROZEN_GAME = makeGame('p9', 'Game9', 'video Z', [
  { name: 'Zed', tags: pure('Call for Action') },
]);

const trainIds = new Set(TRAIN_GAMES.map((g) => werewolfGameId(g)));

describe('corpus/extract-strategies · 护栏', () => {
  it('frozen 局绝不进拟合:不影响分布,也不出现在任何 sampleIds', () => {
    const withFrozen = extractStrategies([...TRAIN_GAMES, FROZEN_GAME], trainIds);
    const trainOnly = extractStrategies(TRAIN_GAMES, trainIds);
    expect(withFrozen.strategies).toEqual(trainOnly.strategies); // 分布逐字节一致
    const frozenId = werewolfGameId(FROZEN_GAME);
    for (const s of withFrozen.strategies) {
      expect(s.provenance.sampleIds).not.toContain(frozenId);
    }
  });

  it('provenance 诚实:kind=transfer,sampleIds 非空且 ⊆ train', () => {
    const { strategies } = extractStrategies(TRAIN_GAMES, trainIds);
    for (const s of strategies) {
      expect(s.provenance.kind).toBe('transfer'); // 跨游戏迁移,永不谎称 human
      expect(s.provenance.sampleIds?.length).toBeGreaterThan(0);
      for (const id of s.provenance.sampleIds ?? []) expect(trainIds.has(id)).toBe(true);
    }
  });

  it('每份原型通过版本化 strategy schema,id/persona 互异且可区分', () => {
    const { strategies } = extractStrategies(TRAIN_GAMES, trainIds);
    expect(strategies).toHaveLength(4);
    for (const s of strategies) {
      expect(() => parseVersioned('strategy', envelope('strategy', s))).not.toThrow();
      expect(s.version).toBe(2); // 数据升级:synthetic 种子 → transfer 抽取
    }
    expect(new Set(strategies.map((s) => s.id)).size).toBe(4);
    expect(new Set(strategies.map((s) => s.persona)).size).toBe(4);
    // 可区分:任意两份在 specificity/novelty/risk 至少一维有差
    for (let i = 0; i < 4; i += 1) {
      for (let j = i + 1; j < 4; j += 1) {
        const a = strategies[i];
        const b = strategies[j];
        const distinguishable =
          a.specificity !== b.specificity || a.novelty !== b.novelty || a.risk !== b.risk;
        expect(distinguishable).toBe(true);
      }
    }
  });

  it('tactics 由簇内 top 标签经固定词典驱动(数据选择、词典表述)', () => {
    const { strategies } = extractStrategies(TRAIN_GAMES, trainIds);
    const interrogator = strategies.find((s) => s.id.startsWith('interrogator'));
    expect(interrogator).toBeDefined();
    // Ann 全 Interrogation → 该簇 top1 必为 Interrogation 的词典短语
    expect(interrogator?.tactics[0]).toBe(TAG_TACTIC.Interrogation);
  });

  it('确定性:同输入两次抽取逐字节一致', () => {
    const a = extractStrategies(TRAIN_GAMES, trainIds);
    const b = extractStrategies(TRAIN_GAMES, trainIds);
    expect(a).toEqual(b);
  });

  it('测量分布随报告输出(tasks 4.2:measured distributions + 计数)', () => {
    const { report } = extractStrategies(TRAIN_GAMES, trainIds);
    expect(report.trainGames).toBe(2);
    expect(report.clusters).toHaveLength(4);
    for (const c of report.clusters) {
      expect(c.members).toBeGreaterThan(0);
      const mass = Object.values(c.distribution).reduce((s, v) => s + v, 0);
      expect(mass).toBeGreaterThan(0.99); // 分布归一(容忍舍入)
      expect(mass).toBeLessThan(1.01);
    }
  });
});
