import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT,
  NEUTRAL_TRI,
  PLAYTEST_LABELS,
  TRI_LABELS,
  toSubmission,
  type FeedbackDraft,
} from './feedback';

/**
 * 反馈草稿 → 提交体的纯逻辑(任务 5.5 前端契约)
 * 钉死:consent 恒 true、completion 恒 completed、未选最爱 → null、gameId 正确注入。
 * 「不用了 = 零遥测」由组件保证(dismissed 直接 return null,永不触达此函数),
 * 这里守住的是「一旦提交,编码必须与后端 schema 对齐」。
 */

describe('toSubmission · 草稿编码', () => {
  it('初始草稿:consent=true、completion=completed、最爱留空、三态居中', () => {
    const submission = toSubmission(EMPTY_DRAFT, 'game-xyz');
    expect(submission).toEqual({
      consent: true,
      gameId: 'game-xyz',
      completion: 'completed',
      rematch: 'maybe',
      favoriteAgentId: null,
      favoriteMomentId: null,
      share: 'maybe',
      replayIntent: 'maybe',
      playtestPreference: 'no_preference',
    });
  });

  it('用户选择被忠实透传,gameId 注入正确', () => {
    const draft: FeedbackDraft = {
      rematch: 'yes',
      share: 'no',
      replayIntent: 'yes',
      favoriteAgentId: 'ai-3',
      favoriteMomentId: 'callback-2',
      playtestPreference: 'portrait',
    };
    const submission = toSubmission(draft, 'g-1');
    expect(submission.consent).toBe(true);
    expect(submission.gameId).toBe('g-1');
    expect(submission.rematch).toBe('yes');
    expect(submission.share).toBe('no');
    expect(submission.favoriteAgentId).toBe('ai-3');
    expect(submission.favoriteMomentId).toBe('callback-2');
    expect(submission.playtestPreference).toBe('portrait');
  });

  it('consent 在类型层被钉成字面量 true(未同意无法构造提交体)', () => {
    // 若把 consent 写成 false,tsc 会拒编译;运行时也恒为 true。
    expect(toSubmission(EMPTY_DRAFT, 'g').consent).toBe(true);
  });

  it('提交体不含任何自由文本字段(结构上无从夹带 PII)', () => {
    const keys = Object.keys(toSubmission(EMPTY_DRAFT, 'g')).sort();
    expect(keys).toEqual([
      'completion',
      'consent',
      'favoriteAgentId',
      'favoriteMomentId',
      'gameId',
      'playtestPreference',
      'rematch',
      'replayIntent',
      'share',
    ]);
  });
});

describe('标签与默认', () => {
  it('中性默认三态为「也许」', () => {
    expect(NEUTRAL_TRI).toBe('maybe');
    expect(EMPTY_DRAFT.rematch).toBe('maybe');
  });

  it('三态 / playtest 措辞齐备', () => {
    expect(TRI_LABELS).toEqual({ yes: '会', maybe: '也许', no: '不会' });
    expect(PLAYTEST_LABELS.portrait).toBe('竖屏剧场');
    expect(PLAYTEST_LABELS.b0).toBe('经典朴素');
    expect(PLAYTEST_LABELS.no_preference).toBe('都行');
  });
});
