import { describe, expect, it, vi } from 'vitest';
import {
  GameEventBus,
  STREAM_VERSION,
  formatEnd,
  formatPreview,
  formatEnvelope,
  parseLastEventId,
  projectEnvelopes,
  type StreamEnvelope,
} from './stream.js';
import type { GameEvent } from './types.js';

/**
 * 公开事件流 · 纯核测试(OpenSpec 05-H · 任务 4.1)
 * 钉死:单调投影(seq==下标)、Last-Event-ID 解析、SSE 帧格式、以及事件总线的
 * 订阅/广播/退订/异常隔离。全部确定性、无 socket。
 */

function ev(id: string, type: GameEvent['type'], text: string, round: number, playerId?: string): GameEvent {
  return { id, type, text, round, playerId };
}

const LOG: GameEvent[] = [
  ev('e0', 'system', '密词已发放', 1),
  ev('e1', 'description', '像放松时会看的东西', 1, 'ai-1'),
  ev('e2', 'description', '晚饭后常打开它', 1, 'ai-2'),
  ev('e3', 'vote_result', '进入加票', 1),
  ev('e4', 'elimination', '阿序出局', 1, 'ai-1'),
];

describe('projectEnvelopes · 单调投影', () => {
  it('首连全量(afterSeq=-1):seq 恒等于事件下标,版本一致', () => {
    const envelopes = projectEnvelopes('g1', LOG, -1);
    expect(envelopes.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(envelopes.every((e) => e.v === STREAM_VERSION)).toBe(true);
    expect(envelopes.every((e) => e.gameId === 'g1')).toBe(true);
    expect(envelopes[1].event).toBe(LOG[1]);
  });

  it('重连补发(afterSeq=k):只取 seq>k,seq 与下标不漂移', () => {
    const envelopes = projectEnvelopes('g1', LOG, 2);
    expect(envelopes.map((e) => e.seq)).toEqual([3, 4]);
    expect(envelopes[0].event.id).toBe('e3');
  });

  it('已追平(afterSeq>=末尾)→ 空批次', () => {
    expect(projectEnvelopes('g1', LOG, 4)).toEqual([]);
    expect(projectEnvelopes('g1', LOG, 99)).toEqual([]);
  });

  it('afterSeq 为负也归一为全量,不越界', () => {
    expect(projectEnvelopes('g1', LOG, -5).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('parseLastEventId · 重连头解析', () => {
  it('合法非负整数原样返回', () => {
    expect(parseLastEventId('0')).toBe(0);
    expect(parseLastEventId('7')).toBe(7);
  });
  it('缺省/非法/负数 → -1(全量)', () => {
    expect(parseLastEventId(undefined)).toBe(-1);
    expect(parseLastEventId(null)).toBe(-1);
    expect(parseLastEventId('')).toBe(-1);
    expect(parseLastEventId('abc')).toBe(-1);
    expect(parseLastEventId('-3')).toBe(-1);
  });
  it('宽松解析前导数字(EventSource 可能回传裸数字字符串)', () => {
    expect(parseLastEventId('12x')).toBe(12);
  });
});

describe('SSE 帧格式', () => {
  it('formatEnvelope:id/event/data 三行 + 空行分隔,data 为信封 JSON', () => {
    const envelope: StreamEnvelope = { v: STREAM_VERSION, seq: 3, gameId: 'g1', event: LOG[3] };
    const frame = formatEnvelope(envelope);
    expect(frame).toBe(`id: 3\nevent: event\ndata: ${JSON.stringify(envelope)}\n\n`);
    // 可被行解析:id 行承载单调 seq,供浏览器 EventSource 落成 Last-Event-ID。
    expect(frame.startsWith('id: 3\n')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it('formatEnd:end 事件、不带 id(不参与 seq 去重)', () => {
    const frame = formatEnd({ v: STREAM_VERSION, gameId: 'g1', phase: 'finished', winner: 'civilian' });
    expect(frame).toContain('event: end\n');
    expect(frame).not.toContain('\nid:');
    expect(frame).toContain('"winner":"civilian"');
  });
});

describe('GameEventBus · 订阅/广播/退订', () => {
  it('订阅者收到广播;退订后不再收到', () => {
    const bus = new GameEventBus();
    const seen: number[] = [];
    const off = bus.subscribe('g1', (envs) => seen.push(...envs.map((e) => e.seq)));
    expect(bus.subscriberCount('g1')).toBe(1);

    bus.publish('g1', projectEnvelopes('g1', LOG, -1));
    expect(seen).toEqual([0, 1, 2, 3, 4]);

    off();
    expect(bus.subscriberCount('g1')).toBe(0);
    bus.publish('g1', projectEnvelopes('g1', LOG, -1));
    expect(seen).toEqual([0, 1, 2, 3, 4]); // 未增长
  });

  it('按 gameId 隔离:只广播给对应局的订阅者', () => {
    const bus = new GameEventBus();
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribe('g1', (envs) => a.push(...envs.map((e) => e.seq)));
    bus.subscribe('g2', (envs) => b.push(...envs.map((e) => e.seq)));
    bus.publish('g1', projectEnvelopes('g1', LOG.slice(0, 2), -1));
    expect(a).toEqual([0, 1]);
    expect(b).toEqual([]);
  });

  it('空批次为 no-op;无订阅者广播不抛', () => {
    const bus = new GameEventBus();
    const spy = vi.fn();
    bus.subscribe('g1', spy);
    bus.publish('g1', []);
    expect(spy).not.toHaveBeenCalled();
    expect(() => bus.publish('nobody', projectEnvelopes('nobody', LOG, -1))).not.toThrow();
  });

  it('单个订阅者抛错被隔离,不影响其他订阅者', () => {
    const bus = new GameEventBus();
    const good: number[] = [];
    bus.subscribe('g1', () => {
      throw new Error('slow/broken connection');
    });
    bus.subscribe('g1', (envs) => good.push(...envs.map((e) => e.seq)));
    expect(() => bus.publish('g1', projectEnvelopes('g1', LOG.slice(0, 1), -1))).not.toThrow();
    expect(good).toEqual([0]);
  });
});

describe('预告帧 · 生成途中逐句直播(体验修复:异步发言感)', () => {
  const frame = (playerId: string, text: string) =>
    ({ v: STREAM_VERSION, gameId: 'g1', kind: 'description', round: 1, playerId, text }) as const;

  it('formatPreview:preview 事件、不带 id 行(不参与 Last-Event-ID 补发)', () => {
    const raw = formatPreview(frame('ai-1', '像放松时会看的东西'));
    expect(raw.startsWith('event: preview\n')).toBe(true);
    expect(raw).not.toContain('id:');
    expect(raw.endsWith('\n\n')).toBe(true);
    const data = JSON.parse(raw.split('data: ')[1]);
    expect(data.kind).toBe('description');
    expect(data.playerId).toBe('ai-1');
  });

  it('预告通道:订阅/广播/退订,按 gameId 隔离,与事件通道互不串扰', () => {
    const bus = new GameEventBus();
    const seen: string[] = [];
    const eventSeen: number[] = [];
    bus.subscribe('g1', (envs) => eventSeen.push(...envs.map((e) => e.seq)));
    const off = bus.subscribePreview('g1', (f) => seen.push(f.playerId));
    const other: string[] = [];
    bus.subscribePreview('g2', (f) => other.push(f.playerId));

    bus.publishPreview(frame('ai-1', '第一句'));
    bus.publishPreview(frame('ai-2', '第二句'));
    expect(seen).toEqual(['ai-1', 'ai-2']);
    expect(other).toEqual([]); // gameId 隔离
    expect(eventSeen).toEqual([]); // 预告不进事件通道

    off();
    bus.publishPreview(frame('ai-3', '第三句'));
    expect(seen).toEqual(['ai-1', 'ai-2']); // 退订后不再收到
  });

  it('单个预告订阅者抛错被隔离;无订阅者广播不抛', () => {
    const bus = new GameEventBus();
    const good: string[] = [];
    bus.subscribePreview('g1', () => {
      throw new Error('broken');
    });
    bus.subscribePreview('g1', (f) => good.push(f.playerId));
    expect(() => bus.publishPreview(frame('ai-1', '一句'))).not.toThrow();
    expect(good).toEqual(['ai-1']);
    expect(() => bus.publishPreview({ ...frame('ai-1', '一句'), gameId: 'nobody' })).not.toThrow();
  });
});
