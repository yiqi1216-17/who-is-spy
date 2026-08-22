import type { GameEvent } from './types';

/**
 * 公开事件流 · 客户端消费(OpenSpec 05-H · 决策 3 · 任务 4.1)
 *
 * 只读随播:吞入服务端 SSE 的**版本化信封**,按**单调 seq** 去重/推进。
 * 与写路径正交 —— 命令仍走 HTTP(describe/vote/continue);本模块只负责「跟播公开事件」。
 *
 * 三条对称不变量(与服务端 stream.ts 同源):
 *  1) **去重**:seq<=已应用 → 幂等丢弃(重连补发与实时广播必然重叠);
 *  2) **顺序**:seq==lastSeq+1 → 追加;
 *  3) **对账**:seq 缺号(>lastSeq+1)→ 置 needsResync,交调用者回退 `GET /api/games/:id`
 *     权威对账后 `resyncFrom` 重置 —— 即设计里的 authoritative-state-refresh fallback。
 */
export const STREAM_VERSION = 1;

export interface StreamEnvelope {
  readonly v: number;
  readonly seq: number;
  readonly gameId: string;
  readonly event: GameEvent;
}

export interface FollowState {
  /** 已应用的最高 seq(-1 表示尚未开始)。 */
  readonly lastSeq: number;
  /** 顺序累积的公开事件(与服务端日志下标对齐)。 */
  readonly events: readonly GameEvent[];
  /** 检测到缺号 → 应回退 GET 权威对账;对账后经 resyncFrom 清除。 */
  readonly needsResync: boolean;
}

export const initialFollow: FollowState = { lastSeq: -1, events: [], needsResync: false };

/**
 * 纯 reducer:吞入一枚信封。
 *  - 版本不符 / 旧信封(seq<=lastSeq)→ 幂等丢弃(去重);
 *  - 顺序到达(seq==lastSeq+1)→ 追加,清 needsResync;
 *  - 缺号(seq>lastSeq+1)→ 不追加,置 needsResync(等待调用者对账重置)。
 */
export function ingest(state: FollowState, envelope: StreamEnvelope): FollowState {
  if (envelope.v !== STREAM_VERSION) return state;
  if (envelope.seq <= state.lastSeq) return state;
  if (envelope.seq > state.lastSeq + 1) {
    return state.needsResync ? state : { ...state, needsResync: true };
  }
  return { lastSeq: envelope.seq, events: [...state.events, envelope.event], needsResync: false };
}

/**
 * 以 `GET` 权威事件日志重置随播状态(清除缺号标记)。
 * seq 恒等于下标,故对账后 lastSeq = events.length-1,后续广播天然无缝续接。
 */
export function resyncFrom(events: readonly GameEvent[]): FollowState {
  return { lastSeq: events.length - 1, events: [...events], needsResync: false };
}

/** 生成途中的瞬态预告帧(服务端 formatPreview 同构):无 seq、不入权威日志。 */
export interface PreviewFrame {
  readonly v: number;
  readonly gameId: string;
  readonly kind: 'description' | 'vote';
  readonly round: number;
  readonly playerId: string;
  readonly text: string;
  /** 仅投票预告:被投席位 id。 */
  readonly targetId?: string;
}

/** 最小 EventSource 抽象:便于以假源在无浏览器环境下测试跟播粘合层。 */
export interface EventSourceLike {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
}

export interface Follower {
  close(): void;
}

/**
 * 跟播一局的公开事件流。浏览器 `EventSource` 原生处理 `Last-Event-ID` 重连;
 * 本粘合层只做「解析信封 → ingest 去重 → 回调」,并在缺号时回调 onResync 提示对账。
 */
export function followGame(
  gameId: string,
  handlers: {
    onEvent: (event: GameEvent, seq: number) => void;
    onPreview?: (frame: PreviewFrame) => void;
    onResync?: () => void;
    onEnd?: () => void;
  },
  make: (url: string) => EventSourceLike = (url) =>
    new EventSource(url) as unknown as EventSourceLike,
): Follower {
  let state = initialFollow;
  const source = make(`/api/games/${gameId}/stream`);

  source.addEventListener('event', (raw) => {
    let envelope: StreamEnvelope;
    try {
      envelope = JSON.parse(raw.data) as StreamEnvelope;
    } catch {
      return; // 半包/坏帧忽略,等下一帧或重连补发。
    }
    const next = ingest(state, envelope);
    if (next.needsResync && !state.needsResync) handlers.onResync?.();
    else if (next.lastSeq > state.lastSeq) handlers.onEvent(envelope.event, envelope.seq);
    state = next;
  });

  // 瞬态预告帧:直通回调,不进 seq 去重(它没有 seq;权威性由后续事件信封兜底)。
  source.addEventListener('preview', (raw) => {
    if (!handlers.onPreview) return;
    let frame: PreviewFrame;
    try {
      frame = JSON.parse(raw.data) as PreviewFrame;
    } catch {
      return;
    }
    if ((frame.kind === 'description' || frame.kind === 'vote') && frame.gameId === gameId)
      handlers.onPreview(frame);
  });

  source.addEventListener('end', () => {
    handlers.onEnd?.();
    source.close();
  });

  return { close: () => source.close() };
}
