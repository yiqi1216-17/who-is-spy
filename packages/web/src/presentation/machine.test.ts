import { describe, expect, it } from 'vitest';
import {
  PRESENTATION_PHASES,
  type PresentationEvent,
  type PresentationState,
  initialState,
  isInputOpen,
  overlay,
  reduce,
  run,
} from './machine.js';

/** 便捷:从初始态跑一串事件。 */
function drive(...events: PresentationEvent[]): PresentationState {
  return run(events);
}

describe('表现层状态机 · 合法路径(决策 2)', () => {
  it('人类在场的一整轮:home → 揭示 → 轮次 → 人类描述 → 四段证词 → 人类投票 → 计票 → 出局 → 下一轮', () => {
    let s = drive({ type: 'START' }, { type: 'REVEAL_DONE' });
    expect(s.phase).toBe('round-intro');

    s = reduce(s, { type: 'INTRO_DONE', humanTurn: true });
    expect(s.phase).toBe('human-action');
    expect(isInputOpen(s)).toBe(true); // 轮到人类 + 在线 → 输入开放

    s = reduce(s, { type: 'HUMAN_DESCRIBED' });
    expect(s.phase).toBe('testimony');

    // 四段 AI 证词依次聚光
    s = reduce(s, { type: 'TESTIMONY_START', speakerId: 'ai-1' });
    expect(s.focusId).toBe('ai-1');
    s = reduce(s, { type: 'TESTIMONY_DONE', next: 'more' });
    s = reduce(s, { type: 'TESTIMONY_START', speakerId: 'ai-2' });
    expect(s.focusId).toBe('ai-2');

    // 证词放完 → 轮到人类投票
    s = reduce(s, { type: 'TESTIMONY_DONE', next: 'human-vote' });
    expect(s.phase).toBe('human-action');
    expect(s.focusId).toBeNull();

    s = reduce(s, { type: 'HUMAN_VOTED' });
    expect(s.phase).toBe('voting');

    s = reduce(s, { type: 'BALLOT_DONE', outcome: 'eliminated', eventId: 'elim-1', focusId: 'ai-3' });
    expect(s.phase).toBe('elimination');
    expect(s.focusId).toBe('ai-3');

    s = reduce(s, { type: 'CONTINUE', finished: false, eventId: 'cont-1' });
    expect(s.phase).toBe('round-intro'); // 未结束 → 回到轮次开场
  });

  it('人类已出局(旁观):轮次开场直接进证词,证词放完直接计票', () => {
    let s = drive({ type: 'START' }, { type: 'REVEAL_DONE' });
    s = reduce(s, { type: 'INTRO_DONE', humanTurn: false });
    expect(s.phase).toBe('testimony'); // 跳过 human-action
    s = reduce(s, { type: 'TESTIMONY_DONE', next: 'ballot' });
    expect(s.phase).toBe('voting');
  });

  it('终局 → 高光 / 回放叠层可开可关', () => {
    let s: PresentationState = { ...initialState(), phase: 'finale' };
    s = reduce(s, { type: 'OPEN_HIGHLIGHTS' });
    expect(s.phase).toBe('highlights');
    s = reduce(s, { type: 'CLOSE_OVERLAY' });
    expect(s.phase).toBe('finale');
    s = reduce(s, { type: 'OPEN_REPLAY' });
    expect(s.phase).toBe('replay');
    s = reduce(s, { type: 'CLOSE_OVERLAY' });
    expect(s.phase).toBe('finale');
  });
});

describe('表现层状态机 · 只接受合法转移', () => {
  it('非法转移被拒:phase 不变,rejected 记录来龙去脉', () => {
    const s = reduce(initialState(), { type: 'TESTIMONY_DONE', next: 'more' });
    expect(s.phase).toBe('home'); // 原地不动
    expect(s.rejected).toBe('home ⇏ TESTIMONY_DONE');
  });

  it('合法转移后 rejected 立即清空', () => {
    let s = reduce(initialState(), { type: 'REVEAL_DONE' }); // 非法(还没 START)
    expect(s.rejected).toBe('home ⇏ REVEAL_DONE');
    s = reduce(s, { type: 'START' }); // 合法
    expect(s.phase).toBe('role-reveal');
    expect(s.rejected).toBeNull();
  });

  it('每个 phase 至少有一条合法出边(无死锁)', () => {
    const probes: PresentationEvent[] = [
      { type: 'START' },
      { type: 'REVEAL_DONE' },
      { type: 'INTRO_DONE', humanTurn: true },
      { type: 'TESTIMONY_DONE', next: 'ballot' },
      { type: 'HUMAN_DESCRIBED' },
      { type: 'BALLOT_DONE', outcome: 'eliminated', eventId: 'x' },
      { type: 'CONTINUE', finished: true, eventId: 'y' },
      { type: 'OPEN_HIGHLIGHTS' },
      { type: 'CLOSE_OVERLAY' },
    ];
    for (const phase of PRESENTATION_PHASES) {
      const base: PresentationState = { ...initialState(), phase };
      const escaped = probes.some((event) => reduce(base, event).phase !== phase);
      expect(escaped, `phase ${phase} 应至少有一条合法出边`).toBe(true);
    }
  });
});

