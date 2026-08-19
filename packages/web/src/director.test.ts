import { describe, expect, it } from 'vitest';
import { planBeats, seatState, eliminatedRevealed, interactionMode } from './director.js';
import type { GameEvent, PublicGameState, PublicPlayer } from './types.js';

/** 五人基础盘:human 存活,四 AI。便于各用例改写 events/phase。 */
function baseGame(over: Partial<PublicGameState> = {}): PublicGameState {
  const players: PublicPlayer[] = [
    { id: 'human', name: '你', avatar: '你', isHuman: true, alive: true },
    { id: 'ai-1', name: '阿序', avatar: '序', isHuman: false, alive: true },
    { id: 'ai-2', name: '弥生', avatar: '弥', isHuman: false, alive: true },
    { id: 'ai-3', name: '老墨', avatar: '墨', isHuman: false, alive: true },
    { id: 'ai-4', name: '小满', avatar: '满', isHuman: false, alive: true },
  ];
  return {
    id: 'g1',
    phase: 'describing',
    round: 1,
    ballot: 1,
    players,
    descriptions: [],
    votes: [],
    events: [],
    eligibleTargetIds: null,
    winner: null,
    review: null,
    human: { playerId: 'human', role: 'civilian', word: '苹果' },
    model: 'test',
    ...over,
  };
}

function desc(id: string, playerId: string, round: number): GameEvent {
  return { id, type: 'description', text: `${playerId} 的描述`, round, playerId };
}

describe('导演 · describe 响应线性化(人在场)', () => {
  it('人类描述后:证词逐拍(含人类自己)→ 收束为待人类投票', () => {
    const game = baseGame({
      phase: 'voting',
      descriptions: [
        { playerId: 'human', text: '你', round: 1 },
        { playerId: 'ai-1', text: 'a', round: 1 },
      ],
      events: [
        { id: 's0', type: 'system', text: '第 1 轮开始', round: 1 },
        desc('d-h', 'human', 1),
        desc('d-1', 'ai-1', 1),
        desc('d-2', 'ai-2', 1),
        desc('d-3', 'ai-3', 1),
        desc('d-4', 'ai-4', 1),
        { id: 's1', type: 'system', text: '投票吧', round: 1 },
      ],
    });
    // 从 role-reveal 后的首轮:startPhase 'testimony'(调用方已 HUMAN_DESCRIBED)。fromEventCount=1(system 已在记录)。
    const beats = planBeats(game, 1, 'testimony');
    const testimonies = beats.filter((b) => b.machine?.type === 'TESTIMONY_START');
    expect(testimonies.map((b) => (b.machine as { speakerId: string }).speakerId)).toEqual([
      'human',
      'ai-1',
      'ai-2',
      'ai-3',
      'ai-4',
    ]);
    // 系统事件不进放映
    expect(beats.some((b) => b.spotlight?.text === '投票吧')).toBe(false);
    // 段末收束为「轮到人类投票」
    const last = beats[beats.length - 1];
    expect(last.machine).toEqual({ type: 'TESTIMONY_DONE', next: 'human-vote' });
    // 人类自己的证词停留更短
    expect(beats.find((b) => b.id === 'd-h')?.hold).toBeLessThan(
      beats.find((b) => b.id === 'd-1')!.hold,
    );
  });
});

describe('导演 · vote 响应线性化(人在场)', () => {
  it('出局且未终局:BALLOT_DONE(elim) → CONTINUE(未完) → INTRO_DONE(轮到人类)', () => {
    const game = baseGame({
      phase: 'describing',
      round: 2,
      events: [
        { id: 'elim1', type: 'elimination', text: '老墨 出局', round: 1, playerId: 'ai-3' },
        { id: 's', type: 'system', text: '第 2 轮开始', round: 2 },
      ],
    });
    const beats = planBeats(game, 0, 'voting');
    expect(beats[0].machine).toEqual({
      type: 'BALLOT_DONE',
      outcome: 'eliminated',
      eventId: 'elim1',
      focusId: 'ai-3',
    });
    expect(beats[1].machine).toEqual({ type: 'CONTINUE', finished: false, eventId: 'elim1::cont' });
    expect(beats[1].banner).toBe('第 2 轮');
    expect(beats[2].machine).toEqual({ type: 'INTRO_DONE', humanTurn: true });
  });

  it('出局并终局:CONTINUE(finished) 且不再 INTRO_DONE', () => {
    const game = baseGame({
      phase: 'finished',
      round: 3,
      winner: 'civilian',
      events: [{ id: 'elimF', type: 'elimination', text: '小满 出局', round: 3, playerId: 'ai-4' }],
    });
    const beats = planBeats(game, 0, 'voting');
    expect(beats[0].machine).toMatchObject({ type: 'BALLOT_DONE', outcome: 'eliminated' });
    expect(beats[1].machine).toEqual({ type: 'CONTINUE', finished: true, eventId: 'elimF::cont' });
    expect(beats.some((b) => b.machine?.type === 'INTRO_DONE')).toBe(false);
  });

  it('平票:BALLOT_DONE(tie) 留在计票,不生 CONTINUE', () => {
    const game = baseGame({
      phase: 'voting',
      ballot: 2,
      eligibleTargetIds: ['ai-1', 'ai-2'],
      events: [{ id: 'tie1', type: 'vote_result', text: '同票', round: 1 }],
    });
    const beats = planBeats(game, 0, 'voting');
    expect(beats).toHaveLength(1);
    expect(beats[0].machine).toEqual({ type: 'BALLOT_DONE', outcome: 'tie', eventId: 'tie1' });
  });

  it('人类被投出局:INTRO_DONE(humanTurn=false)→ 停泊证词待旁观', () => {
    const game = baseGame({
      phase: 'describing',
      round: 2,
      players: baseGame().players.map((p) => (p.id === 'human' ? { ...p, alive: false } : p)),
      events: [
        { id: 'elimH', type: 'elimination', text: '你 出局', round: 1, playerId: 'human' },
        { id: 's', type: 'system', text: '第 2 轮', round: 2 },
      ],
    });
    const beats = planBeats(game, 0, 'voting');
    expect(beats.find((b) => b.machine?.type === 'INTRO_DONE')?.machine).toEqual({
      type: 'INTRO_DONE',
      humanTurn: false,
    });
  });
});

