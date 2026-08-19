/**
 * 表现层状态机(OpenSpec 05-H · 决策 2/3 · 任务 1.2)
 *
 * 把「屏幕此刻在演什么」(cinematic 表现)与「域权威真相」(谁出局/谁赢)**彻底分离**:
 *  - 表现层只负责编排镜头/输入闸,**绝不**自己裁定出局或胜负;
 *  - 出局/终局这类权威结果只能由服务端事件(`BALLOT_DONE`/`CONTINUE`)驱动,并**按事件 id 幂等**;
 *  - 网络轴(live/reconnecting/failed)是**独立坐标**,永不改变剧场 phase——
 *    "动画放完了" 和 "网络断了" 是两件正交的事(spec 明确要求二者独立)。
 *
 * 全部为**纯函数**,无 DOM、无副作用,故可被 vitest 在 node 环境逐条钉死。
 */

/** 剧场阶段(spec 固定清单:home/role-reveal/round-intro/testimony/human-action/voting/elimination/finale/highlights/replay)。 */
export type Phase =
  | 'home'
  | 'role-reveal'
  | 'round-intro'
  | 'testimony'
  | 'human-action'
  | 'voting'
  | 'elimination'
  | 'finale'
  | 'highlights'
  | 'replay';

/** 网络轴:与 phase 正交。failure/reconnect 作为**叠加态**由 `overlay()` 派生。 */
export type Network = 'live' | 'reconnecting' | 'failed';

export interface PresentationState {
  readonly phase: Phase;
  readonly network: Network;
  /** 当前聚光席位(testimony 聚焦发言者 / elimination 聚焦出局者),无则 null。 */
  readonly focusId: string | null;
  /** 已消费的权威事件 id —— 幂等闸:同 id 再来一次即 no-op(不重放动画、不二次推进)。 */
  readonly consumed: readonly string[];
  /** 最近一次被拒的非法转移(仅供调试/测试可见);任一合法转移后清空为 null。 */
  readonly rejected: string | null;
}

export type PresentationEvent =
  // —— 剧场动画完成信号(只推进镜头,**绝不**裁定域结果)——
  | { type: 'START' }
  | { type: 'REVEAL_DONE' }
  | { type: 'INTRO_DONE'; humanTurn: boolean }
  | { type: 'TESTIMONY_START'; speakerId: string }
  | { type: 'TESTIMONY_DONE'; next: 'more' | 'human-vote' | 'ballot' }
  | { type: 'HUMAN_DESCRIBED' }
  | { type: 'HUMAN_VOTED' }
  // —— 域权威事件(带 eventId,幂等)——
  | { type: 'BALLOT_DONE'; outcome: 'eliminated' | 'tie'; eventId: string; focusId?: string }
  | { type: 'CONTINUE'; finished: boolean; eventId: string }
  // —— 终局叠层导航 ——
  | { type: 'OPEN_HIGHLIGHTS' }
  | { type: 'OPEN_REPLAY' }
  | { type: 'CLOSE_OVERLAY' }
  // —— 网络轴(独立;永不改 phase)——
  | { type: 'NET_LOST' }
  | { type: 'NET_RETRYING' }
  | { type: 'NET_OK' }
  // —— 重开 ——
  | { type: 'RESET' };

export const PRESENTATION_PHASES: readonly Phase[] = [
  'home',
  'role-reveal',
  'round-intro',
  'testimony',
  'human-action',
  'voting',
  'elimination',
  'finale',
  'highlights',
  'replay',
];

export function initialState(): PresentationState {
  return { phase: 'home', network: 'live', focusId: null, consumed: [], rejected: null };
}

