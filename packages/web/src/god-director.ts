/**
 * 上帝放映导演(双模式 · 上帝模式)
 *
 * 与玩家导演(director.ts)同源思路,但更简单:上帝端点**一次性**回传整局已解算的
 * GodGameState,故这里无需增量/机器相位——把整段公开事件线性化为一串**自走**的 `GodBeat`,
 * 每拍携带镜头焦点、聚光文案,以及**仅上帝可见**的一句内心 OS(只挂在描述拍上)。
 *
 * 纯函数、无 DOM,可被 vitest 逐拍钉死。内心 OS 只在这份投影里出现,绝不回喂任何 agent。
 */
import type { GameEvent, GodGameState } from './types';

/** 一上帝放映拍。kind 决定呈现层如何渲染;focus/suspect 驱动席位状态。 */
export interface GodBeat {
  readonly id: string;
  readonly hold: number;
  readonly kind: 'round' | 'describe' | 'vote' | 'tie' | 'eliminate' | 'finale';
  readonly round: number;
  readonly speakerId: string | null;
  readonly targetId: string | null;
  readonly text: string;
  /** 仅描述拍携带:该 agent 这一句背后的内心独白(上帝可见)。 */
  readonly thought: string | null;
  readonly focusId: string | null;
  readonly suspectId: string | null;
}

/** 各拍停留时长(ms)。描述拍更久——旁观者要同时读公开发言与内心 OS。 */
export const GOD_HOLD = {
  round: 1500,
  describe: 3400,
  vote: 1600,
  tie: 2000,
  eliminate: 2800,
  finale: 800,
} as const;

/**
 * 把整局 GodGameState 线性化为放映拍序列。
 * 事件本就按时序排列:每轮 描述×N →(平票?)→ 出局 →(下一轮系统事件)。
 * 计票结果之前先逐张揭示该 (round,ballot) 的选票(含 AI 互投),与玩家模式「票型」一致。
 */
export function planGodBeats(game: GodGameState): GodBeat[] {
  const beats: GodBeat[] = [];
  const nameOf = (id: string): string =>
    game.players.find((player) => player.id === id)?.name ?? '某位玩家';
  const thoughtOf = (round: number, playerId: string): string | null =>
    game.thoughts.find((t) => t.round === round && t.playerId === playerId)?.text ?? null;

  // 某票局结果对应第几次计票:数它之前同轮已发生的平票次数 + 1(与 director.ts 同法)。
  const ballotOfOutcome = (outcome: GameEvent): number => {
    let ballot = 1;
    for (const event of game.events) {
      if (event.id === outcome.id) break;
      if (event.type === 'vote_result' && event.round === outcome.round) ballot += 1;
    }
    return ballot;
  };

  const revealBallot = (outcome: GameEvent): GodBeat[] => {
    const ballot = ballotOfOutcome(outcome);
    return game.votes
      .filter((vote) => vote.round === outcome.round && vote.ballot === ballot)
      .map((vote) => ({
        id: `gvote-${outcome.round}-${ballot}-${vote.voterId}`,
        hold: GOD_HOLD.vote,
        kind: 'vote' as const,
        round: outcome.round,
        speakerId: vote.voterId,
        targetId: vote.targetId,
        text: `${nameOf(vote.voterId)} 投「${nameOf(vote.targetId)}」· ${vote.reason}`,
        thought: null,
        focusId: vote.voterId,
        suspectId: vote.targetId,
      }));
  };

  let lastRound = 0;
  for (const event of game.events) {
    if (event.type === 'system') continue;
    if (event.round !== lastRound) {
      lastRound = event.round;
      beats.push({
        id: `ground-${event.round}`,
        hold: GOD_HOLD.round,
        kind: 'round',
        round: event.round,
        speakerId: null,
        targetId: null,
        text: `第 ${event.round} 轮`,
        thought: null,
        focusId: null,
        suspectId: null,
      });
    }

    if (event.type === 'description') {
      beats.push({
        id: event.id,
        hold: GOD_HOLD.describe,
        kind: 'describe',
        round: event.round,
        speakerId: event.playerId ?? null,
        targetId: null,
        text: event.text,
        thought: thoughtOf(event.round, event.playerId ?? ''),
        focusId: event.playerId ?? null,
        suspectId: null,
      });
      continue;
    }

    if (event.type === 'vote_result') {
      beats.push(...revealBallot(event));
      beats.push({
        id: event.id,
        hold: GOD_HOLD.tie,
        kind: 'tie',
        round: event.round,
        speakerId: null,
        targetId: null,
        text: event.text,
        thought: null,
        focusId: null,
        suspectId: null,
      });
      continue;
    }

    if (event.type === 'elimination') {
      beats.push(...revealBallot(event));
      beats.push({
        id: event.id,
        hold: GOD_HOLD.eliminate,
        kind: 'eliminate',
        round: event.round,
        speakerId: null,
        targetId: event.playerId ?? null,
        text: event.text,
        thought: null,
        focusId: event.playerId ?? null,
        suspectId: event.playerId ?? null,
      });
      continue;
    }
  }

  if (game.phase === 'finished') {
    beats.push({
      id: 'gfinale',
      hold: GOD_HOLD.finale,
      kind: 'finale',
      round: game.round,
      speakerId: null,
      targetId: null,
      text: '真相揭晓',
      thought: null,
      focusId: null,
      suspectId: null,
    });
  }

  return beats;
}

/** 派生:放映到 beatIndex(含)为止,已出局的席位集合(用于灰度)。纯函数。 */
export function godEliminated(beats: readonly GodBeat[], beatIndex: number): Set<string> {
  const out = new Set<string>();
  for (let index = 0; index <= beatIndex && index < beats.length; index += 1) {
    const beat = beats[index];
    if (beat.kind === 'eliminate' && beat.targetId) out.add(beat.targetId);
  }
  return out;
}
