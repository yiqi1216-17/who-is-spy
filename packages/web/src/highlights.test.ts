import { describe, expect, it } from 'vitest';
import {
  FALLBACK_META,
  HIGHLIGHT_META,
  citationLabel,
  formatMeasure,
  hasSpoiler,
  metaFor,
} from './highlights.js';
import type { HighlightCard, HighlightType } from './types.js';

/**
 * 高光呈现 · 纯映射测试(OpenSpec 05-H · 任务 5.4)
 * 钉死:七类都有呈现元数据、度量格式化、事件援引脚注、剧透解锁判定。
 */

const ALL_TYPES: HighlightType[] = [
  'decisive_vote',
  'consensus_flip',
  'self_save',
  'lone_correct_read',
  'undercover_blend',
  'callback',
  'novel_safe_metaphor',
];

describe('HIGHLIGHT_META · 呈现元数据', () => {
  it('七类各有非空 label/tone/accent/icon,强调色引用设计令牌', () => {
    for (const type of ALL_TYPES) {
      const meta = HIGHLIGHT_META[type];
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.tone.length).toBeGreaterThan(0);
      expect(meta.icon.length).toBeGreaterThan(0);
      expect(meta.accent.startsWith('--')).toBe(true); // CSS 变量名
    }
  });

  it('metaFor 未知类型回落到 FALLBACK_META(前向兼容)', () => {
    expect(metaFor('brand_new_type' as HighlightType)).toBe(FALLBACK_META);
    expect(metaFor('decisive_vote')).toBe(HIGHLIGHT_META.decisive_vote);
  });
});

describe('formatMeasure · 度量格式化', () => {
  it('before/after → 箭头对比', () => {
    expect(formatMeasure({ label: '指向票', before: 1, after: 3 })).toBe('1 → 3');
  });
  it('单值 → 直出', () => {
    expect(formatMeasure({ label: '得票', value: 2 })).toBe('2');
  });
  it('缺失 → 空串', () => {
    expect(formatMeasure({ label: '空' })).toBe('');
  });
});

describe('citationLabel · 事件援引脚注', () => {
  it('折成"据 e6 · e12"', () => {
    expect(citationLabel({ citedEventIds: ['e6', 'e12'] })).toBe('据 e6 · e12');
  });
  it('无援引 → 空串', () => {
    expect(citationLabel({ citedEventIds: [] })).toBe('');
  });
});

describe('hasSpoiler · 剧透解锁判定', () => {
  const base: HighlightCard = {
    id: 'x',
    type: 'self_save',
    round: 1,
    title: 't',
    caption: 'c',
    citedEventIds: ['e1'],
    citedVotes: [],
    quotes: [],
    measures: [],
  };
  it('无 spoiler → false(默认剧透安全)', () => {
    expect(hasSpoiler(base)).toBe(false);
  });
  it('携 spoiler → true', () => {
    expect(hasSpoiler({ ...base, spoiler: { note: 'n' } })).toBe(true);
  });
});