/** 只推进 phase 的纯转移表;非法转移返回 null(由 `reduce` 记成 rejected)。 */
function advancePhase(state: PresentationState, event: PresentationEvent): PresentationState | null {
  switch (state.phase) {
    case 'home':
      return event.type === 'START' ? { ...state, phase: 'role-reveal' } : null;

    case 'role-reveal':
      return event.type === 'REVEAL_DONE' ? { ...state, phase: 'round-intro' } : null;

    case 'round-intro':
      if (event.type === 'INTRO_DONE') {
        return { ...state, phase: event.humanTurn ? 'human-action' : 'testimony' };
      }
      return null;

    case 'testimony':
      if (event.type === 'TESTIMONY_START') {
        return { ...state, phase: 'testimony', focusId: event.speakerId };
      }
      if (event.type === 'TESTIMONY_DONE') {
        if (event.next === 'more') return { ...state, phase: 'testimony' };
        if (event.next === 'human-vote') return { ...state, phase: 'human-action', focusId: null };
        return { ...state, phase: 'voting', focusId: null }; // 'ballot'(人类已出局,直接进 AI 计票)
      }
      return null;

    case 'human-action':
      if (event.type === 'HUMAN_DESCRIBED') return { ...state, phase: 'testimony' };
      if (event.type === 'HUMAN_VOTED') return { ...state, phase: 'voting' };
      return null;

    case 'voting':
      if (event.type === 'BALLOT_DONE') {
        const consumed = [...state.consumed, event.eventId];
        // 平票 → 复投(留在 voting);出局 → 进 elimination 并聚焦出局者。
        if (event.outcome === 'tie') return { ...state, phase: 'voting', consumed };
        return { ...state, phase: 'elimination', focusId: event.focusId ?? null, consumed };
      }
      return null;

    case 'elimination':
      if (event.type === 'CONTINUE') {
        const consumed = [...state.consumed, event.eventId];
        return { ...state, phase: event.finished ? 'finale' : 'round-intro', focusId: null, consumed };
      }
      return null;

    case 'finale':
      if (event.type === 'OPEN_HIGHLIGHTS') return { ...state, phase: 'highlights' };
      if (event.type === 'OPEN_REPLAY') return { ...state, phase: 'replay' };
      return null;

    case 'highlights':
    case 'replay':
      return event.type === 'CLOSE_OVERLAY' ? { ...state, phase: 'finale' } : null;

    default:
      return null;
  }
}

/**
 * 纯 reducer:唯一入口。三层处理次序 = 网络轴 → 幂等闸 → phase 转移。
 */
export function reduce(state: PresentationState, event: PresentationEvent): PresentationState {
  // 1) 网络轴与重开:独立于剧场,永不改动 phase/focus。
  switch (event.type) {
    case 'NET_LOST':
      return { ...state, network: 'failed', rejected: null };
    case 'NET_RETRYING':
      return { ...state, network: 'reconnecting', rejected: null };
    case 'NET_OK':
      return { ...state, network: 'live', rejected: null };
    case 'RESET':
      return { ...initialState(), network: state.network }; // 不谎报连通性:网络轴跨重开保留
    default:
      break;
  }

  // 2) 幂等闸:权威事件(出局/继续)按 eventId 去重——重复/乱序重投一律 no-op。
  if ((event.type === 'BALLOT_DONE' || event.type === 'CONTINUE') && state.consumed.includes(event.eventId)) {
    return state; // 既不重放动画,也不二次推进
  }

  // 3) phase 转移;非法则记 rejected(便于测试/调试断言),状态其余不变。
  const next = advancePhase(state, event);
  if (next === null) {
    return { ...state, rejected: `${state.phase} ⇏ ${event.type}` };
  }
  return next.rejected === null ? next : { ...next, rejected: null };
}

/** 折叠一串事件,便于测试与回放驱动。 */
export function run(events: readonly PresentationEvent[], from: PresentationState = initialState()): PresentationState {
  return events.reduce(reduce, from);
}

/** 网络叠加态(与 phase 正交):断线/重连遮罩由此派生,不污染剧场 phase。 */
export function overlay(state: PresentationState): 'failure' | 'reconnect' | null {
  if (state.network === 'failed') return 'failure';
  if (state.network === 'reconnecting') return 'reconnect';
  return null;
}

/** 输入闸:必须**同时**处于人类行动阶段 **且** 网络在线——正交性的直接体现。 */
export function isInputOpen(state: PresentationState): boolean {
  return state.phase === 'human-action' && state.network === 'live';
}
