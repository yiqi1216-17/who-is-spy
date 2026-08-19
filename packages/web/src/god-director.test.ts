import { describe, expect, it } from 'vitest';
import { godEliminated, planGodBeats, type GodBeat } from './god-director.js';
import type { GodGameState } from './types.js';

/**
 * 上帝放映导演测试:钉死「一次性全局 → 自走放映拍」的线性化。
 * 重点:轮次横幅去重、内心 OS 只挂描述拍、计票逐张揭示(含 AI 互投与加票复投)、
 * 终局收束、以及派生的渐进出局灰度。
 */

// 一桌四 AI、老墨(ai-3)为卧底、两轮解出的完整对局投影。
function fixture(): GodGameState {
  return {
    id: 'god-1',
    phase: 'finished',
    round: 2,
    ballot: 1,
    model: 'deepseek-chat',
    winner: 'civilian',
    players: [
      seat('ai-1', '阿序', 'civilian', '电视剧'),
      seat('ai-2', '弥生', 'civilian', '电视剧'),
      seat('ai-3', '老墨', 'undercover', '电影'),
      seat('ai-4', '小满', 'civilian', '电视剧'),
    ],
    descriptions: [],
    thoughts: [
      { round: 1, playerId: 'ai-1', text: '我先抛个稳的，别露词。' },
      { round: 1, playerId: 'ai-2', text: '阿序太笃定，先盯着。' },
      { round: 1, playerId: 'ai-3', text: '我词不一样，得往大众靠。' },
      { round: 1, playerId: 'ai-4', text: '信息太少，跟票为主。' },
      { round: 2, playerId: 'ai-2', text: '老墨那句太泛，可疑。' },
      { round: 2, playerId: 'ai-3', text: '危险,得把水搅浑。' },
      { round: 2, playerId: 'ai-4', text: '这轮我押老墨。' },
    ],
    votes: [
      // 第 1 轮首票:2-2 平票(阿序 vs 老墨),含 AI 互投。
      vote('ai-1', 'ai-3', '他描述太滑', 1, 1),
      vote('ai-2', 'ai-3', '跟阿序判断', 1, 1),
      vote('ai-3', 'ai-1', '反咬最笃定的', 1, 1),
      vote('ai-4', 'ai-1', '阿序太急', 1, 1),
      // 第 1 轮加票复投:阿序出局。
      vote('ai-1', 'ai-3', '我还是信自己', 1, 2),
      vote('ai-2', 'ai-1', '改跟多数', 1, 2),
      vote('ai-3', 'ai-1', '继续咬阿序', 1, 2),
      vote('ai-4', 'ai-1', '押阿序', 1, 2),
      // 第 2 轮:老墨(卧底)出局。
      vote('ai-2', 'ai-3', '老墨最泛', 2, 1),
      vote('ai-3', 'ai-2', '拉弥生下水', 2, 1),
      vote('ai-4', 'ai-3', '跟弥生', 2, 1),
    ],
    events: [
      ev('e1', 'system', '第 1 轮开始', 1),
      ev('e2', 'description', '像放松时会看的东西', 1, 'ai-1'),
      ev('e3', 'description', '晚饭后常打开它', 1, 'ai-2'),
      ev('e4', 'description', '要买票才能看的那种', 1, 'ai-3'),
      ev('e5', 'description', '一集一集追下去', 1, 'ai-4'),
      ev('e6', 'vote_result', '阿序与老墨平票,进入加票', 1),
      ev('e7', 'elimination', '阿序出局', 1, 'ai-1'),
      ev('e8', 'system', '第 2 轮开始', 2),
      ev('e9', 'description', '还是会一直追', 2, 'ai-2'),
      ev('e10', 'description', '一个人也能看很久', 2, 'ai-3'),
      ev('e11', 'description', '每天都更新', 2, 'ai-4'),
      ev('e12', 'elimination', '老墨出局,卧底落网', 2, 'ai-3'),
    ],
    review: {
      headline: '两轮锁定卧底',
      summary: '平票加赛后先误伤,次轮修正抓出老墨。',
      turningPoints: ['第 1 轮平票'],
      playerInsights: [{ playerId: 'ai-3', insight: '把水搅浑但败于细节' }],
    },
  };
}

function seat(id: string, name: string, role: 'civilian' | 'undercover', word: string) {
  return {
    id,
    name,
    avatar: id,
    alive: id !== 'ai-1' && id !== 'ai-3',
    role,
    word,
    strategy: { persona: '稳', tactics: ['靠拢大众'], specificity: 0.4, novelty: 0.3, risk: 0.2 },
  };
}
function vote(voterId: string, targetId: string, reason: string, round: number, ballot: number) {
  return { voterId, targetId, reason, round, ballot };
}
function ev(
  id: string,
  type: 'system' | 'description' | 'vote_result' | 'elimination',
  text: string,
  round: number,
  playerId?: string,
) {
  return { id, type, text, round, playerId };
}

