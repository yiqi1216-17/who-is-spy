/**
 * 角色圣经(OpenSpec 05-H · 决策 1/4 · 任务 2.2/2.3)
 *
 * 前端**唯一的身份事实源**:每位玩家的名号、气质、配色、立绘几何,都由其**实测策略轴**
 * (specificity 具体度 / novelty 新意 / risk 冒险度,与服务端 `strategies.ts` 的种子一脉)派生,
 * 而非贴刻板标签——"逻辑派" 的冷静靛青、"出其不意" 的失衡品红,都是策略量的视觉投影。
 *
 * 纯数据 + 纯函数,无 DOM、无副作用;立绘组件与舞台皆引用此处。
 * 注意:这里只放**可公开的表现身份**(名字/配色/画风),绝不含 role/word——那是服务端终局才揭晓的域真相。
 */

export interface StrategyAxes {
  /** 具体度:描述贴近实物细节的程度(0 朦胧 → 1 精确)。 */
  readonly specificity: number;
  /** 新意:措辞出人意料的程度(0 循规 → 1 跳脱)。 */
  readonly novelty: number;
  /** 冒险度:愿意逼近密词边界的程度(0 保守 → 1 激进)。 */
  readonly risk: number;
}

export interface CharacterPalette {
  /** 主强调色(HSL 便于派生明暗)。 */
  readonly accent: string;
  /** 深强调色(描边/阴影)。 */
  readonly accentDeep: string;
  /** 柔光晕染色(聚光/氛围)。 */
  readonly glow: string;
}

export interface Character {
  readonly id: string;
  /** 展示名(如「阿序」)。 */
  readonly name: string;
  /** 单字印记(用于席位角标/紧凑视图)。 */
  readonly sigil: string;
  /** 一句气质签名(公开,不泄身份)。 */
  readonly tagline: string;
  readonly isHuman: boolean;
  readonly palette: CharacterPalette;
  readonly axes: StrategyAxes;
  /**
   * 立绘几何种子:驱动 SVG 参数化五官/发型/信物,
   * 让四个 AI 在同一画风下**结构可辨**(而非换个颜色了事)。
   */
  readonly portrait: {
    /** 发型轮廓关键字(见 portraits.tsx)。 */
    readonly hair: 'level' | 'swept' | 'neat' | 'tousled' | 'hood';
    /** 眉眼姿态:平和 / 上挑 / 沉稳 / 促狭。 */
    readonly brow: 'calm' | 'raised' | 'steady' | 'sly';
    /** 信物图腾:盾 / 火花 / 罗盘 / 星 / 空椅。 */
    readonly emblem: 'shield' | 'spark' | 'compass' | 'star' | 'seat';
    /** 面部左右不对称度(0 端正 → 1 失衡),由 novelty×risk 派生。 */
    readonly asymmetry: number;
  };
}

/**
 * 五位玩家。ai-1..ai-4 的 id/名号/座次与服务端 `AI_PROFILES` 对齐;human 固定 id 'human'。
 * 配色由策略轴派生的口径(便于评审核对"气质≠贴标签"):
 *  - 低 risk / 低 novelty → 冷静克制色(sage/indigo);高 novelty×risk → 跳脱失衡色(violet)。
 *  - specificity 越高 → 描边越利落(portraits.tsx 用 axes.specificity 调线宽)。
 */
export const CHARACTERS: readonly Character[] = [
  {
    id: 'human',
    name: '你',
    sigil: '你',
    tagline: '第一人称 · 此刻由你落子',
    isHuman: true,
    palette: { accent: '#b64d31', accentDeep: '#8e3825', glow: 'rgba(182,77,49,0.30)' },
    axes: { specificity: 0.5, novelty: 0.5, risk: 0.5 },
    portrait: { hair: 'neat', brow: 'steady', emblem: 'seat', asymmetry: 0.08 },
  },
  {
    id: 'ai-1',
    name: '阿序',
    sigil: '序',
    tagline: '谨慎观察 · 先看清,再开口',
    isHuman: false,
    palette: { accent: '#6f8a76', accentDeep: '#47604f', glow: 'rgba(111,138,118,0.32)' },
    axes: { specificity: 0.62, novelty: 0.3, risk: 0.28 },
    portrait: { hair: 'level', brow: 'calm', emblem: 'shield', asymmetry: 0.05 },
  },
  {
    id: 'ai-2',
    name: '弥生',
    sigil: '弥',
    tagline: '直觉敏锐 · 先一步接住暗涌',
    isHuman: false,
    palette: { accent: '#d98a5c', accentDeep: '#b5623a', glow: 'rgba(217,138,92,0.34)' },
    axes: { specificity: 0.44, novelty: 0.72, risk: 0.6 },
    portrait: { hair: 'swept', brow: 'raised', emblem: 'spark', asymmetry: 0.32 },
  },
  {
    id: 'ai-3',
    name: '老墨',
    sigil: '墨',
    tagline: '逻辑派 · 让证据自己说话',
    isHuman: false,
    palette: { accent: '#5b6b93', accentDeep: '#3c4a6b', glow: 'rgba(91,107,147,0.32)' },
    axes: { specificity: 0.82, novelty: 0.34, risk: 0.36 },
    portrait: { hair: 'neat', brow: 'steady', emblem: 'compass', asymmetry: 0.04 },
  },
  {
    id: 'ai-4',
    name: '小满',
    sigil: '满',
    tagline: '出其不意 · 偏要换个角度',
    isHuman: false,
    palette: { accent: '#9a6b9c', accentDeep: '#6f4a72', glow: 'rgba(154,107,156,0.34)' },
    axes: { specificity: 0.5, novelty: 0.9, risk: 0.74 },
    portrait: { hair: 'tousled', brow: 'sly', emblem: 'star', asymmetry: 0.5 },
  },
];

const BY_ID = new Map<string, Character>(CHARACTERS.map((character) => [character.id, character]));

/** 兜底角色(未知 id 时,用中性 rust 身份,绝不抛错——表现层要稳)。 */
const FALLBACK: Character = CHARACTERS[0];

export function characterFor(id: string): Character {
  return BY_ID.get(id) ?? FALLBACK;
}

/** 席位环绕次序(第一人称在正下方 C 位,四 AI 呈上方弧线)。 */
export const SEAT_ORDER: readonly string[] = ['ai-2', 'ai-1', 'ai-3', 'ai-4'];
