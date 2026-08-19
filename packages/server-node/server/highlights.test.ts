import { describe, expect, it } from 'vitest';
import {
  buildHighlights,
  rankReel,
  toCard,
  verifyFaithfulness,
  type HighlightCandidate,
  type HighlightInput,
  type HighlightType,
} from './highlights.js';
import { scanSecrets } from './redaction.js';
import type { Description, GameEvent, Player, Role, Vote } from './types.js';

/**
 * 高光检测 · fixture-backed(OpenSpec 05-H · 任务 5.3/5.4 · design 决策 8)
 *
 * 一桌确定性「完整对局」夹具同时触发七类检测器;另有聚焦用例钉死:
 * 忠实性闸(拦伪造引语/票/事件)、排名的多样与有界与不填充、以及剧透安全(默认无 role/word)。
 */

// —— 夹具构造:一桌 5 人两轮的确定性对局 ——

function player(id: string, role: Role, word: string): Player {
  return { id, name: id.toUpperCase(), avatar: id[0], isHuman: id === 'p1', role, word, alive: true };
}

const CIV = '钢琴';
const UC = '吉他';
const PLAYERS: Player[] = [
  player('p1', 'civilian', CIV),
  player('p2', 'civilian', CIV),
  player('p3', 'undercover', UC),
  player('p4', 'civilian', CIV),
  player('p5', 'civilian', CIV),
];

// 逐字描述(刻意不含密词字面量,模拟合规发言)。
const SAYS: Array<{ playerId: string; round: number; text: string }> = [
  { playerId: 'p1', round: 1, text: '黑白相间的键盘乐器' },
  { playerId: 'p2', round: 1, text: '月光下安静的湖面倒映着夜色' }, // 离群 → 新颖安全
  { playerId: 'p3', round: 1, text: '抱在怀里拨动琴弦' },
  { playerId: 'p4', round: 1, text: '有很多琴键的大家伙' },
  { playerId: 'p5', round: 1, text: '需要踩踏板来延音' },
  { playerId: 'p1', round: 2, text: '黑白相间的键盘' }, // 呼应第 1 轮
  { playerId: 'p2', round: 2, text: '还要踩踏板延音' },
  { playerId: 'p3', round: 2, text: '拨动琴弦让它响' },
  { playerId: 'p4', round: 2, text: '很大的键盘家具' },
];

const DESCRIPTIONS: Description[] = SAYS.map(({ playerId, round, text }) => ({ playerId, round, text }));

// 事件链(下标即 seq);描述事件与 SAYS 对齐,供引语忠实性校验。
function buildEvents(): GameEvent[] {
  const events: GameEvent[] = [];
  let i = 0;
  const push = (event: Omit<GameEvent, 'id'>) => events.push({ id: `e${i++}`, ...event });
  push({ type: 'system', text: '开局', round: 1 });
  for (const s of SAYS.filter((x) => x.round === 1))
    push({ type: 'description', text: s.text, round: 1, playerId: s.playerId });
  push({ type: 'elimination', text: 'P5 被投出局', round: 1, playerId: 'p5' });
  push({ type: 'system', text: '第 2 轮开始', round: 2 });
  for (const s of SAYS.filter((x) => x.round === 2))
    push({ type: 'description', text: s.text, round: 2, playerId: s.playerId });
  push({ type: 'vote_result', text: 'P2、P4 同票,进入加票', round: 2 });
  push({ type: 'elimination', text: 'P4 被投出局', round: 2, playerId: 'p4' });
  return events;
}

function vote(voterId: string, targetId: string, round: number, ballot: number): Vote {
  return { voterId, targetId, reason: '', round, ballot };
}

const VOTES: Vote[] = [
  // 第 1 轮:P5 以 2:1 险出局(margin 1);P3 一票未得(潜行)。
  vote('p1', 'p5', 1, 1),
  vote('p2', 'p5', 1, 1),
  vote('p3', 'p1', 1, 1),
  vote('p4', 'p2', 1, 1),
  vote('p5', 'p4', 1, 1),
  // 第 2 轮加票一:P2、P4 同票(2:2)→ 平票加票。
  vote('p1', 'p4', 2, 1),
  vote('p2', 'p4', 2, 1),
  vote('p3', 'p2', 2, 1),
  vote('p4', 'p2', 2, 1),
  // 第 2 轮加票二:P4 出局;P1 独自指向 P3(卧底)且无人附和;P2 从悬崖边逃生。
  vote('p1', 'p3', 2, 2),
  vote('p2', 'p4', 2, 2),
  vote('p3', 'p4', 2, 2),
  vote('p4', 'p2', 2, 2),
];

