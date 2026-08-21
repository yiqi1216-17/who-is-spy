import { describe, expect, it } from 'vitest';
import {
  SPLIT_NAMES,
  assignSplits,
  buildManifest,
  groupKeyFor,
  isRetrievalEligible,
} from './splits.js';

/**
 * 切分 manifest + 检索资格(data/README.md 执行路线第 3 步;OpenSpec 03 · tasks 3.3 拾取)
 *
 * 兑现 human-game-data spec 两条:
 * - 「Train and evaluation splits prevent leakage」→ 词对 / cohort 整组分配,同组永不跨 split;
 * - 「Retrieval attempts to use a holdout example」→ frozen/rolling/preference 与**未知 gameId**
 *   一律不可检索(安全默认),denial 是显式 API 而非口头承诺。
 */

describe('corpus/splits · 分组键(泄漏隔离的单位)', () => {
  it('ck-arena:剥离时间戳后缀,同词对不同对局 → 同组', () => {
    const a = groupKeyFor('ck-arena:en/2ball/football_basketball_20250912-085512_43344');
    const b = groupKeyFor('ck-arena:en/2ball/football_basketball_20250912-091617_4280');
    const c = groupKeyFor('ck-arena:raw/en/different_size_audience/en/animals/elephant_giraffe_20250511-112348');
    expect(a).toBe(b); // 词对是隔离单位:football_basketball 永不同时出现在 train 与 frozen
    expect(a).toContain('football_basketball');
    expect(c).toContain('elephant_giraffe');
    expect(a).not.toBe(c);
  });

  it('werewolf:同一视频(同批玩家)的多局 → 同组;跨视频不同组', () => {
    const g1 = groupKeyFor('werewolf-among-us:part15:Game2:1a8797c3');
    const g2 = groupKeyFor('werewolf-among-us:part15:Game4:1a8797c3');
    const g3 = groupKeyFor('werewolf-among-us:part15:Game2:9b2c0d11'); // 同 YT_ID 碰撞的另一视频
    expect(g1).toBe(g2); // participant-group 隔离:同场玩家不跨 split
    expect(g1).not.toBe(g3);
  });
});

describe('corpus/splits · 确定性整组分配', () => {
  const manyIds = [
    ...Array.from({ length: 120 }, (_, i) => `ck-arena:en/x/pair${i}_word_20250101-00000${i % 10}`),
    ...Array.from({ length: 80 }, (_, i) => `werewolf-among-us:part${i}:Game1:hash${i}`),
  ];

  it('同 seed 两次分配逐字节一致(可复现)', () => {
    expect(assignSplits(manyIds, 7)).toEqual(assignSplits(manyIds, 7));
  });

  it('同组游戏永不跨 split(词对泄漏隔离)', () => {
    const ids = [
      'ck-arena:en/a/apple_pear_20250101-000001',
      'ck-arena:en/a/apple_pear_20250202-000002_777',
      'ck-arena:en/b/apple_pear_20250303-000003',
    ];
    for (let seed = 0; seed < 20; seed += 1) {
      const splits = assignSplits(ids, seed);
      const owner = SPLIT_NAMES.filter((s) => splits[s].length > 0);
      expect(owner).toHaveLength(1); // 三局同词对 → 全在同一个 split 里
      expect(splits[owner[0]]).toHaveLength(3);
    }
  });

  it('组数足够时 train/validation/frozen-core/rolling-challenge 均非空,全集守恒', () => {
    const splits = assignSplits(manyIds, 1);
    for (const name of ['train', 'validation', 'frozen-core', 'rolling-challenge'] as const) {
      expect(splits[name].length).toBeGreaterThan(0);
    }
    const all = SPLIT_NAMES.flatMap((s) => splits[s]).sort();
    expect(all).toEqual([...manyIds].sort()); // 无丢失、无重复
  });

  it('preference-holdout 诚实为空:人类偏好数据尚未采集', () => {
    const manifest = buildManifest(manyIds, 1);
    expect(manifest.splits['preference-holdout'].gameIds).toEqual([]);
    expect(manifest.splits['preference-holdout'].note).toMatch(/未采集|not collected/i);
  });
});

describe('corpus/splits · 检索资格 denial(spec「Retrieval attempts to use a holdout example」)', () => {
  const manifest = buildManifest(
    [
      ...Array.from({ length: 60 }, (_, i) => `ck-arena:en/x/pair${i}_w_20250101-00000${i % 10}`),
    ],
    3,
  );

  it('train / validation 可检索;frozen-core / rolling-challenge 一律拒绝', () => {
    for (const id of manifest.splits.train.gameIds.slice(0, 3)) {
      expect(isRetrievalEligible(id, manifest)).toBe(true);
    }
    for (const id of [
      ...manifest.splits['frozen-core'].gameIds,
      ...manifest.splits['rolling-challenge'].gameIds,
    ]) {
      expect(isRetrievalEligible(id, manifest)).toBe(false); // denial:哨兵样例进不了演示检索
    }
  });

  it('未登记 gameId 默认不可检索(安全默认,而非默认放行)', () => {
    expect(isRetrievalEligible('ck-arena:never/seen_pair_20990101-000000', manifest)).toBe(false);
    expect(isRetrievalEligible('some-random:thing', manifest)).toBe(false);
  });
});
