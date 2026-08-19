import type { Character } from '../characters';

/**
 * 参数化角色立绘(OpenSpec 05-H · 决策 4 · 任务 2.2)
 *
 * 一套**原创、矢量、离线**的水墨极简肖像系统:同一「半身像」模板,由角色的
 * `portrait` 几何种子 + `axes` 策略量驱动出**结构可辨**的五张脸——发型/眉眼/信物/不对称度各不同,
 * 线宽随 specificity 变利落。ARK 文生图不可用时,这就是保底且更高级的美术层(任意 DPI 清晰、入库无二进制)。
 *
 * 表情随 `state` 变化:idle 平视 / speaking 开口发言 / eliminated 阖眼落幕。
 * 纯函数组件,可被 tsc 把关;动效交由父级 CSS(尊重 prefers-reduced-motion)。
 */

export type PortraitState = 'idle' | 'speaking' | 'suspect' | 'eliminated';

/** 发型轮廓路径(基于 head 中心 x≈100、顶 y≈40 的坐标系)。 */
function hairPath(kind: Character['portrait']['hair']): string {
  switch (kind) {
    case 'level': // 阿序:齐整平刘海,克制
      return 'M52 92 C50 54 74 34 100 34 C126 34 150 54 148 92 C148 74 132 66 100 68 C68 66 52 74 52 92 Z';
    case 'swept': // 弥生:侧扫,带动势
      return 'M50 96 C46 52 78 32 104 34 C136 36 154 60 148 96 C150 70 150 58 120 58 C96 58 78 70 66 96 C60 78 56 82 50 96 Z';
    case 'neat': // 老墨 / 你:利落圆顶
      return 'M54 90 C54 54 76 36 100 36 C124 36 146 54 146 90 C146 68 128 60 100 60 C72 60 54 68 54 90 Z';
    case 'tousled': // 小满:凌乱挑起,失衡
      return 'M50 94 C48 56 72 32 100 34 C122 36 138 30 150 52 C154 64 146 74 150 96 C142 78 138 72 126 74 C120 60 106 62 100 64 C84 62 70 66 62 84 C58 74 54 84 50 94 Z';
    case 'hood':
      return 'M44 120 C40 60 74 26 100 26 C126 26 160 60 156 120 C150 96 132 84 100 84 C68 84 50 96 44 120 Z';
  }
}

/** 信物图腾(画在头像后方一角,低透明度,accent 色)。 */
function emblemPath(kind: Character['portrait']['emblem']): string {
  switch (kind) {
    case 'shield':
      return 'M100 24 L128 36 V64 C128 84 100 96 100 96 C100 96 72 84 72 64 V36 Z';
    case 'spark':
      return 'M100 20 L110 60 L150 70 L110 80 L100 120 L90 80 L50 70 L90 60 Z';
    case 'compass':
      return 'M100 22 L118 70 L100 60 L82 70 Z M100 118 L82 70 L100 80 L118 70 Z';
    case 'star': // 失衡的星,呼应"出其不意"
      return 'M100 20 L114 58 L156 62 L122 84 L134 124 L100 100 L70 126 L80 84 L46 60 L90 58 Z';
    case 'seat': // 空椅,第一人称的留白
      return 'M74 54 H126 V62 H74 Z M78 62 V104 H86 V62 Z M114 62 V104 H122 V62 Z M74 78 H126 V86 H74 Z';
  }
}

interface EyeSpec {
  brow: Character['portrait']['brow'];
  state: PortraitState;
}

/** 依据眉眼姿态 + 状态,给出左右眉/眼/嘴的 SVG 片段。 */
function faceElements(spec: EyeSpec, stroke: string, lineWidth: number) {
  const { brow, state } = spec;
  const closed = state === 'eliminated';
  const speaking = state === 'speaking';

  // 眉形:平和/上挑/沉稳/促狭 → 不同斜率与高度
  const brows: Record<EyeSpec['brow'], { l: string; r: string }> = {
    calm: { l: 'M74 96 q10 -4 20 0', r: 'M106 96 q10 -4 20 0' },
    raised: { l: 'M74 92 q10 -8 20 -4', r: 'M106 96 q10 -3 20 1' },
    steady: { l: 'M74 96 h20', r: 'M106 96 h20' },
    sly: { l: 'M74 98 q10 -2 20 -6', r: 'M106 94 q10 2 20 -2' },
  };

  return (
    <g fill="none" stroke={stroke} strokeWidth={lineWidth} strokeLinecap="round" strokeLinejoin="round">
      {/* 眉 */}
      <path d={brows[brow].l} />
      <path d={brows[brow].r} />
      {/* 眼:睁 = 杏形;阖 = 短横 */}
      {closed ? (
        <>
          <path d="M76 112 h16" />
          <path d="M108 112 h16" />
        </>
      ) : (
        <>
          <path d="M76 110 q8 -8 16 0 q-8 8 -16 0 Z" fill={stroke} stroke="none" />
          <path d="M108 110 q8 -8 16 0 q-8 8 -16 0 Z" fill={stroke} stroke="none" />
        </>
      )}
      {/* 鼻:一笔轻带 */}
      <path d="M100 116 q-4 12 -6 18 q4 4 10 2" opacity={0.55} />
      {/* 嘴:发言时张口,平常抿线,落幕时下抿 */}
      {speaking ? (
        <ellipse cx={100} cy={150} rx={9} ry={7} fill={stroke} stroke="none" opacity={0.85} />
      ) : closed ? (
        <path d="M88 150 q12 -6 24 0" opacity={0.7} />
      ) : (
        <path d="M88 150 q12 4 24 0" opacity={0.8} />
      )}
    </g>
  );
}

