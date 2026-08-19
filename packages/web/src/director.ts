/**
 * 放映导演(OpenSpec 05-H · 决策 2/3 · 任务 3.1/3.2)
 *
 * 服务端是**同步**契约:一次 describe/vote/continue 调用即返回整段新公开事件
 * (continue 甚至一次跑完余下所有轮)。因此「电影感」必须是**客户端**对**已知数据**的逐拍揭示——
 * 本模块把「新事件增量」线性化为一串 `Beat`,每拍携带:要投喂给表现层状态机的合法事件、
 * 聚光/嫌疑焦点、聚光文案、轮次横幅。纯函数、无 DOM,故可被 vitest 逐条钉死。
 *
 * 关键不变量(与 machine.ts 呼应):
 *  - 出局/终局这类**域权威结果**只由带 eventId 的 BALLOT_DONE/CONTINUE 承载,天然幂等;
 *  - 证词的起止(TESTIMONY_START/DONE)、轮次交接(CONTINUE→INTRO_DONE)全部显式入拍,
 *    使「人在场」与「已出局旁观(一次 continue 跑多轮)」共用同一放映管线。
 */
import type { Phase, PresentationEvent } from './presentation/machine';
import type { PortraitState } from './art/portraits';
import type { GameEvent, PublicGameState, PublicPlayer } from './types';

/** 聚光内容:speakerId 为 null 表示旁白/系统。kind 让呈现层区分证词/投票的抬头文案。 */
export interface Spotlight {
  readonly speakerId: string | null;
  readonly text: string;
  readonly muted: boolean;
  readonly kind?: 'testimony' | 'vote';
}

/** 一放映拍:携带可选的机器事件与视图更新。undefined 字段表示「保持不变」,null 表示「清空」。 */
export interface Beat {
  readonly id: string;
  readonly hold: number;
  readonly machine?: PresentationEvent;
  readonly focusId?: string | null;
  readonly suspectId?: string | null;
  readonly spotlight?: Spotlight | null;
  readonly banner?: string | null;
  /** 该拍揭示的权威事件 id(用于渐进式披露,如出局灰度)。 */
  readonly reveals?: string;
}

/** 各拍停留时长(ms)。降低动效时由放映层整体压缩。 */
export const HOLD = {
  testimony: 2400,
  human: 1500,
  vote: 1300,
  tie: 2200,
  eliminate: 2800,
  continue: 1300,
  bridge: 220,
} as const;

function humanOf(game: PublicGameState): PublicPlayer | undefined {
  return game.players.find((player) => player.isHuman);
}

function describedInRound(game: PublicGameState, playerId: string, round: number): boolean {
  return game.descriptions.some((item) => item.playerId === playerId && item.round === round);
}

/**
 * 把 `game.events[fromEventCount..]` 线性化为放映拍。
 * `startPhase` 为放映本段增量时机器所处相位(describe 后为 'testimony',vote 后为 'voting',
 * 旁观 continue 时为当前停泊相位)。系统事件只进公开记录、不进放映(其语义由横幅/行动坞覆盖)。
 */
