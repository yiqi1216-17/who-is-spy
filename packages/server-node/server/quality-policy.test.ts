import { describe, expect, it } from 'vitest';
import {
  SELF_REPEAT_THRESHOLD,
  SIMILARITY_THRESHOLD,
  evaluateDescription,
  similarity,
} from './quality-policy.js';

/**
 * B3 · 共享描述质量策略(OpenSpec 03 · Task 5.5,反转 CH-3)
 *
 * 纯函数判定:泄题(直接/伪装)、同轮同质、自我重复。确定性、模型无关、无副作用。
 */

describe('B3 · 质量策略 · 泄题', () => {
  it('直接说出密词 → exact_leak', () => {
    const v = evaluateDescription({ text: '这不就是拿铁吗', secretWord: '拿铁' });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('exact_leak');
  });

  it('用空格/标点伪装密词仍被拦 → obfuscated_leak', () => {
    for (const disguised of ['拿 铁', '拿-铁', '拿·铁', '拿、铁']) {
      const v = evaluateDescription({ text: `我想到的是${disguised}`, secretWord: '拿铁' });
      expect(v.ok, disguised).toBe(false);
      expect(v.code, disguised).toBe('obfuscated_leak');
    }
  });

  it('不含密词的正常描述 → 放行', () => {
    const v = evaluateDescription({ text: '一种带奶泡的热饮，早上很提神', secretWord: '拿铁' });
    expect(v.ok).toBe(true);
    expect(v.code).toBe('ok');
  });
});

describe('B3 · 质量策略 · 同质与自我重复', () => {
  it('与本轮先发描述逐字雷同 → too_similar', () => {
    const line = '它让我想到一个温暖的清晨';
    const v = evaluateDescription({
      text: line,
      secretWord: '拿铁',
      priorPublicTexts: ['完全无关的另一句', line],
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('too_similar');
    expect(v.matched).toBe(line);
  });

  it('与自己上一轮几乎逐字重复 → duplicate_self', () => {
    const v = evaluateDescription({
      text: '嗯，它让我想到一个温暖的清晨',
      secretWord: '拿铁',
      ownPriorTexts: ['它让我想到一个温暖的清晨'],
    });
    expect(v.ok).toBe(false);
    expect(v.code).toBe('duplicate_self');
  });

  it('四个假名换字的描述彼此不算雷同(阈值不误伤)', () => {
    const names = ['阿序', '弥生', '老墨', '小满'];
    const lines = names.map((n) => `它让我想到${n}熟悉的日常场景`);
    for (let i = 1; i < lines.length; i += 1) {
      expect(similarity(lines[0], lines[i])).toBeLessThan(SIMILARITY_THRESHOLD);
      const v = evaluateDescription({
        text: lines[i],
        secretWord: '拿铁',
        priorPublicTexts: lines.slice(0, i),
      });
      expect(v.ok, lines[i]).toBe(true);
    }
  });

  it('太短 → too_short', () => {
    expect(evaluateDescription({ text: '  好 ', secretWord: '拿铁' }).code).toBe('too_short');
  });
});

describe('B3 · 相似度度量', () => {
  it('完全相同 = 1;毫不相关 ≈ 0;确定性对称', () => {
    expect(similarity('温暖的清晨', '温暖的清晨')).toBe(1);
    expect(similarity('温暖的清晨', '钢铁与齿轮')).toBeLessThan(0.1);
    expect(similarity('温暖的清晨', '清晨很温暖')).toBe(similarity('清晨很温暖', '温暖的清晨'));
  });

  it('自我重复阈值严于同质阈值', () => {
    expect(SELF_REPEAT_THRESHOLD).toBeGreaterThan(SIMILARITY_THRESHOLD);
  });
});
