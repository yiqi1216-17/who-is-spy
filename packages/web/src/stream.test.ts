import { describe, expect, it, vi } from 'vitest';
import {
  followGame,
  ingest,
  initialFollow,
  resyncFrom,
  STREAM_VERSION,
  type EventSourceLike,
  type StreamEnvelope,
} from './stream.js';
import type { GameEvent } from './types.js';

/**
 * 公开事件流 · 客户端消费测试(OpenSpec 05-H · 任务 4.1)
 * 钉死:版本闸、按 seq 去重、顺序追加、缺号触发对账、以及 resyncFrom 权威重置;
 * followGame 粘合层以假 EventSource 驱动,验证去重/对账/收束回调。
 */

function ev(id: string, seq: number): StreamEnvelope {
  const event: GameEvent = { id, type: 'description', text: `t${seq}`, round: 1, playerId: 'ai-1' };
  return { v: STREAM_VERSION, seq, gameId: 'g1', event };
}

describe('ingest · 纯 reducer', () => {
  it('顺序到达逐枚追加,lastSeq 单调推进', () => {
    let state = initialFollow;
    state = ingest(state, ev('a', 0));
    state = ingest(state, ev('b', 1));
    state = ingest(state, ev('c', 2));
    expect(state.lastSeq).toBe(2);
    expect(state.events.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(state.needsResync).toBe(false);
  });

  it('去重:seq<=lastSeq 的重复/过期信封被幂等丢弃', () => {
    let state = ingest(ingest(initialFollow, ev('a', 0)), ev('b', 1));
    const before = state;
    state = ingest(state, ev('b-dup', 1)); // 重放已见 seq
    state = ingest(state, ev('a-old', 0)); // 更旧
    expect(state).toBe(before); // 引用不变 → 未产生新状态
    expect(state.events.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('版本不符整枚丢弃(前向兼容闸)', () => {
    const state = ingest(initialFollow, { ...ev('x', 0), v: 999 });
    expect(state).toBe(initialFollow);
  });

  it('缺号 → 不追加,置 needsResync;重复缺号不抖动引用', () => {
    const seeded = ingest(initialFollow, ev('a', 0));
    const gapped = ingest(seeded, ev('c', 2)); // 跳过 seq 1
    expect(gapped.needsResync).toBe(true);
    expect(gapped.events.map((e) => e.id)).toEqual(['a']); // 未追加缺号后的拍
    expect(gapped.lastSeq).toBe(0);
    const again = ingest(gapped, ev('d', 3));
    expect(again).toBe(gapped); // 已在待对账态,引用稳定
  });

  it('resyncFrom:以权威日志重置,lastSeq=len-1 且清除缺号标记', () => {
    const authoritative: GameEvent[] = [
      { id: 'e0', type: 'system', text: 's', round: 1 },
      { id: 'e1', type: 'description', text: 'd', round: 1, playerId: 'ai-1' },
    ];
    const state = resyncFrom(authoritative);
    expect(state.lastSeq).toBe(1);
    expect(state.needsResync).toBe(false);
    // 对账后广播的下一拍(seq 2)无缝续接。
    const next = ingest(state, ev('e2', 2));
    expect(next.events).toHaveLength(3);
    expect(next.lastSeq).toBe(2);
  });
});

/** 假 EventSource:手动 emit 指定类型的帧,记录 close。 */
class FakeSource implements EventSourceLike {
  readonly listeners = new Map<string, (event: { data: string }) => void>();
  closed = false;
  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(type, listener);
  }
  emit(type: string, data: string): void {
    this.listeners.get(type)?.({ data });
  }
  close(): void {
    this.closed = true;
  }
}

describe('followGame · 跟播粘合层', () => {
  it('顺序帧回调 onEvent;重复帧被去重不重复回调', () => {
    const source = new FakeSource();
    const onEvent = vi.fn();
    followGame('g1', { onEvent }, () => source);

    source.emit('event', JSON.stringify(ev('a', 0)));
    source.emit('event', JSON.stringify(ev('b', 1)));
    source.emit('event', JSON.stringify(ev('b', 1))); // 重连补发重叠
    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[0]).toEqual([expect.objectContaining({ id: 'a' }), 0]);
    expect(onEvent.mock.calls[1]).toEqual([expect.objectContaining({ id: 'b' }), 1]);
  });

  it('缺号触发 onResync,不误报 onEvent', () => {
    const source = new FakeSource();
    const onEvent = vi.fn();
    const onResync = vi.fn();
    followGame('g1', { onEvent, onResync }, () => source);

    source.emit('event', JSON.stringify(ev('a', 0)));
    source.emit('event', JSON.stringify(ev('c', 2))); // 跳号
    expect(onResync).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledTimes(1); // 只回调了 seq 0
  });

  it('坏帧被忽略,不抛错', () => {
    const source = new FakeSource();
    const onEvent = vi.fn();
    followGame('g1', { onEvent }, () => source);
    expect(() => source.emit('event', '{not json')).not.toThrow();
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('end 帧回调 onEnd 并关闭源', () => {
    const source = new FakeSource();
    const onEnd = vi.fn();
    const follower = followGame('g1', { onEvent: vi.fn(), onEnd }, () => source);
    source.emit('end', JSON.stringify({ v: STREAM_VERSION, gameId: 'g1', phase: 'finished', winner: 'civilian' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(source.closed).toBe(true);
    follower.close();
  });
});

describe('followGame · 预告帧(生成途中逐句直播)', () => {
  const preview = (playerId: string, text: string, gameId = 'g1') =>
    JSON.stringify({ v: 1, gameId, kind: 'description', round: 1, playerId, text });

  it('preview 帧直通 onPreview,不进 onEvent、不影响 seq 去重', () => {
    const source = new FakeSource();
    const onEvent = vi.fn();
    const onPreview = vi.fn();
    followGame('g1', { onEvent, onPreview }, () => source);

    source.emit('preview', preview('ai-1', '第一句'));
    source.emit('event', JSON.stringify(ev('a', 0)));
    source.emit('preview', preview('ai-2', '第二句'));
    source.emit('event', JSON.stringify(ev('b', 1)));

    expect(onPreview).toHaveBeenCalledTimes(2);
    expect(onPreview.mock.calls.map((c) => c[0].playerId)).toEqual(['ai-1', 'ai-2']);
    expect(onEvent).toHaveBeenCalledTimes(2); // 事件通道不受预告影响
  });

  it('异局/坏帧的 preview 被忽略;未提供 onPreview 时不抛', () => {
    const source = new FakeSource();
    const onPreview = vi.fn();
    followGame('g1', { onEvent: vi.fn(), onPreview }, () => source);
    source.emit('preview', preview('ai-1', '别局的句子', 'other-game'));
    expect(() => source.emit('preview', '{bad json')).not.toThrow();
    expect(onPreview).not.toHaveBeenCalled();

    const bare = new FakeSource();
    followGame('g1', { onEvent: vi.fn() }, () => bare);
    expect(() => bare.emit('preview', preview('ai-1', '一句'))).not.toThrow();
  });
});
