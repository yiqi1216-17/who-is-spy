import type { HighlightCard, HighlightMeasure, HighlightType } from './types';

/**
 * 高光时刻 · 呈现元数据与纯格式化(OpenSpec 05-H · 任务 5.4)
 *
 * 组件只负责取数与摆放;「类型→中文标签/口吻/强调色」「度量格式化」「事件援引脚注」
 * 这些确定性映射抽到本模块,便于 vitest 钉死(不依赖 DOM)。强调色一律引用设计令牌,
 * 与终局面板同一套配色语言。
 */

export interface HighlightMeta {
  /** 中文短标签(徽章)。 */
  readonly label: string;
  /** 一句话口吻/说明(读者理解这是"哪一类时刻")。 */
  readonly tone: string;
  /** 强调色(CSS 变量名,复用终局配色令牌)。 */
  readonly accent: string;
  /** lucide 图标名(组件按名取用,保持本模块无 JSX 依赖)。 */
  readonly icon: string;
}

/** 七类高光的呈现元数据。顺序即"叙事优先级"参考,但真实排名以服务端 score 为准。 */
export const HIGHLIGHT_META: Record<HighlightType, HighlightMeta> = {
  decisive_vote: { label: '一票定局', tone: '险胜出局,挪走一票便改写结局', accent: '--rust', icon: 'Scale' },
  consensus_flip: { label: '风向骤变', tone: '此前无人怀疑者,转瞬成众矢之的', accent: '--indigo', icon: 'Shuffle' },
  self_save: { label: '悬崖自救', tone: '首轮领跑,却在加票中全身而退', accent: '--gold', icon: 'ShieldCheck' },
  lone_correct_read: { label: '孤独指认', tone: '满桌无人附和的一次指认', accent: '--amber', icon: 'Crosshair' },
  undercover_blend: { label: '潜行时刻', tone: '存活一轮却一票未得', accent: '--sage', icon: 'EyeOff' },
  callback: { label: '伏笔呼应', tone: '跨轮回收的一条暗线', accent: '--indigo', icon: 'Link2' },
  novel_safe_metaphor: { label: '剑走偏锋', tone: '全场最离群,却没引火烧身', accent: '--amber', icon: 'Sparkle' },
};

/** 未知类型的兜底(前向兼容:服务端新增类型时不至于崩)。 */
export const FALLBACK_META: HighlightMeta = {
  label: '高光',
  tone: '一处值得回看的瞬间',
  accent: '--gold',
  icon: 'Star',
};

export function metaFor(type: HighlightType): HighlightMeta {
  return HIGHLIGHT_META[type] ?? FALLBACK_META;
}

/** 度量格式化:有 before/after 出"3 → 5",否则出单值;缺失出空串。 */
export function formatMeasure(measure: HighlightMeasure): string {
  if (measure.before !== undefined && measure.after !== undefined) {
    return `${measure.before} → ${measure.after}`;
  }
  if (measure.value !== undefined) return String(measure.value);
  return '';
}

/** 事件援引脚注:把 citedEventIds 折成短标注,可视化"标题援引事件 id"(与忠实性闸对应)。 */
export function citationLabel(card: Pick<HighlightCard, 'citedEventIds'>): string {
  if (card.citedEventIds.length === 0) return '';
  return `据 ${card.citedEventIds.join(' · ')}`;
}

/** 是否已解锁剧透层(仅当卡片确实携带 spoiler 时为真)。 */
export function hasSpoiler(card: Pick<HighlightCard, 'spoiler'>): boolean {
  return card.spoiler !== undefined && card.spoiler !== null;
}
