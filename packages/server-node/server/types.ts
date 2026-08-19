export type Role = 'civilian' | 'undercover';
export type Phase = 'describing' | 'voting' | 'finished';

export interface Player {
  id: string;
  name: string;
  avatar: string;
  isHuman: boolean;
  role: Role;
  word: string;
  alive: boolean;
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

export interface GameState {
  id: string;
  phase: Phase;
  round: number;
  ballot: number;
  players: Player[];
  descriptions: Description[];
  votes: Vote[];
  events: GameEvent[];
  eligibleTargetIds: string[] | null;
  winner: Role | null;
  review: GameReview | null;
  createdAt: number;
}

export interface PublicPlayer {
  id: string;
  name: string;
  avatar: string;
  isHuman: boolean;
  alive: boolean;
  revealedRole?: Role;
  revealedWord?: string;
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

/**
 * 上帝模式投影(附加能力,**独立于**冻结契约的 PublicGameState)
 *
 * 上帝模式是一桌**全 AI**(4 个 agent)自动对局的旁观视角:人类是「上帝」,能看见
 * 每个 agent 的公开发言 + 一句仅上帝可见的**内心 OS**(inner_monologue)。
 *
 * 关键隔离(与契约信息隔离同源、并未削弱):
 *  - 每个 agent 内部**仍**只经 buildAgentContext 的允许列拿到自己的身份/词,读不到他人身份;
 *  - 内心 OS 只汇入这份**上帝 DTO** 供旁观者观看,**绝不**进入任何 agent 的上下文、**绝不**落盘;
 *  - 这是一条独立端点(/api/god-games)与独立 DTO,契约冻结的 PublicGameState 不受影响。
 */
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

/** 策略投影:只暴露渲染所需字段,不含来源/样本 ID 等元数据。 */
export interface StrategyView {
  persona: string;
  tactics: string[];
  specificity: number;
  novelty: number;
  risk: number;
}

/**
 * 投票目标投影:交给模型的候选**只含非机密字段**,结构上不含 role/word。
 * 与 StrategyView 同源思路——机密不靠适配器自觉剥离,而由类型在边界处结构性拦截。
 */
export interface VoteTarget {
  id: string;
  name: string;
  isHuman: boolean;
  alive: boolean;
}

export interface AgentContext {
  identity: {
    playerId: string;
    name: string;
    role: Role;
    word: string;
  };
  strategy: StrategyView;
  game: {
    round: number;
    alivePlayers: Array<{ id: string; name: string }>;
    publicDescriptions: Array<{ playerId: string; playerName: string; text: string; round: number }>;
    publicEliminations: Array<{ text: string; round: number }>;
  };
}