describe('表现层状态机 · 权威事件幂等(乱序 / 重复)', () => {
  it('重复的出局事件不二次推进(同 id → no-op)', () => {
    let s: PresentationState = { ...initialState(), phase: 'voting' };
    s = reduce(s, { type: 'BALLOT_DONE', outcome: 'eliminated', eventId: 'elim-1', focusId: 'ai-2' });
    expect(s.phase).toBe('elimination');
    expect(s.consumed).toEqual(['elim-1']);

    // 同 id 再来一次(网络重投/双投递)→ 原样返回,phase 不动、consumed 不增。
    const again = reduce(s, { type: 'BALLOT_DONE', outcome: 'eliminated', eventId: 'elim-1', focusId: 'ai-2' });
    expect(again).toBe(s); // 引用相等:确证零推进
    expect(again.consumed).toEqual(['elim-1']);
  });

  it('重复的终局事件不二次推进', () => {
    let s: PresentationState = { ...initialState(), phase: 'elimination' };
    s = reduce(s, { type: 'CONTINUE', finished: true, eventId: 'w-1' });
    expect(s.phase).toBe('finale');
    const again = reduce(s, { type: 'CONTINUE', finished: true, eventId: 'w-1' });
    expect(again).toBe(s);
    expect(again.phase).toBe('finale');
  });

  it('乱序的终局事件在 voting 阶段被拒(而非误进 finale)', () => {
    const s: PresentationState = { ...initialState(), phase: 'voting' };
    const out = reduce(s, { type: 'CONTINUE', finished: true, eventId: 'w-2' });
    expect(out.phase).toBe('voting'); // 权威事件也要遵守 phase 合法性
    expect(out.rejected).toBe('voting ⇏ CONTINUE');
  });

  it('平票复投:tie 留在 voting 且消费 id;新一票才推进', () => {
    let s: PresentationState = { ...initialState(), phase: 'voting' };
    s = reduce(s, { type: 'BALLOT_DONE', outcome: 'tie', eventId: 'tie-1' });
    expect(s.phase).toBe('voting');
    expect(s.consumed).toEqual(['tie-1']);
    // 重复的 tie → no-op
    expect(reduce(s, { type: 'BALLOT_DONE', outcome: 'tie', eventId: 'tie-1' })).toBe(s);
    // 复投出局 → 推进
    s = reduce(s, { type: 'BALLOT_DONE', outcome: 'eliminated', eventId: 'elim-2', focusId: 'ai-4' });
    expect(s.phase).toBe('elimination');
    expect(s.consumed).toEqual(['tie-1', 'elim-2']);
  });
});

describe('表现层状态机 · 网络轴与剧场正交(决策 3)', () => {
  it('断线不改变剧场 phase;overlay 独立派生', () => {
    let s: PresentationState = { ...initialState(), phase: 'testimony', focusId: 'ai-1' };
    s = reduce(s, { type: 'NET_LOST' });
    expect(s.phase).toBe('testimony'); // 动画阶段不受网络影响
    expect(s.focusId).toBe('ai-1');
    expect(overlay(s)).toBe('failure');

    s = reduce(s, { type: 'NET_RETRYING' });
    expect(overlay(s)).toBe('reconnect');
    expect(s.phase).toBe('testimony');

    s = reduce(s, { type: 'NET_OK' });
    expect(overlay(s)).toBeNull();
    expect(s.phase).toBe('testimony');
  });

  it('输入闸需要"人类阶段 且 在线"两者同时成立', () => {
    const human: PresentationState = { ...initialState(), phase: 'human-action' };
    expect(isInputOpen(human)).toBe(true);
    expect(isInputOpen(reduce(human, { type: 'NET_LOST' }))).toBe(false); // 断线即锁输入
    // 在线但非人类阶段 → 同样关闭
    expect(isInputOpen({ ...initialState(), phase: 'voting' })).toBe(false);
  });

  it('RESET 回到 home 并清空 consumed,但保留网络轴(不谎报连通性)', () => {
    let s = drive({ type: 'START' }, { type: 'REVEAL_DONE' });
    s = reduce(s, { type: 'NET_RETRYING' });
    s = { ...s, consumed: ['a', 'b'] };
    const reset = reduce(s, { type: 'RESET' });
    expect(reset.phase).toBe('home');
    expect(reset.consumed).toEqual([]);
    expect(reset.network).toBe('reconnecting'); // 网络轴跨重开保留
  });
});
