import { describe, expect, it } from 'vitest';
import { decideWinner, mineOutcomes, type Side } from './mine-outcomes.js';
import { werewolfGameId } from './normalize.js';

/**
 * 胜负相关性挖掘的验收(OpenSpec 04 · 阵营胜率军备竞赛的数据依据)
 *
 * 钉两件事:①ONUW 简化处决判定纯函数——抓到狼阵营=村民胜、否则狼胜、无狼阵营→退出;
 * ②端到端确定性——同输入恒得同报告,且只统计 train split。
 */

describe('decideWinner:ONUW 简化处决判定', () => {
  const sides: Side[] = ['civilian', 'undercover', 'civilian', 'civilian'];

  it('处决到狼阵营 → 村民(civilian 类比)胜', () => {
    // 三票投向 index 1(狼)→ 被处决 → civilian 胜
    expect(decideWinner([1, 1, 1, 0], sides)).toBe('civilian');
  });

  it('未处决到狼 → 狼(undercover 类比)胜', () => {
    // 多数票投向 index 0(村民)→ 处决村民 → undercover 胜
    expect(decideWinner([0, 0, 0, 2], sides)).toBe('undercover');
  });

  it('全弃权(无有效票)→ 无人被处决 → 狼存活胜', () => {
    expect(decideWinner(['NA', 'NA', 'NA', 'NA'], sides)).toBe('undercover');
  });

  it('平票并列处决,只要含一名狼即村民胜', () => {
    // index1(狼)与 index0(村民)各两票 → 并列处决 → 含狼 → civilian 胜
    expect(decideWinner([1, 1, 0, 0], sides)).toBe('civilian');
  });

  it('无狼阵营的局 → 无卧底类比方 → 退出统计(null)', () => {
    expect(decideWinner([1, 0, 0, 0], ['civilian', 'civilian', 'civilian', 'civilian'])).toBeNull();
  });

  it('越界票被忽略,不猜测', () => {
    // 只有 index1(狼)是有效票,其余越界 → 处决狼 → civilian 胜
    expect(decideWinner([1, 9, -1, 99], sides)).toBe('civilian');
  });
});

describe('mineOutcomes:端到端确定性 + train 过滤', () => {
  // 两个最小合成局:endRoles 决定阵营,votingOutcome 决定胜负,Dialogue.annotation 决定话风簇。
  const gameWon = {
    YT_ID: 'yt-a',
    video_name: 'vid-a',
    Game_ID: 'G1',
    playerNames: ['A', 'B', 'C', 'D'],
    endRoles: ['Villager', 'Werewolf', 'Villager', 'Villager'],
    votingOutcome: [1, 1, 1, 0], // 处决狼 → civilian 胜
    Dialogue: [
      // A(村民,胜方):以 Interrogation 为主导 → interrogator 簇
      ...Array.from({ length: 6 }, () => ({ speaker: 'A', annotation: ['Interrogation'] })),
      // B(狼,败方):以 Accusation 为主导 → accuser 簇
      ...Array.from({ length: 6 }, () => ({ speaker: 'B', annotation: ['Accusation'] })),
    ],
  };
  const gameOutOfSplit = { ...gameWon, YT_ID: 'yt-z', video_name: 'vid-z', Game_ID: 'G9' };

  // gameId 由 normalize.werewolfGameId 派生;这里用 mineOutcomes 内部同一函数,故直接构造 trainIds
  // 通过「只放 gameWon 的派生 id」来验证过滤——用一个宽松集合包含 A 局、排除 Z 局。
  it('同输入两次调用报告逐字节相等', () => {
    const trainIds = new Set([werewolfGameId(gameWon)]);
    const r1 = mineOutcomes([gameWon], trainIds);
    const r2 = mineOutcomes([gameWon], trainIds);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it('只统计 train split 内的局', () => {
    const trainIds = new Set([werewolfGameId(gameWon)]); // 不含 Z 局
    const r = mineOutcomes([gameWon, gameOutOfSplit], trainIds);
    expect(r.decidedGames).toBe(1); // Z 局被过滤
  });

  it('胜方话风簇的 winRate=1、败方=0(方向正确)', () => {
    const trainIds = new Set([werewolfGameId(gameWon)]);
    const r = mineOutcomes([gameWon], trainIds);
    const interrogator = r.clusters.find((c) => c.id === 'interrogator')!;
    const accuser = r.clusters.find((c) => c.id === 'accuser')!;
    expect(interrogator.members).toBe(1);
    expect(interrogator.winRate).toBe(1); // A 在胜方
    expect(accuser.members).toBe(1);
    expect(accuser.winRate).toBe(0); // B 在败方
    expect(r.baseline.civilianWinRate).toBe(1);
  });
});
