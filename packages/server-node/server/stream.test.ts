import { describe, expect, it, vi } from 'vitest';
import {
  GameEventBus,
  STREAM_VERSION,
  formatEnd,
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