describe('导演 · 旁观 continue 一次跑多轮(最难路径)', () => {
  it('跨两轮的增量线性化为:证词→计票→出局→交接→证词…→终局', () => {
    // human 已出局;continue 生成第 2 轮四段(实际 3 段 AI 存活)+ 出局 + 第 3 轮 + 终局出局。
    const players = baseGame().players.map((p) =>
      p.id === 'human' ? { ...p, alive: false } : p.id === 'ai-3' ? { ...p, alive: false } : p,
    );
    const game = baseGame({
      phase: 'finished',
      round: 3,
      winner: 'undercover',
      players,
      events: [
        desc('d21', 'ai-1', 2),
        desc('d22', 'ai-2', 2),
        desc('d24', 'ai-4', 2),
        { id: 'e2', type: 'elimination', text: 'ai-1 出局', round: 2, playerId: 'ai-1' },
        { id: 's3', type: 'system', text: '第 3 轮', round: 3 },
        desc('d32', 'ai-2', 3),
        desc('d34', 'ai-4', 3),
        { id: 'e3', type: 'elimination', text: 'ai-4 出局', round: 3, playerId: 'ai-4' },
      ],
    });
    const kinds = planBeats(game, 0, 'testimony').map((b) => b.machine?.type);
    expect(kinds).toEqual([
      'TESTIMONY_START', // d21
      'TESTIMONY_START', // d22
      'TESTIMONY_START', // d24
      'TESTIMONY_DONE', // 收束(ballot)
      'BALLOT_DONE', // e2 出局
      'CONTINUE', // 未完
      'INTRO_DONE', // 交接(humanTurn=false)
      'TESTIMONY_START', // d32
      'TESTIMONY_START', // d34
      'TESTIMONY_DONE', // 收束(ballot)
      'BALLOT_DONE', // e3 出局
      'CONTINUE', // 终局
    ]);
    const conts = planBeats(game, 0, 'testimony').filter((b) => b.machine?.type === 'CONTINUE');
    expect((conts[0].machine as { finished: boolean }).finished).toBe(false);
    expect((conts[1].machine as { finished: boolean }).finished).toBe(true);
  });
});

describe('导演 · 纯派生器', () => {
  it('seatState 优先级:出局 > 发言 > 嫌疑 > 常态', () => {
    const p: PublicPlayer = { id: 'ai-2', name: '弥生', avatar: '弥', isHuman: false, alive: false };
    expect(
      seatState(p, { focusId: 'ai-2', suspectId: 'ai-2', eliminatedRevealed: new Set(['ai-2']) }),
    ).toBe('eliminated');
    expect(seatState(p, { focusId: 'ai-2', suspectId: null, eliminatedRevealed: new Set() })).toBe(
      'speaking',
    );
    expect(seatState(p, { focusId: null, suspectId: 'ai-2', eliminatedRevealed: new Set() })).toBe(
      'suspect',
    );
    expect(seatState(p, { focusId: null, suspectId: null, eliminatedRevealed: new Set() })).toBe(
      'idle',
    );
  });

  it('eliminatedRevealed 仅计入已放映的出局事件', () => {
    const events: GameEvent[] = [
      { id: 'e1', type: 'elimination', text: '', round: 1, playerId: 'ai-3' },
      { id: 'e2', type: 'elimination', text: '', round: 2, playerId: 'ai-1' },
    ];
    expect([...eliminatedRevealed(events, new Set(['e1']))]).toEqual(['ai-3']);
    expect(eliminatedRevealed(events, new Set()).size).toBe(0);
  });

  it('interactionMode 以服务端相位为准(平票复投仍为 vote)', () => {
    expect(interactionMode(baseGame({ phase: 'describing' }), { queueEmpty: true, online: true })).toBe(
      'describe',
    );
    expect(
      interactionMode(baseGame({ phase: 'voting', ballot: 2 }), { queueEmpty: true, online: true }),
    ).toBe('vote');
    expect(interactionMode(baseGame({ phase: 'finished' }), { queueEmpty: true, online: true })).toBe(
      'finale',
    );
    // 放映未播完 / 断线 → 不开放输入
    expect(interactionMode(baseGame(), { queueEmpty: false, online: true })).toBe('none');
    expect(interactionMode(baseGame(), { queueEmpty: true, online: false })).toBe('none');
    // 已出局 → 旁观
    const dead = baseGame({
      players: baseGame().players.map((p) => (p.isHuman ? { ...p, alive: false } : p)),
    });
    expect(interactionMode(dead, { queueEmpty: true, online: true })).toBe('spectate');
  });
});