function fixture(): HighlightInput {
  return { players: PLAYERS, descriptions: DESCRIPTIONS, votes: VOTES, events: buildEvents() };
}

/** 取全部候选(抬高上限,让排名不丢任何类型),便于断言检测覆盖。 */
function detectedTypes(): Set<HighlightType> {
  const reel = buildHighlights(fixture(), { maxReel: 50, perType: 50 });
  return new Set(reel.cards.map((card) => card.type));
}

describe('高光检测器 · 完整对局夹具覆盖七类', () => {
  it('决定性一票:险胜出局(margin 1)被识别', () => {
    expect(detectedTypes().has('decisive_vote')).toBe(true);
  });

  it('卧底潜行:存活一轮里一票未得', () => {
    expect(detectedTypes().has('undercover_blend')).toBe(true);
  });

  it('新颖安全:全场最离群却未被合围', () => {
    expect(detectedTypes().has('novel_safe_metaphor')).toBe(true);
  });

  it('共识翻转:此前无人怀疑者成众矢之的', () => {
    expect(detectedTypes().has('consensus_flip')).toBe(true);
  });

  it('悬崖自救:首轮领跑却全身而退', () => {
    expect(detectedTypes().has('self_save')).toBe(true);
  });

  it('孤独指认:全场唯一把票投向卧底', () => {
    expect(detectedTypes().has('lone_correct_read')).toBe(true);
  });

  it('呼应:同一人跨轮回收伏笔', () => {
    expect(detectedTypes().has('callback')).toBe(true);
  });

  it('每张卡片都援引至少一个存在的公开事件 id', () => {
    const reel = buildHighlights(fixture(), { maxReel: 50, perType: 50 });
    const eventIds = new Set(buildEvents().map((event) => event.id));
    for (const card of reel.cards) {
      expect(card.citedEventIds.length).toBeGreaterThan(0);
      for (const id of card.citedEventIds) expect(eventIds.has(id)).toBe(true);
    }
  });
});

describe('剧透安全 · 默认隐藏解与身份(任务 5.2/5.4)', () => {
  it('默认卡片结构上不含 role/word,且密词零泄漏', () => {
    const reel = buildHighlights(fixture(), { maxReel: 50 });
    const serialized = JSON.stringify(reel.cards);
    expect(serialized).not.toContain('"role"');
    expect(serialized).not.toContain('"word"');
    expect(serialized).not.toContain('"spoiler"');
    expect(scanSecrets(serialized)).toEqual([]); // 默认层绝不出现 钢琴/吉他
  });

  it('revealSpoilers:孤独指认卡的 spoiler 层揭晓卧底身份与密词', () => {
    const reel = buildHighlights(fixture(), { maxReel: 50, perType: 50, revealSpoilers: true });
    const lone = reel.cards.find((card) => card.type === 'lone_correct_read');
    expect(lone?.spoiler).toBeDefined();
    const reveal = lone!.spoiler!.roleReveals?.find((r) => r.playerId === 'p3');
    expect(reveal).toEqual({ playerId: 'p3', role: 'undercover', word: UC });
    // 剧透层确实承载密词(与默认层的零泄漏形成对照)。
    expect(scanSecrets(JSON.stringify(lone!.spoiler))).toContain(UC);
  });

  it('共识翻转的 spoiler 携带结构化信念增量(无自由文本 CoT)', () => {
    const beliefs = new Map([
      ['p1', { round: 2, suspicions: [{ playerId: 'p4', score: 0.8 }], selfExposure: 0.1, evidenceRefs: [] }],
    ]);
    const reel = buildHighlights({ ...fixture(), beliefs }, { maxReel: 50, perType: 50, revealSpoilers: true });
    const flip = reel.cards.find((card) => card.type === 'consensus_flip');
    const delta = flip?.spoiler?.beliefDeltas?.find((d) => d.agentId === 'p1' && d.targetId === 'p4');
    expect(delta?.after).toBeCloseTo(0.8, 5);
    // 信念增量只有分数,无任何自由文本键。
    expect(JSON.stringify(flip?.spoiler?.beliefDeltas)).not.toMatch(/text|reason|thought/i);
  });
});

