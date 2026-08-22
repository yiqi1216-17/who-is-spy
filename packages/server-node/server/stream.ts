import type { GameEvent, Phase, Role } from './types.js';

/**
 * 公开事件流(OpenSpec 05-H · 决策 3 · 任务 4.1)
 *
 * 只读 SSE 通道:把一局的**公开事件日志**投影成带**单调序号**的版本化信封。
 * HTTP 命令(describe/vote/continue)仍是唯一权威写入口;本通道只做「有序公开呈现」,
 * 绝不承载任何写语义。对账以 `GET /api/games/:id` 为权威(authoritative-state-refresh)。
 *
 * 三条不变量:
 *  1) **单调**:seq = 事件在 append-only 日志中的下标 → 天然单调、无缝、重连稳定,
 *     且与 `GET` 返回的 `events` 下标一一对应(故重连补发与权威对账同一把标尺);
 *  2) **公开**:信封只含 `GameEvent`(system/description/vote_result/elimination),
 *     结构上不含 role/word/belief/私有 prompt/未公开票——与冻结契约的 `events` 同源;
 *  3) **幂等**:seq 相同即同一拍,客户端据此去重;缺号即提示回退 `GET` 对账。
 */
export const STREAM_VERSION = 1 as const;

/** 逐事件信封:一枚 = 公开日志里的一拍。`v` 版本化,`seq` 单调。 */
export interface StreamEnvelope {
  readonly v: typeof STREAM_VERSION;
  readonly seq: number;
  readonly gameId: string;
  readonly event: GameEvent;
}

/** 终局控制帧:呈现层据此收束放映。winner 仅终局公开,故只在此帧出现。 */
export interface StreamEnd {
  readonly v: typeof STREAM_VERSION;
  readonly gameId: string;
  readonly phase: Extract<Phase, 'finished'>;
  readonly winner: Role | null;
}

/**
 * 把公开事件日志投影为 `seq > afterSeq` 的信封序列。
 * 首连全量传 `afterSeq = -1`;重连补发传客户端最后见到的 seq。seq 恒等于事件下标。
 */
export function projectEnvelopes(
  gameId: string,
  events: readonly GameEvent[],
  afterSeq: number,
): StreamEnvelope[] {
  const out: StreamEnvelope[] = [];
  for (let seq = Math.max(0, afterSeq + 1); seq < events.length; seq += 1) {
    out.push({ v: STREAM_VERSION, seq, gameId, event: events[seq] });
  }
  return out;
}

/**
 * 解析 `Last-Event-ID`(SSE 标准重连头)或 `?lastEventId=` 回退。
 * 非法/缺省 → `-1`(全量补发)。负数亦归一为 `-1`,杜绝越界。
 */
export function parseLastEventId(raw: string | undefined | null): number {
  if (raw == null) return -1;
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : -1;
}

/** 纯函数:把逐事件信封格式化为一条 SSE 帧(id/event/data 三行 + 空行分隔)。 */
export function formatEnvelope(envelope: StreamEnvelope): string {
  return `id: ${envelope.seq}\nevent: event\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/** 纯函数:把终局控制帧格式化为一条 SSE 帧(不带 id,不参与 seq 去重)。 */
export function formatEnd(end: StreamEnd): string {
  return `event: end\ndata: ${JSON.stringify(end)}\n\n`;
}

/**
 * 生成途中的瞬态预告帧(体验修复:异步发言感):某席位刚说完一句/刚投出一票、
 * 但整轮命令**尚未原子提交**。与事件信封的三点刻意区别:**无 seq**(不入日志、不参与
 * Last-Event-ID 重连补发)、**不改变权威状态**(提交失败即作废,权威对账以 GET 为准)、
 * **只承载本就会公开的字段**——描述帧带 playerId/round/text(已过质量门,不含密词);
 * 投票帧另带 targetId,text 为公开的投票理由(人类票在命令入口即锁定,AI 票的理由/目标
 * 终局前后都会随 ballot 裁决公开,故先行直播不泄露任何未公开信息)。
 */
export interface PreviewFrame {
  readonly v: typeof STREAM_VERSION;
  readonly gameId: string;
  readonly kind: 'description' | 'vote';
  readonly round: number;
  readonly playerId: string;
  readonly text: string;
  /** 仅投票预告:被投席位 id(公开字段;人类票已在命令入口先行锁定,故不泄露未公开信息)。 */
  readonly targetId?: string;
}

/** 纯函数:预告帧 → SSE 帧。刻意**不带 id 行**,浏览器 EventSource 不会把它记进 Last-Event-ID。 */
export function formatPreview(frame: PreviewFrame): string {
  return `event: preview\ndata: ${JSON.stringify(frame)}\n\n`;
}

/**
 * 每局公开事件总线(内存、进程内):命令在 `withGame` **原子提交后**向订阅者广播新信封。
 * 订阅者(SSE 连接)自行按 seq 去重/推进;取消订阅即从表中摘除,空集自动回收 —— 无长跑泄漏。
 */
export type EnvelopeListener = (envelopes: StreamEnvelope[]) => void;
export type PreviewListener = (frame: PreviewFrame) => void;

export class GameEventBus {
  private readonly listeners = new Map<string, Set<EnvelopeListener>>();
  private readonly previewListeners = new Map<string, Set<PreviewListener>>();

  /** 订阅某局的新信封广播,返回取消订阅句柄(幂等,可重复调用)。 */
  subscribe(gameId: string, listener: EnvelopeListener): () => void {
    const set = this.listeners.get(gameId) ?? new Set<EnvelopeListener>();
    set.add(listener);
    this.listeners.set(gameId, set);
    return () => {
      const current = this.listeners.get(gameId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(gameId);
    };
  }

  /** 向某局全部订阅者广播新信封;空批次为 no-op。单个订阅者异常被隔离,不波及其他人与主流程。 */
  publish(gameId: string, envelopes: StreamEnvelope[]): void {
    if (envelopes.length === 0) return;
    const set = this.listeners.get(gameId);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(envelopes);
      } catch {
        // 慢/断开的连接抛错不应阻断其他订阅者或提交后的返回。
      }
    }
  }

  /** 观测/测试用:某局当前订阅者数(无订阅者则 0)。 */
  subscriberCount(gameId: string): number {
    return this.listeners.get(gameId)?.size ?? 0;
  }

  /** 订阅某局的瞬态预告帧(生成途中逐句直播),返回取消订阅句柄。 */
  subscribePreview(gameId: string, listener: PreviewListener): () => void {
    const set = this.previewListeners.get(gameId) ?? new Set<PreviewListener>();
    set.add(listener);
    this.previewListeners.set(gameId, set);
    return () => {
      const current = this.previewListeners.get(gameId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.previewListeners.delete(gameId);
    };
  }

  /** 广播一枚预告帧;单个订阅者异常被隔离(与 publish 同纪律)。 */
  publishPreview(frame: PreviewFrame): void {
    const set = this.previewListeners.get(frame.gameId);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(frame);
      } catch {
        // 慢/断开的连接抛错不应阻断其他订阅者或生成主流程。
      }
    }
  }
}
