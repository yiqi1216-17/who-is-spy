import { describe, expect, it } from 'vitest';
import { BELIEF_EMA_ALPHA, emptyBelief, normalizeBelief, observeRound } from './beliefs.js';
import { envelope, parseVersioned } from './schema.js';
import type { Belief } from './schema.js';

/**
 * B7 · 私有结构化信念(OpenSpec 03 · Task 5.1)
 *
 * 覆盖四条要求:①归一化 ②确定性校准(单调有界 + EMA)③证据只存公开引用(无自由文本)
 * ④跨 Agent 非干扰(纯函数 · 不读他人信念 · 不改入参)。
 */

// 一轮:ai-3 明显离群,其余三人措辞高度相近。
const ROUND_1 = {
  round: 1,
  selfId: 'ai-1',
  descriptions: [
    { playerId: 'ai-1', text: '一种日常里很常见的温热饮品' },
    { playerId: 'ai-2', text: '一种日常里很常见的温热饮料' },
    { playerId: 'human', text: '一种日常里常见的温热饮品' },
    { playerId: 'ai-3', text: '钢铁森林中呼啸而过的地下列车' },
  ],
} as const;

describe('B7 · 结构化 + 归一化', () => {
  it('归一化:分数夹到 [0,1]、按 playerId 去重排序、证据去重排序', () => {
    const messy: Belief = {
      round: 2,
      suspicions: [
        { playerId: 'ai-3', score: 1.4 },
        { playerId: 'ai-1', score: -0.2 },
        { playerId: 'ai-3', score: 0.6 }, // 重复,留后者
      ],
      selfExposure: 2,
      evidenceRefs: [
        { playerId: 'ai-3', round: 2 },
        { playerId: 'ai-3', round: 2 }, // 重复
        { playerId: 'ai-1', round: 1 },
      ],
    };
    const b = normalizeBelief(messy);
    expect(b.suspicions).toEqual([
      { playerId: 'ai-1', score: 0 },
      { playerId: 'ai-3', score: 0.6 },
    ]);
    expect(b.selfExposure).toBe(1);
    expect(b.evidenceRefs).toEqual([
      { playerId: 'ai-1', round: 1 },
      { playerId: 'ai-3', round: 2 },
    ]);
  });

  it('信念结构上通过 belief 的 strict schema(无自由文本容身之地)', () => {
    const b = observeRound(emptyBelief(), ROUND_1);
    const round = parseVersioned('belief', envelope('belief', b));
    expect(round).toEqual(b);
  });
});

describe('B7 · 确定性校准(单调有界 + EMA)', () => {
  it('离群者获得更高怀疑度,且所有分数落在 [0,1]', () => {
    const b = observeRound(emptyBelief(), ROUND_1);
    const score = (id: string) => b.suspicions.find((s) => s.playerId === id)?.score ?? -1;
    // 观测主体是 ai-1,故 suspicions 只覆盖 ai-2 / human / ai-3
    expect(b.suspicions.map((s) => s.playerId)).toEqual(['ai-2', 'ai-3', 'human']);
    for (const s of b.suspicions) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(1);
    }
    // 离群的 ai-3 明显比措辞相近的 ai-2 / human 更可疑
    expect(score('ai-3')).toBeGreaterThan(score('ai-2'));
    expect(score('ai-3')).toBeGreaterThan(score('human'));
  });

  it('纯函数:同输入恒得同输出,且不修改入参', () => {
    const prev = emptyBelief();
    const snapshot = structuredClone(prev);
    const a = observeRound(prev, ROUND_1);
    const b = observeRound(prev, ROUND_1);
    expect(a).toEqual(b);
    expect(prev).toEqual(snapshot); // 入参未被修改
  });

  it('EMA:持续观测同一离群者,怀疑度朝当轮离群度收敛(半衰 α)', () => {
    let b = emptyBelief();
    const scores: number[] = [];
    for (let round = 1; round <= 4; round += 1) {
      b = observeRound(b, { ...ROUND_1, round });
      scores.push(b.suspicions.find((s) => s.playerId === 'ai-3')!.score);
    }
    // 单调不减地逼近稳态(每轮把与目标的差距按 (1-α) 收缩)
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
    expect(BELIEF_EMA_ALPHA).toBe(0.5);
  });
});

describe('B7 · 证据只存公开引用(无自由文本)', () => {
  it('每条怀疑都有 (playerId, round) 公开引用背书;引用里没有任何文本字段', () => {
    const b = observeRound(emptyBelief(), ROUND_1);
    for (const s of b.suspicions) {
      const refs = b.evidenceRefs.filter((r) => r.playerId === s.playerId);
      expect(refs.length).toBeGreaterThan(0);
    }
    for (const ref of b.evidenceRefs) {
      expect(Object.keys(ref).sort()).toEqual(['playerId', 'round']);
    }
    // 序列化里不含任何被观测的原始描述文本(信念不搬运自由文本)。
    const serialized = JSON.stringify(b);
    for (const d of ROUND_1.descriptions) expect(serialized).not.toContain(d.text);
  });
});

describe('B7 · 跨 Agent 非干扰', () => {
  it('两个 Agent 各自 observeRound 互不影响:换 selfId 只改各自视角,不共享状态', () => {
    // 同一轮公开描述,ai-1 与 ai-2 分别以自己为主体观测。
    const round = { ...ROUND_1 };
    const belief1 = observeRound(emptyBelief(), { ...round, selfId: 'ai-1' });
    const belief2 = observeRound(emptyBelief(), { ...round, selfId: 'ai-2' });

    // 各自把"自己"排除在怀疑对象之外 —— 视角独立。
    expect(belief1.suspicions.some((s) => s.playerId === 'ai-1')).toBe(false);
    expect(belief2.suspicions.some((s) => s.playerId === 'ai-2')).toBe(false);
    // 一方的信念对象里不出现另一方的私有分数结构被共享的迹象:
    // 对共同观测对象 ai-3,两视角各自独立计算(此处输入对称,值相等但对象不同引用)。
    expect(belief1).not.toBe(belief2);
  });
});