export function planBeats(
  game: PublicGameState,
  fromEventCount: number,
  startPhase: Phase,
): Beat[] {
  const human = humanOf(game);
  const humanId = human?.id ?? '';
  const delta = game.events.slice(fromEventCount).filter((event) => event.type !== 'system');
  const beats: Beat[] = [];
  let control = 0;
  const controlId = (): string => `ctl-${fromEventCount}-${control++}`;
  const nameOf = (id: string): string =>
    game.players.find((player) => player.id === id)?.name ?? '某位玩家';

  // 某个票局结果(平票/出局)对应第几次计票(ballot):数它之前**同轮**已发生的平票次数 + 1。
  // 走**完整** game.events(而非仅本段 delta),故加票复投分多次 planBeats 调用时仍稳定对号,
  // 不会把加票局的票错认成首票局的票。
  const ballotOfOutcome = (outcome: GameEvent): number => {
    let ballot = 1;
    for (const event of game.events) {
      if (event.id === outcome.id) break;
      if (event.type === 'vote_result' && event.round === outcome.round) ballot += 1;
    }
    return ballot;
  };

  // 计票揭示(玩家模式缺口修复):把该 (round, ballot) 下**每一张票**——投票人 → 目标 + 理由——
  // 线性化为逐拍聚光,让「其他 agent 依自己判断对在场所有人投票」在玩家眼前逐张亮出:
  // 目标席位亮为嫌疑、投票人亮为发言,含**投向真人**与**AI 互投**(呼应 03-6 实战「票型」)。
  // 纯呈现拍(无 machine 事件),不改剧场相位;票空(如历史用例)则回退为零拍,行为不变。
  const revealBallot = (outcome: GameEvent): Beat[] => {
    const ballot = ballotOfOutcome(outcome);
    return game.votes
      .filter((vote) => vote.round === outcome.round && vote.ballot === ballot)
      .map((vote) => {
        const targetName = nameOf(vote.targetId);
        const isHumanVoter = vote.voterId === humanId;
        return {
          id: `vote-${outcome.round}-${ballot}-${vote.voterId}`,
          hold: HOLD.vote,
          focusId: vote.voterId,
          suspectId: vote.targetId,
          spotlight: {
            speakerId: vote.voterId,
            text: isHumanVoter ? `你把票投给了「${targetName}」` : `我投「${targetName}」· ${vote.reason}`,
            muted: false,
            kind: 'vote',
          },
        };
      });
  };

  let inTestimony = startPhase === 'testimony';

  const closeTestimony = (next: 'human-vote' | 'ballot'): void => {
    beats.push({ id: controlId(), hold: HOLD.bridge, machine: { type: 'TESTIMONY_DONE', next }, focusId: null });
    inTestimony = false;
  };

  for (let index = 0; index < delta.length; index += 1) {
    const event = delta[index];
    const moreDescriptionsAhead = delta.slice(index + 1).some((item) => item.type === 'description');

    if (event.type === 'description') {
      inTestimony = true;
      const isHuman = event.playerId === humanId;
      beats.push({
        id: event.id,
        hold: isHuman ? HOLD.human : HOLD.testimony,
        machine: { type: 'TESTIMONY_START', speakerId: event.playerId ?? '' },
        focusId: event.playerId ?? null,
        suspectId: null,
        spotlight: { speakerId: event.playerId ?? null, text: event.text, muted: false },
        reveals: event.id,
      });
      continue;
    }

    // 证词段遇到票局事件即收束(AI 已自动投票 → 直接计票)。
    if (inTestimony) closeTestimony('ballot');

    if (event.type === 'vote_result') {
      beats.push(...revealBallot(event));
      beats.push({
        id: event.id,
        hold: HOLD.tie,
        machine: { type: 'BALLOT_DONE', outcome: 'tie', eventId: event.id },
        focusId: null,
        suspectId: null,
        spotlight: { speakerId: null, text: event.text, muted: true },
        reveals: event.id,
      });
      continue;
    }

    if (event.type === 'elimination') {
      beats.push(...revealBallot(event));
      const finished = !moreDescriptionsAhead && game.phase === 'finished';
      beats.push({
        id: event.id,
        hold: HOLD.eliminate,
        machine: { type: 'BALLOT_DONE', outcome: 'eliminated', eventId: event.id, focusId: event.playerId },
        focusId: event.playerId ?? null,
        suspectId: event.playerId ?? null,
        spotlight: { speakerId: null, text: event.text, muted: true },
        reveals: event.id,
      });
      beats.push({
        id: controlId(),
        hold: HOLD.continue,
        machine: { type: 'CONTINUE', finished, eventId: `${event.id}::cont` },
        focusId: null,
        suspectId: null,
        spotlight: null,
        banner: finished ? null : `第 ${event.round + 1} 轮`,
      });
      if (!finished) {
        const upcoming = event.round + 1;
        const humanTurn =
          !!human?.alive &&
          game.phase === 'describing' &&
          upcoming === game.round &&
          !describedInRound(game, humanId, upcoming);
        beats.push({ id: controlId(), hold: HOLD.bridge, machine: { type: 'INTRO_DONE', humanTurn }, focusId: null });
        inTestimony = !humanTurn;
      }
      continue;
    }
  }

  // 段末仍在证词中(describe 响应:人在场,该他投票了)。
  if (inTestimony) {
    const humanVotesNext = game.phase === 'voting' && !!human?.alive;
    closeTestimony(humanVotesNext ? 'human-vote' : 'ballot');
  }

  return beats;
}

/** 由「聚光/嫌疑焦点 + 已揭示出局集」派生某席位的立绘状态(纯函数)。 */
export function seatState(
  player: PublicPlayer,
  opts: { focusId: string | null; suspectId: string | null; eliminatedRevealed: ReadonlySet<string> },
): PortraitState {
  if (opts.eliminatedRevealed.has(player.id)) return 'eliminated';
  if (opts.focusId === player.id) return 'speaking';
  if (opts.suspectId === player.id) return 'suspect';
  return 'idle';
}

/** 已被放映揭示的出局者集合(用于灰度):出局事件 id 命中 revealed 才算数。 */
export function eliminatedRevealed(events: readonly GameEvent[], revealed: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const event of events) {
    if (event.type === 'elimination' && event.playerId && revealed.has(event.id)) out.add(event.playerId);
  }
  return out;
}

/** 玩家当前可交互模式(以**服务端权威 game 状态**为准,天然处理平票复投)。 */
export type Interaction = 'describe' | 'vote' | 'spectate' | 'finale' | 'none';

export function interactionMode(
  game: PublicGameState,
  opts: { queueEmpty: boolean; online: boolean },
): Interaction {
  if (!opts.online || !opts.queueEmpty) return 'none';
  if (game.phase === 'finished') return 'finale';
  const human = humanOf(game);
  if (!human) return 'none';
  if (!human.alive) return 'spectate';
  if (game.phase === 'describing') {
    return describedInRound(game, human.id, game.round) ? 'none' : 'describe';
  }
  if (game.phase === 'voting') return 'vote';
  return 'none';
}
