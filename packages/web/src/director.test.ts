import { describe, expect, it } from 'vitest';
import { RECAP_HOLD, eliminatedRevealed, interactionMode, planBeats, seatState, testimonyHold } from './director.js';
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

describe('导演 · 计票揭示(其他 agent 对在场所有人投票)', () => {
  it('出局前逐张亮出每个人的票:含 AI 投向真人、AI 互投,且都排在 BALLOT_DONE 之前', () => {
    const game = baseGame({
      phase: 'describing',
      round: 2,
      votes: [
        { voterId: 'human', targetId: 'ai-3', reason: '我最怀疑老墨', round: 1, ballot: 1 },
        { voterId: 'ai-1', targetId: 'human', reason: '你太笃定了', round: 1, ballot: 1 },
        { voterId: 'ai-2', targetId: 'ai-3', reason: '老墨的措辞偏', round: 1, ballot: 1 },
        { voterId: 'ai-3', targetId: 'ai-1', reason: '阿序在带节奏', round: 1, ballot: 1 },
        { voterId: 'ai-4', targetId: 'ai-3', reason: '跟着多数走', round: 1, ballot: 1 },
      ],
      events: [
        { id: 'elim1', type: 'elimination', text: '老墨 被投出局', round: 1, playerId: 'ai-3' },
        { id: 's', type: 'system', text: '第 2 轮开始', round: 2 },
      ],
    });
    const beats = planBeats(game, 0, 'voting');
    const votez = beats.filter((b) => b.id.startsWith('vote-'));
    // 五张票全部逐拍亮出,顺序与票序一致(真人先,其后各 AI)。
    expect(votez.map((b) => b.spotlight?.speakerId)).toEqual(['human', 'ai-1', 'ai-2', 'ai-3', 'ai-4']);
    // 目标覆盖「在场所有人」:含 AI 投向真人(ai-1→human)与 AI 互投(ai-3→ai-1)。
    expect(votez.map((b) => b.suspectId)).toEqual(['ai-3', 'human', 'ai-3', 'ai-1', 'ai-3']);
    expect(votez.some((b) => b.suspectId === 'human')).toBe(true);
    // AI 的票带出理由;真人的票用第二人称、不替他杜撰理由。
    expect(votez.find((b) => b.spotlight?.speakerId === 'ai-1')?.spotlight?.text).toContain('你太笃定了');
    expect(votez.find((b) => b.spotlight?.speakerId === 'human')?.spotlight?.text).toBe(
      '你把票投给了「老墨」',
    );
    // 揭示拍是纯呈现(无 machine 事件),且全部排在权威出局判定之前。
    expect(votez.every((b) => b.machine === undefined)).toBe(true);
    const ballotDoneAt = beats.findIndex((b) => b.machine?.type === 'BALLOT_DONE');
    const lastVoteAt = beats.map((b) => b.id.startsWith('vote-')).lastIndexOf(true);
    expect(lastVoteAt).toBeLessThan(ballotDoneAt);
  });

  it('加票复投:平票局揭示首票、出局局揭示加票,两组票各归其位', () => {
    const game = baseGame({
      phase: 'describing',
      round: 2,
      votes: [
        // 首票局(ballot 1):ai-1 与 ai-2 同票 → 平票。
        { voterId: 'human', targetId: 'ai-1', reason: 'r', round: 1, ballot: 1 },
        { voterId: 'ai-3', targetId: 'ai-2', reason: 'r', round: 1, ballot: 1 },
        { voterId: 'ai-4', targetId: 'ai-1', reason: 'r', round: 1, ballot: 1 },
        { voterId: 'ai-1', targetId: 'ai-2', reason: 'r', round: 1, ballot: 1 },
        { voterId: 'ai-2', targetId: 'ai-1', reason: 'r', round: 1, ballot: 1 },
        // 加票局(ballot 2):集中到 ai-1。
        { voterId: 'human', targetId: 'ai-1', reason: 'r', round: 1, ballot: 2 },
        { voterId: 'ai-3', targetId: 'ai-1', reason: 'r', round: 1, ballot: 2 },
        { voterId: 'ai-4', targetId: 'ai-1', reason: 'r', round: 1, ballot: 2 },
        { voterId: 'ai-2', targetId: 'ai-1', reason: 'r', round: 1, ballot: 2 },
      ],
      events: [
        { id: 'tie1', type: 'vote_result', text: '阿序、弥生 同票，进入最终加票。', round: 1 },
        { id: 'elim1', type: 'elimination', text: '阿序 被投出局', round: 1, playerId: 'ai-1' },
        { id: 's', type: 'system', text: '第 2 轮开始', round: 2 },
      ],
    });
    const beats = planBeats(game, 0, 'voting');
    const kinds = beats.map((b) => (b.id.startsWith('vote-') ? `v${b.id.split('-')[2]}` : b.machine?.type));
    // 首票局 5 张 → 平票判定 → 加票局 4 张 → 出局判定 → 交接。
    expect(kinds).toEqual([
      'v1', 'v1', 'v1', 'v1', 'v1',
      'BALLOT_DONE', // tie
      'v2', 'v2', 'v2', 'v2',
      'BALLOT_DONE', // eliminated
      'CONTINUE',
      'INTRO_DONE',
    ]);
    // ballot 号严格由 ballotOfOutcome 推得:平票前只可能是 ballot 1,出局前是 ballot 2。
    const beforeTie = beats.slice(0, beats.findIndex((b) => b.machine?.type === 'BALLOT_DONE'));
    expect(beforeTie.every((b) => b.id.startsWith('vote-1-1-'))).toBe(true);
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

describe('导演 · 停留自适应与直播回带(体验修复)', () => {
  it('testimonyHold 随文本长度增长且有上下界', () => {
    expect(testimonyHold('很短')).toBeGreaterThanOrEqual(1600);
    expect(testimonyHold('这句话明显更长一些，需要更多的阅读时间才行')).toBeGreaterThan(
      testimonyHold('短一点的句子'),
    );
    expect(testimonyHold('超长'.repeat(60))).toBe(6000); // 封顶
  });

  it('已直播过的证词只做快速回带;未直播的全时长;人类不受影响', () => {
    const game = baseGame({
      phase: 'voting',
      events: [
        desc('d-h', 'human', 1),
        desc('d-1', 'ai-1', 1),
        desc('d-2', 'ai-2', 1),
      ],
    });
    const seen = new Set(['1:ai-1']); // 只有 ai-1 这句在生成途中被 SSE 直播过
    const beats = planBeats(game, 0, 'testimony', seen);
    const holdOf = (id: string) => beats.find((b) => b.id === id)!.hold;
    expect(holdOf('d-1')).toBe(RECAP_HOLD); // 直播过 → 快速回带
    expect(holdOf('d-2')).toBe(testimonyHold('ai-2 的描述')); // 未直播 → 全时长
    expect(holdOf('d-h')).toBeGreaterThan(RECAP_HOLD); // 人类拍照旧
    // 回带拍仍驱动状态机与揭示记账(权威管线不因直播绕过)。
    expect(beats.find((b) => b.id === 'd-1')!.machine).toEqual({
      type: 'TESTIMONY_START',
      speakerId: 'ai-1',
    });
    expect(beats.find((b) => b.id === 'd-1')!.reveals).toBe('d-1');
  });

  it('不传 seen(投票/旁观段)行为与原先一致', () => {
    const game = baseGame({
      phase: 'voting',
      events: [desc('d-1', 'ai-1', 1)],
    });
    expect(planBeats(game, 0, 'testimony').find((b) => b.id === 'd-1')!.hold).toBe(
      testimonyHold('ai-1 的描述'),
    );
  });
});