describe('忠实性闸 · 拦下伪造(任务 5.4)', () => {
  const input = fixture();
  const base: HighlightCandidate = {
    type: 'decisive_vote',
    round: 1,
    anchorSeq: 6,
    citedEventIds: ['e6'],
    citedVotes: [{ voterId: 'p1', targetId: 'p5', round: 1, ballot: 1 }],
    title: 't',
    caption: 'c',
    quotes: [{ playerId: 'p5', round: 1, text: '需要踩踏板来延音', eventId: 'e5' }],
    measures: [],
    score: 1,
  };

  it('证据齐全的候选通过', () => {
    expect(verifyFaithfulness(base, input).ok).toBe(true);
  });

  it('援引不存在的事件 id → 拦下', () => {
    const bad = { ...base, citedEventIds: ['e999'] };
    const result = verifyFaithfulness(bad, input);
    expect(result.ok).toBe(false);
    expect(result.issues.join()).toMatch(/未知事件/);
  });

  it('伪造引语(非逐字公开描述)→ 拦下', () => {
    const bad = { ...base, quotes: [{ playerId: 'p5', round: 1, text: '我编的台词' }] };
    expect(verifyFaithfulness(bad, input).ok).toBe(false);
  });

  it('伪造票(votes[] 里不存在)→ 拦下', () => {
    const bad = { ...base, citedVotes: [{ voterId: 'p1', targetId: 'p2', round: 1, ballot: 1 }] };
    expect(verifyFaithfulness(bad, input).ok).toBe(false);
  });

  it('buildHighlights 内置此闸:任何不忠实候选都不会成卡', () => {
    // 端到端已在上组覆盖;此处确认闸是 buildHighlights 的一部分(空局产出空束、不抛错)。
    const empty = buildHighlights({ players: PLAYERS, descriptions: [], votes: [], events: [] });
    expect(empty.available).toBe(true);
    expect(empty.cards).toEqual([]);
  });
});

describe('排名 · 多样、有界、不填充(任务 5.4)', () => {
  function candidate(type: HighlightType, seq: number, score: number): HighlightCandidate {
    return {
      type,
      round: 1,
      anchorSeq: seq,
      citedEventIds: [`e${seq}`],
      title: `${type}-${seq}`,
      caption: '',
      quotes: [],
      measures: [],
      score,
    };
  }

  it('有界:不超过 maxReel', () => {
    const many = Array.from({ length: 20 }, (_, i) => candidate('decisive_vote', i, 1 - i * 0.01));
    expect(rankReel(many, { maxReel: 6, perType: 2 }).length).toBe(6);
  });

  it('多样:首轮每类不超过 perType,优先铺开类型', () => {
    const pool = [
      candidate('decisive_vote', 0, 0.9),
      candidate('decisive_vote', 1, 0.85),
      candidate('decisive_vote', 2, 0.8),
      candidate('consensus_flip', 3, 0.7),
      candidate('self_save', 4, 0.6),
      candidate('callback', 5, 0.5),
    ];
    const picked = rankReel(pool, { maxReel: 4, perType: 2 });
    expect(picked.length).toBe(4);
    const decisive = picked.filter((c) => c.type === 'decisive_vote').length;
    expect(decisive).toBeLessThanOrEqual(2); // 未被单一类型垄断
    expect(new Set(picked.map((c) => c.type)).size).toBeGreaterThanOrEqual(3);
  });

  it('不填充:候选少于上限时只给这些(不无中生有)', () => {
    const two = [candidate('decisive_vote', 0, 0.9), candidate('callback', 1, 0.8)];
    expect(rankReel(two, { maxReel: 6 }).length).toBe(2);
  });

  it('确定性:同输入两次排名逐字一致', () => {
    const pool = [
      candidate('decisive_vote', 0, 0.5),
      candidate('consensus_flip', 1, 0.5), // 同分 → 以 anchorSeq/type 破平
      candidate('self_save', 2, 0.5),
    ];
    expect(rankReel(pool)).toEqual(rankReel(pool));
  });
});

describe('toCard · 投影', () => {
  const candidate: HighlightCandidate = {
    type: 'self_save',
    round: 2,
    anchorSeq: 12,
    citedEventIds: ['e12'],
    title: 't',
    caption: 'c',
    quotes: [],
    measures: [],
    score: 0.7,
    spoiler: { note: 'secret', roleReveals: [{ playerId: 'p2', role: 'civilian', word: CIV }] },
  };

  it('默认剥离 spoiler,id 由 type+anchorSeq 稳定派生', () => {
    const card = toCard(candidate, false);
    expect(card.spoiler).toBeUndefined();
    expect(card.id).toBe('self_save-12');
  });

  it('revealSpoilers=true 时保留 spoiler 层', () => {
    expect(toCard(candidate, true).spoiler).toBeDefined();
  });
});
