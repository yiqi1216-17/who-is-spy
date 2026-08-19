export type Role = 'civilian' | 'undercover';
export type Phase = 'describing' | 'voting' | 'finished';

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  isHuman: boolean;
  alive: boolean;
  revealedRole?: Role;
  revealedWord?: string;
}

export interface GameEvent {
  id: string;
  type: 'system' | 'description' | 'vote_result' | 'elimination';
  text: string;
  round: number;
  playerId?: string;
}

export interface GameReview {
  headline: string;
  summary: string;
  turningPoints: string[];
  playerInsights: Array<{ playerId: string; insight: string }>;
}

export interface Description {
  playerId: string;
  text: string;
  round: number;
}

export interface Vote {
  voterId: string;
  targetId: string;
  reason: string;
  round: number;
  ballot: number;
}

export interface PublicGameState {
  id: string;
  phase: Phase;
  round: number;
  ballot: number;
  players: PublicPlayer[];
  descriptions: Description[];
  votes: Vote[];
  events: GameEvent[];
  eligibleTargetIds: string[] | null;
  winner: Role | null;
  review: GameReview | null;
  human: { playerId: string; role: Role; word: string };
  model: string;
}

// —— 上帝模式 DTO(镜像服务端 GodGameState;独立端点,不属冻结契约)——
// 上帝视角对旁观者揭示一切:每席的 role/word/策略,以及每步公开发言背后的一句内心 OS。
// 隔离不减——OS 只存在于这份投影里,服务端绝不把它喂给任何 agent、绝不落盘。

/** 策略投影:只含渲染所需字段。 */
export interface StrategyView {
  persona: string;
  tactics: string[];
  specificity: number;
  novelty: number;
  risk: number;
}

/** 上帝可见的席位:含域真相 role/word 与策略画像。 */
export interface GodPlayerView {
  id: string;
  name: string;
  avatar: string;
  alive: boolean;
  role: Role;
  word: string;
  strategy: StrategyView;
}

/** 一句仅上帝可见的内心独白,锚定到某轮某个 agent 的发言。 */
export interface GodThought {
  round: number;
  playerId: string;
  text: string;
}

export interface GodGameState {
  id: string;
  phase: Phase;
  round: number;
  ballot: number;
  players: GodPlayerView[];
  descriptions: Description[];
  votes: Vote[];
  events: GameEvent[];
  thoughts: GodThought[];
  winner: Role | null;
  review: GameReview | null;
  model: string;
}

// —— 高光时刻(OpenSpec 05-H · 任务 5.3/5.4;与服务端 highlights.ts 同源) ——

export type HighlightType =
  | 'decisive_vote'
  | 'consensus_flip'
  | 'self_save'
  | 'lone_correct_read'
  | 'undercover_blend'
  | 'callback'
  | 'novel_safe_metaphor';

export interface HighlightQuote {
  playerId: string;
  round: number;
  text: string;
  eventId?: string;
}

export interface HighlightVoteRef {
  voterId: string;
  targetId: string;
  round: number;
  ballot: number;
}

export interface HighlightMeasure {
  label: string;
  before?: number;
  after?: number;
  value?: number;
}

/** 剧透层:仅终局 + ?spoilers=1 时随卡片附出(身份/密词/结构化信念增量,无自由文本)。 */
export interface HighlightSpoiler {
  note: string;
  roleReveals?: Array<{ playerId: string; role: Role; word: string }>;
  beliefDeltas?: Array<{ agentId: string; targetId: string; before: number; after: number }>;
}

export interface HighlightCard {
  id: string;
  type: HighlightType;
  round: number;
  title: string;
  caption: string;
  citedEventIds: string[];
  citedVotes: HighlightVoteRef[];
  quotes: HighlightQuote[];
  measures: HighlightMeasure[];
  spoiler?: HighlightSpoiler;
}

export interface HighlightReel {
  available: boolean;
  cards: HighlightCard[];
}