export interface PortraitProps {
  character: Character;
  state?: PortraitState;
  /** 像素尺寸(正方 viewBox 缩放);默认随容器。 */
  size?: number;
  className?: string;
  /** 是否显示信物图腾(紧凑席位可关)。 */
  emblem?: boolean;
}

export function Portrait({ character, state = 'idle', size, className, emblem = true }: PortraitProps) {
  const { palette, portrait, axes, name } = character;
  const ink = '#241f1a';
  const line = 2.3 + axes.specificity * 1.3; // 具体度越高线越利落
  const skew = portrait.asymmetry * 6; // 不对称度 → 轻微整体偏摆
  const uid = `pt-${character.id}`;
  const stateLabel =
    state === 'speaking' ? '发言中' : state === 'eliminated' ? '已出局' : state === 'suspect' ? '受质疑' : '在场';

  return (
    <svg
      className={className}
      viewBox="0 0 200 240"
      width={size}
      height={size ? size * 1.2 : undefined}
      role="img"
      aria-label={`${name}·${stateLabel}`}
      style={{ overflow: 'visible' }}
    >
      <defs>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="42%" r="60%">
          <stop offset="0%" stopColor={palette.accent} stopOpacity={state === 'speaking' ? 0.55 : 0.32} />
          <stop offset="60%" stopColor={palette.accent} stopOpacity={0.1} />
          <stop offset="100%" stopColor={palette.accent} stopOpacity={0} />
        </radialGradient>
        <linearGradient id={`${uid}-skin`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f3e8d6" />
          <stop offset="100%" stopColor="#e7d7bf" />
        </linearGradient>
        <clipPath id={`${uid}-clip`}>
          <rect x="0" y="0" width="200" height="240" rx="20" />
        </clipPath>
      </defs>

      {/* 聚光晕染 */}
      <circle cx="100" cy="100" r="96" fill={`url(#${uid}-glow)`} />

      <g
        clipPath={`url(#${uid}-clip)`}
        style={{ filter: state === 'eliminated' ? 'grayscale(0.85) opacity(0.72)' : undefined }}
      >
        {/* 信物图腾:头后一角,低透明度 */}
        {emblem && (
          <path
            d={emblemPath(portrait.emblem)}
            fill={palette.accent}
            opacity={0.14}
            transform="translate(0 -4)"
          />
        )}

        <g transform={`rotate(${skew} 100 130)`}>
          {/* 肩 */}
          <path
            d="M40 240 C40 196 66 178 100 178 C134 178 160 196 160 240 Z"
            fill={palette.accent}
            opacity={0.9}
          />
          <path
            d="M40 240 C40 196 66 178 100 178 C134 178 160 196 160 240 Z"
            fill="none"
            stroke={palette.accentDeep}
            strokeWidth={line}
          />
          {/* 颈 */}
          <path d="M88 176 h24 v14 q-12 8 -24 0 Z" fill="#e7d7bf" stroke={ink} strokeWidth={line * 0.7} />
          {/* 头 */}
          <ellipse cx="100" cy="120" rx="50" ry="56" fill={`url(#${uid}-skin)`} stroke={ink} strokeWidth={line} />
          {/* 发 */}
          <path d={hairPath(portrait.hair)} fill={ink} />
          {/* 面部 */}
          {faceElements({ brow: portrait.brow, state }, ink, line)}
        </g>
      </g>

      {/* 落幕面纱 */}
      {state === 'eliminated' && (
        <rect x="0" y="0" width="200" height="240" rx="20" fill="#1b1916" opacity={0.28} />
      )}
    </svg>
  );
}

/**
 * 舞台背景:圆桌剧场的聚光锥 + 尘埃,纯 SVG(比位图更轻、任意分辨率锐利)。
 * 作为 9:16 舞台外壳的底层氛围,置于 z 轴最底。
 */
export function StageBackdrop({ accent = '#b64d31' }: { accent?: string }) {
  return (
    <svg
      className="stage-backdrop"
      viewBox="0 0 390 844"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="stage-spot" cx="50%" cy="30%" r="70%">
          <stop offset="0%" stopColor={accent} stopOpacity={0.16} />
          <stop offset="45%" stopColor={accent} stopOpacity={0.05} />
          <stop offset="100%" stopColor={accent} stopOpacity={0} />
        </radialGradient>
        <linearGradient id="stage-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff6e6" stopOpacity={0.16} />
          <stop offset="100%" stopColor="#fff6e6" stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="390" height="844" fill="url(#stage-spot)" />
      {/* 聚光锥 */}
      <path d="M150 -20 L240 -20 L340 560 L50 560 Z" fill="url(#stage-cone)" />
      {/* 圆桌暗影 */}
      <ellipse cx="195" cy="600" rx="200" ry="60" fill="#0f0d0b" opacity={0.32} />
      <ellipse cx="195" cy="596" rx="150" ry="42" fill="none" stroke={accent} strokeOpacity={0.12} strokeWidth={2} />
    </svg>
  );
}
