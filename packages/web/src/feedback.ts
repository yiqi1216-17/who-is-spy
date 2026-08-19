import type { FeedbackSubmission, FeedbackTriState, PlaytestPreference } from './types';

/**
 * 反馈草稿 → 提交体的纯逻辑(OpenSpec 05-H · 任务 5.5)
 *
 * 组件只负责渲染与收集;「草稿是否可提交」「如何编码成后端契约」全在此处,便于单测。
 * 关键不变量:
 *  - `consent` 恒 `true` —— 只有当用户点「提交」、由 `toSubmission` 构造时才存在此对象;
 *    选择「不用了」的退出路径在组件层直接 dismiss,永不触达此函数(零遥测)。
 *  - 终局反馈的 `completion` 固定 `completed`(能走到终局界面即已完成一局)。
 *  - 最爱 Agent / 瞬间未选 → `null`(合法:可以不选)。
 */

/** 三态问题的中性默认:落在「也许」,三选等权,不诱导。 */
export const NEUTRAL_TRI: FeedbackTriState = 'maybe';

/** 组件持有的草稿:比提交体多一个「本地是否已选」的语义,少一个 consent/gameId/completion。 */
export interface FeedbackDraft {
  rematch: FeedbackTriState;
  share: FeedbackTriState;
  replayIntent: FeedbackTriState;
  favoriteAgentId: string | null;
  favoriteMomentId: string | null;
  playtestPreference: PlaytestPreference;
}

/** 初始草稿:三态居中、最爱留空、playtest 不表态——让「提交」始终可用,又不预设立场。 */
export const EMPTY_DRAFT: FeedbackDraft = {
  rematch: NEUTRAL_TRI,
  share: NEUTRAL_TRI,
  replayIntent: NEUTRAL_TRI,
  favoriteAgentId: null,
  favoriteMomentId: null,
  playtestPreference: 'no_preference',
};

/** 把草稿编码成带 consent 的提交体。构造此对象**本身**即代表用户已知情同意。 */
export function toSubmission(draft: FeedbackDraft, gameId: string): FeedbackSubmission {
  return {
    consent: true,
    gameId,
    completion: 'completed',
    rematch: draft.rematch,
    favoriteAgentId: draft.favoriteAgentId,
    favoriteMomentId: draft.favoriteMomentId,
    share: draft.share,
    replayIntent: draft.replayIntent,
    playtestPreference: draft.playtestPreference,
  };
}

/** 三态在 UI 上的中文措辞。 */
export const TRI_LABELS: Record<FeedbackTriState, string> = {
  yes: '会',
  maybe: '也许',
  no: '不会',
};

/** playtest 偏好在 UI 上的措辞(竖屏剧场 / 经典朴素 / 都行)。 */
export const PLAYTEST_LABELS: Record<PlaytestPreference, string> = {
  portrait: '竖屏剧场',
  b0: '经典朴素',
  no_preference: '都行',
};