describe('上帝导演 · 线性化全局放映', () => {
  const beats = planGodBeats(fixture());
  const kinds = beats.map((b) => b.kind);
  const byId = (id: string): GodBeat | undefined => beats.find((b) => b.id === id);

  it('系统事件不入放映,首拍即第 1 轮横幅', () => {
    expect(beats[0].kind).toBe('round');
    expect(beats[0].round).toBe(1);
    expect(beats[0].id).toBe('ground-1');
    expect(beats.some((b) => b.id === 'e1' || b.id === 'e8')).toBe(false);
  });

  it('轮次横幅按轮去重:仅两拍 round,且分别为第 1、2 轮', () => {
    const rounds = beats.filter((b) => b.kind === 'round');
    expect(rounds.map((b) => b.round)).toEqual([1, 2]);
  });

  it('内心 OS 只挂描述拍,并按(轮,人)对号', () => {
    const d1 = byId('e2');
    expect(d1?.kind).toBe('describe');
    expect(d1?.speakerId).toBe('ai-1');
    expect(d1?.thought).toBe('我先抛个稳的，别露词。');
    // e10 = 老墨(ai-3)第 2 轮的发言 → 挂其 (round2, ai-3) 心声。
    const d2r2 = byId('e10');
    expect(d2r2?.speakerId).toBe('ai-3');
    expect(d2r2?.thought).toBe('危险,得把水搅浑。');
    // 非描述拍不携带内心 OS。
    expect(beats.filter((b) => b.kind !== 'describe').every((b) => b.thought === null)).toBe(true);
  });

  it('计票逐张揭示:平票局亮首票、出局局亮加票,含 AI 互投', () => {
    const tieIndex = beats.findIndex((b) => b.id === 'e6');
    const beforeTie = beats.slice(0, tieIndex).filter((b) => b.kind === 'vote');
    // 首票四张,均属 (round1, ballot1)。
    expect(beforeTie).toHaveLength(4);
    expect(beforeTie.every((b) => b.id.startsWith('gvote-1-1-'))).toBe(true);
    // 目标覆盖 AI 互投(阿序/老墨都被同侪投票)。
    const targets = new Set(beforeTie.map((b) => b.targetId));
    expect(targets.has('ai-1')).toBe(true);
    expect(targets.has('ai-3')).toBe(true);
    // 出局前先亮加票(ballot2)四张。
    const elimIndex = beats.findIndex((b) => b.id === 'e7');
    const beforeElim = beats.slice(tieIndex + 1, elimIndex).filter((b) => b.kind === 'vote');
    expect(beforeElim).toHaveLength(4);
    expect(beforeElim.every((b) => b.id.startsWith('gvote-1-2-'))).toBe(true);
  });

  it('票拍文案含投票人、目标与理由', () => {
    const v = byId('gvote-1-1-ai-1');
    expect(v?.text).toBe('阿序 投「老墨」· 他描述太滑');
    expect(v?.focusId).toBe('ai-1');
    expect(v?.suspectId).toBe('ai-3');
  });

  it('第 2 轮出局仅亮该轮首票三张', () => {
    const elim2 = beats.findIndex((b) => b.id === 'e12');
    const round2Votes = beats.slice(0, elim2).filter((b) => b.kind === 'vote' && b.id.startsWith('gvote-2-'));
    expect(round2Votes).toHaveLength(3);
    expect(round2Votes.every((b) => b.id.startsWith('gvote-2-1-'))).toBe(true);
  });

  it('终局收束为 finale 拍', () => {
    expect(kinds[kinds.length - 1]).toBe('finale');
    expect(beats[beats.length - 1].id).toBe('gfinale');
  });

  it('整体拍序符合预期', () => {
    expect(kinds).toEqual([
      'round',
      'describe', 'describe', 'describe', 'describe',
      'vote', 'vote', 'vote', 'vote',
      'tie',
      'vote', 'vote', 'vote', 'vote',
      'eliminate',
      'round',
      'describe', 'describe', 'describe',
      'vote', 'vote', 'vote',
      'eliminate',
      'finale',
    ]);
  });
});

describe('上帝导演 · 派生渐进出局', () => {
  const beats = planGodBeats(fixture());

  it('放映到终局前,已亮出两名出局者', () => {
    const last = beats.length - 1;
    const out = godEliminated(beats, last);
    expect(out.has('ai-1')).toBe(true);
    expect(out.has('ai-3')).toBe(true);
    expect(out.size).toBe(2);
  });

  it('放映到第一次出局拍时,只灰阿序', () => {
    const firstElim = beats.findIndex((b) => b.id === 'e7');
    const out = godEliminated(beats, firstElim);
    expect(out.has('ai-1')).toBe(true);
    expect(out.has('ai-3')).toBe(false);
  });

  it('放映伊始无人出局', () => {
    expect(godEliminated(beats, 0).size).toBe(0);
  });
});
