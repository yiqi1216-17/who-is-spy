import type { Belief } from './schema.js';
import { similarity } from './quality-policy.js';
import type { Description, GameEvent, Player, Role, Vote } from './types.js';

/**
 * 高光检测(OpenSpec 05-H · 任务 5.3/5.4 · design 决策 8)
 *
 * 「先检测,后叙述」:确定性检测器从**公开事件跨度 + 可度量的变化**中提名候选,
 * 每条候选都**援引公开证据**(GameEvent.id / 具体票 / 逐字描述)并携带度量值;
 * 排名器选出一小束**多样**的时刻;卡片默认**隐藏解与身份剧透**,只有在终局揭晓且显式
 * 请求 spoilers 时才附上 spoiler 层(身份/密词/结构化信念增量,均无自由文本 CoT)。
 *
 * 硬性质:
 *  1. 确定性:纯函数,无 Date/Math.random;并列一律以 (score desc, anchorSeq asc, type) 破平。
 *  2. 证据接地:标题/字幕/引语都由证据模板化生成,忠实性闸(verifyFaithfulness)会拦下
 *     任何援引不存在事件、伪造引语或伪造票的卡片 —— 即便未来由模型来润色标题也过此闸。
 *  3. 剧透安全:默认卡片结构上不含 role/word;身份只落在 spoiler 层,由投影按需剥离。
 */

export type HighlightType =
  | 'decisive_vote'
  | 'consensus_flip'
  | 'self_save'
  | 'lone_correct_read'
  | 'undercover_blend'
  | 'callback'
  | 'novel_safe_metaphor';

/** 一条逐字公开引语(锚定到某轮某人的公开描述)。 */
export interface HighlightQuote {
  readonly playerId: string;
  readonly round: number;
  readonly text: string;
  readonly eventId?: string;
}

/** 一处票据援引(voterId→targetId,可回 votes[] 校验存在性)。 */
export interface HighlightVoteRef {
  readonly voterId: string;
  readonly targetId: string;
  readonly round: number;
  readonly ballot: number;
}

/** 一项可复算的度量(before/after 或单值)。 */
export interface HighlightMeasure {
  readonly label: string;
  readonly before?: number;
  readonly after?: number;
  readonly value?: number;
}

/** 剧透层:仅终局 + 显式请求时附上。身份/密词/结构化信念增量,无自由文本。 */
export interface HighlightSpoiler {
  readonly note: string;
  readonly roleReveals?: ReadonlyArray<{ playerId: string; role: Role; word: string }>;
  readonly beliefDeltas?: ReadonlyArray<{
    agentId: string;
    targetId: string;
    before: number;
    after: number;
  }>;
}

/** 检测器提名的候选(内部形态,含 spoiler;投影时按需剥离)。 */
export interface HighlightCandidate {
  readonly type: HighlightType;
  readonly round: number;
  /** 主锚事件下标(= seq):稳定排序 + 稳定卡片 id。 */
  readonly anchorSeq: number;
  readonly citedEventIds: readonly string[];
  readonly citedVotes?: readonly HighlightVoteRef[];
  readonly title: string;
  readonly caption: string;
  readonly quotes: readonly HighlightQuote[];
  readonly measures: readonly HighlightMeasure[];
  /** 显著度 0..1,用于排名。 */
  readonly score: number;
  readonly spoiler?: HighlightSpoiler;
}

/** 对外卡片(spoiler 默认剥离)。 */
export interface HighlightCard {
  readonly id: string;
  readonly type: HighlightType;
  readonly round: number;
  readonly title: string;
  readonly caption: string;
  readonly citedEventIds: readonly string[];
  readonly citedVotes: readonly HighlightVoteRef[];
  readonly quotes: readonly HighlightQuote[];
  readonly measures: readonly HighlightMeasure[];
  readonly spoiler?: HighlightSpoiler;
}

export interface HighlightInput {
  readonly players: readonly Player[];
  readonly descriptions: readonly Description[];
  readonly votes: readonly Vote[];
  readonly events: readonly GameEvent[];
  /** 终局私有信念(agentId → Belief),仅用于 spoiler 层的结构化信念增量。 */
  readonly beliefs?: ReadonlyMap<string, Belief>;
}

export interface RankOptions {
  /** 一束时刻上限。 */
  readonly maxReel?: number;
  /** 每类候选入选上限(保多样)。 */
  readonly perType?: number;
}

const DEFAULT_MAX_REEL = 6;
const DEFAULT_PER_TYPE = 2;

// —— 只读索引(从公开事件 + 票 + 终局身份构建) ——

/** 把描述按 (playerId#round) 映射到其公开描述事件 id 与逐字文本。 */
function indexDescriptionEvents(events: readonly GameEvent[]): Map<string, { id: string; text: string }> {
  const map = new Map<string, { id: string; text: string }>();
  for (const event of events) {
    if (event.type === 'description' && event.playerId) {
      map.set(`${event.playerId}#${event.round}`, { id: event.id, text: event.text });
    }
  }
  return map;
}

/** playerId → 出局轮(仅出局者有值)。 */
function eliminatedRounds(events: readonly GameEvent[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const event of events) {
    if (event.type === 'elimination' && event.playerId) map.set(event.playerId, event.round);
  }
  return map;
}

/** 某玩家在第 r 轮是否存活(出局轮 ≥ r 或从未出局)。 */
function aliveInRound(elim: Map<string, number>, playerId: string, round: number): boolean {
  const gone = elim.get(playerId);
  return gone === undefined || gone >= round;
}

/** 第 r 轮的最终加票轮次(有平票则 > 1)。无票返回 0。 */
function finalBallotOf(votes: readonly Vote[], round: number): number {
  let max = 0;
  for (const vote of votes) if (vote.round === round && vote.ballot > max) max = vote.ballot;
  return max;
}

function votesIn(votes: readonly Vote[], round: number, ballot: number): Vote[] {
  return votes.filter((vote) => vote.round === round && vote.ballot === ballot);
}

/** 计票:targetId → 票数。 */
function tally(votes: readonly Vote[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const vote of votes) map.set(vote.targetId, (map.get(vote.targetId) ?? 0) + 1);
  return map;
}

/** 取票数最高者(并列以 playerId 升序破平,保确定性)。 */
function argmax(counts: Map<string, number>): { id: string; count: number } | null {
  let best: { id: string; count: number } | null = null;
  for (const [id, count] of [...counts.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (best === null || count > best.count) best = { id, count };
  }
  return best;
}

/** 全部并列最高者(用于自救:首轮领跑集合)。 */
function leaders(counts: Map<string, number>): string[] {
  const top = argmax(counts);
  if (!top) return [];
  return [...counts.entries()].filter(([, count]) => count === top.count).map(([id]) => id).sort();
}

/** 一条描述相对本轮其余描述的离群度 = 1 − 平均相似度,夹到 [0,1](与 beliefs 同源口径)。 */
function divergenceInRound(
  text: string,
  roundDescriptions: readonly Description[],
  ownId: string,
): number {
  const rest = roundDescriptions.filter((d) => d.playerId !== ownId);
  if (rest.length === 0) return 0;
  const mean = rest.reduce((acc, d) => acc + similarity(text, d.text), 0) / rest.length;
  const value = 1 - mean;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 检测上下文:把重复计算的索引一次性备好。 */
interface Ctx {
  readonly players: readonly Player[];
  readonly descriptions: readonly Description[];
  readonly votes: readonly Vote[];
  readonly events: readonly GameEvent[];
  readonly beliefs?: ReadonlyMap<string, Belief>;
  readonly descEvent: Map<string, { id: string; text: string }>;
  readonly elim: Map<string, number>;
  readonly rounds: number[];
  readonly undercoverIds: string[];
}

function buildCtx(input: HighlightInput): Ctx {
  const rounds = [...new Set(input.events.map((event) => event.round))].sort((a, b) => a - b);
  return {
    players: input.players,
    descriptions: input.descriptions,
    votes: input.votes,
    events: input.events,
    beliefs: input.beliefs,
    descEvent: indexDescriptionEvents(input.events),
    elim: eliminatedRounds(input.events),
    rounds,
    undercoverIds: input.players.filter((p) => p.role === 'undercover').map((p) => p.id),
  };
}

function nameOf(ctx: Ctx, id: string): string {
  return ctx.players.find((p) => p.id === id)?.name ?? id;
}

function playerOf(ctx: Ctx, id: string): Player | undefined {
  return ctx.players.find((p) => p.id === id);
}

/** 该玩家在第 r 轮的公开描述引语(若存在)。 */
function quoteOf(ctx: Ctx, playerId: string, round: number): HighlightQuote | null {
  const hit = ctx.descEvent.get(`${playerId}#${round}`);
  if (!hit) return null;
  return { playerId, round, text: hit.text, eventId: hit.id };
}

function eliminationEvent(ctx: Ctx, round: number): GameEvent | undefined {
  return ctx.events.find((event) => event.type === 'elimination' && event.round === round);
}

/** 第 r 轮的 vote_result 事件 id(平票加票公告),供援引。 */
function voteResultEventIds(ctx: Ctx, round: number): string[] {
  return ctx.events.filter((e) => e.type === 'vote_result' && e.round === round).map((e) => e.id);
}

function roleRevealOf(ctx: Ctx, playerId: string): { playerId: string; role: Role; word: string } | null {
  const player = playerOf(ctx, playerId);
  if (!player) return null;
  return { playerId, role: player.role, word: player.word };
}

// —— 检测器(每个都确定性、援引公开证据) ——

/** 决定性一票:一次险胜出局(领先票差小),挪走一票即改写结局。 */
function detectDecisiveVotes(ctx: Ctx): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  for (const round of ctx.rounds) {
    const elimEvent = eliminationEvent(ctx, round);
    if (!elimEvent?.playerId) continue;
    const ballot = finalBallotOf(ctx.votes, round);
    if (ballot === 0) continue;
    const ballotVotes = votesIn(ctx.votes, round, ballot);
    const counts = tally(ballotVotes);
    const top = counts.get(elimEvent.playerId) ?? 0;
    let second = 0;
    for (const [id, count] of counts) if (id !== elimEvent.playerId && count > second) second = count;
    if (second < 1 || top <= second) continue; // 无对抗(全票压顶)不算「一票之差」
    const margin = top - second;
    const decidingVotes = ballotVotes
      .filter((vote) => vote.targetId === elimEvent.playerId)
      .map((vote) => ({ voterId: vote.voterId, targetId: vote.targetId, round, ballot }));
    const lastWords = quoteOf(ctx, elimEvent.playerId, round);
    out.push({
      type: 'decisive_vote',
      round,
      anchorSeq: ctx.events.indexOf(elimEvent),
      citedEventIds: [elimEvent.id, ...voteResultEventIds(ctx, round)],
      citedVotes: decidingVotes,
      title: margin === 1 ? `第 ${round} 轮 · 一票之差定生死` : `第 ${round} 轮 · ${margin} 票压线出局`,
      caption: `${nameOf(ctx, elimEvent.playerId)} 以 ${top}:${second} 被票出——${
        margin === 1 ? '任意一票倒戈就是平局' : '优势并不稳固'
      }。`,
      quotes: lastWords ? [lastWords] : [],
      measures: [
        { label: '得票', value: top },
        { label: '次高', value: second },
        { label: '领先票差', value: margin },
      ],
      score: 1 / margin,
      spoiler: buildRevealSpoiler(ctx, [elimEvent.playerId], `${nameOf(ctx, elimEvent.playerId)} 的身份在此刻定格。`),
    });
  }
  return out;
}

/** 共识翻转:上一轮几乎无人怀疑者,这一轮成众矢之的(矛头转向)。 */
function detectConsensusFlips(ctx: Ctx): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  const voted = ctx.rounds.filter((round) => finalBallotOf(ctx.votes, round) > 0);
  for (let i = 1; i < voted.length; i += 1) {
    const prev = voted[i - 1];
    const cur = voted[i];
    const prevCounts = tally(votesIn(ctx.votes, prev, finalBallotOf(ctx.votes, prev)));
    const curCounts = tally(votesIn(ctx.votes, cur, finalBallotOf(ctx.votes, cur)));
    const prevLeader = argmax(prevCounts);
    const curLeader = argmax(curCounts);
    if (!prevLeader || !curLeader) continue;
    if (curLeader.id === prevLeader.id) continue; // 矛头未变
    const before = prevCounts.get(curLeader.id) ?? 0;
    if (before > 1 || curLeader.count < 2) continue; // 需「此前几乎无人怀疑」且「如今形成合围」
    if (!aliveInRound(ctx.elim, curLeader.id, prev)) continue;
    const aliveCount = ctx.players.filter((p) => aliveInRound(ctx.elim, p.id, cur)).length;
    const elimEvent = eliminationEvent(ctx, cur);
    const anchor = elimEvent ?? ctx.events.find((e) => e.type === 'vote_result' && e.round === cur);
    if (!anchor) continue;
    const quote = quoteOf(ctx, curLeader.id, cur);
    out.push({
      type: 'consensus_flip',
      round: cur,
      anchorSeq: ctx.events.indexOf(anchor),
      citedEventIds: [anchor.id, ...voteResultEventIds(ctx, cur)].filter((v, idx, arr) => arr.indexOf(v) === idx),
      title: `第 ${cur} 轮 · 矛头骤然转向`,
      caption: `上一轮还几乎无人怀疑的 ${nameOf(ctx, curLeader.id)},这一轮成了众矢之的(${before}→${curLeader.count} 票)。`,
      quotes: quote ? [quote] : [],
      measures: [{ label: '指向票', before, after: curLeader.count }],
      score: Math.min(1, (curLeader.count - before) / Math.max(2, aliveCount)),
      spoiler: buildFlipSpoiler(ctx, curLeader.id),
    });
  }
  return out;
}

/** 悬崖边的自救:首轮加票领跑,却在最终加票中全身而退。 */
function detectSelfSaves(ctx: Ctx): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  for (const round of ctx.rounds) {
    const finalBallot = finalBallotOf(ctx.votes, round);
    if (finalBallot < 2) continue; // 无平票加票 → 无自救可言
    const first = tally(votesIn(ctx.votes, round, 1));
    const firstLeaders = leaders(first);
    const top = argmax(first);
    if (!top || top.count < 2) continue;
    const elimEvent = eliminationEvent(ctx, round);
    const eliminatedId = elimEvent?.playerId;
    for (const leaderId of firstLeaders) {
      if (leaderId === eliminatedId) continue; // 领跑且最终出局 → 不是自救
      const quote = quoteOf(ctx, leaderId, round);
      const resultIds = voteResultEventIds(ctx, round);
      const anchor = resultIds[0] ? ctx.events.find((e) => e.id === resultIds[0])! : elimEvent;
      if (!anchor) continue;
      out.push({
        type: 'self_save',
        round,
        anchorSeq: ctx.events.indexOf(anchor),
        citedEventIds: [...resultIds, ...(elimEvent ? [elimEvent.id] : [])],
        title: `第 ${round} 轮 · 悬崖边的自救`,
        caption: `${nameOf(ctx, leaderId)} 首轮以 ${first.get(leaderId)} 票领跑,却在加票中全身而退。`,
        quotes: quote ? [quote] : [],
        measures: [{ label: '首轮得票', value: first.get(leaderId) ?? 0 }],
        score: Math.min(1, (first.get(leaderId) ?? 0) / 3),
        spoiler: buildRevealSpoiler(ctx, [leaderId], `${nameOf(ctx, leaderId)} 逃过一劫时的真实身份。`),
      });
    }
  }
  return out;
}

/** 孤独的正确指认:全场仅一人把票投向最终真相,却无人附和(默认卡不点破对错)。 */
function detectLoneCorrectReads(ctx: Ctx): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  for (const undercoverId of ctx.undercoverIds) {
    for (const round of ctx.rounds) {
      if (!aliveInRound(ctx.elim, undercoverId, round)) continue;
      if (ctx.elim.get(undercoverId) === round) continue; // 本轮即被票出 → 非「无人附和」
      const ballot = finalBallotOf(ctx.votes, round);
      if (ballot === 0) continue;
      const forUc = votesIn(ctx.votes, round, ballot).filter((v) => v.targetId === undercoverId);
      if (forUc.length !== 1) continue;
      const voter = forUc[0].voterId;
      if (playerOf(ctx, voter)?.role !== 'civilian') continue; // 平民独自指对
      const anchor = eliminationEvent(ctx, round) ?? ctx.events.find((e) => e.round === round && e.type === 'vote_result');
      if (!anchor) continue;
      const quote = quoteOf(ctx, undercoverId, round);
      out.push({
        type: 'lone_correct_read',
        round,
        anchorSeq: ctx.events.indexOf(anchor),
        citedEventIds: [anchor.id],
        citedVotes: [{ voterId: voter, targetId: undercoverId, round, ballot }],
        title: `第 ${round} 轮 · 一记无人跟注的指认`,
        caption: `${nameOf(ctx, voter)} 独自把票投向 ${nameOf(ctx, undercoverId)},满桌无人附和。`,
        quotes: quote ? [quote] : [],
        measures: [{ label: '附和票', value: 1 }],
        score: Math.max(0.5, 0.95 - 0.12 * (round - 1)),
        spoiler: buildRevealSpoiler(
          ctx,
          [voter, undercoverId],
          `这一票是对的——${nameOf(ctx, undercoverId)} 正是卧底,而 ${nameOf(ctx, voter)} 是全场唯一看穿的人。`,
        ),
      });
    }
  }
  return out;
}

/** 卧底潜行:卧底存活的一轮里一票未得,悄然滑过(默认卡不点破身份)。 */
function detectUndercoverBlend(ctx: Ctx): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  for (const undercoverId of ctx.undercoverIds) {
    for (const round of ctx.rounds) {
      if (!aliveInRound(ctx.elim, undercoverId, round)) continue;
      if (ctx.elim.get(undercoverId) === round) continue;
      const ballot = finalBallotOf(ctx.votes, round);
      if (ballot === 0) continue;
      const forUc = votesIn(ctx.votes, round, ballot).filter((v) => v.targetId === undercoverId).length;
      if (forUc !== 0) continue; // 只取「一票未得」的完美潜行
      const aliveCount = ctx.players.filter((p) => aliveInRound(ctx.elim, p.id, round)).length;
      if (aliveCount < 3) continue; // 桌上人越多,潜行越难越有看点
      const anchor = eliminationEvent(ctx, round) ?? ctx.events.find((e) => e.round === round && e.type === 'vote_result');
      if (!anchor) continue;
      const quote = quoteOf(ctx, undercoverId, round);
      out.push({
        type: 'undercover_blend',
        round,
        anchorSeq: ctx.events.indexOf(anchor),
        citedEventIds: [anchor.id],
        title: `第 ${round} 轮 · 无人指向的身影`,
        caption: `${nameOf(ctx, undercoverId)} 这一轮一票未得,在 ${aliveCount} 人的注视下安然滑过。`,
        quotes: quote ? [quote] : [],
        measures: [{ label: '被指票', value: 0 }, { label: '在场人数', value: aliveCount }],
        score: Math.min(1, 0.4 + 0.12 * aliveCount),
        spoiler: buildRevealSpoiler(ctx, [undercoverId], `${nameOf(ctx, undercoverId)} 正是卧底——这一轮完成了完美潜行。`),
      });
    }
  }
  return out;
}

/** 呼应:同一人后一轮的描述与前一轮遥相呼应(相关但不雷同)。 */
function detectCallbacks(ctx: Ctx): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  const byPlayer = new Map<string, Description[]>();
  for (const description of ctx.descriptions) {
    const bucket = byPlayer.get(description.playerId) ?? [];
    bucket.push(description);
    byPlayer.set(description.playerId, bucket);
  }
  for (const [playerId, list] of byPlayer) {
    const sorted = [...list].sort((a, b) => a.round - b.round);
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        const a = sorted[i];
        const b = sorted[j];
        const sim = similarity(a.text, b.text);
        if (sim < 0.4 || sim > 0.85) continue; // 相关但非逐字复读
        const qa = quoteOf(ctx, playerId, a.round);
        const qb = quoteOf(ctx, playerId, b.round);
        if (!qa || !qb) continue;
        out.push({
          type: 'callback',
          round: b.round,
          anchorSeq: ctx.events.findIndex((e) => e.id === qb.eventId),
          citedEventIds: [qa.eventId!, qb.eventId!],
          title: `呼应 · ${nameOf(ctx, playerId)} 回收了第 ${a.round} 轮的伏笔`,
          caption: `第 ${b.round} 轮的说法与第 ${a.round} 轮遥相呼应,像一条埋了很久的线。`,
          quotes: [qa, qb],
          measures: [{ label: '呼应度', value: round2(sim) }],
          score: Math.min(1, sim + 0.05 * (b.round - a.round)),
          spoiler: buildRevealSpoiler(ctx, [playerId], `回收伏笔的 ${nameOf(ctx, playerId)} 的真实身份。`),
        });
      }
    }
  }
  return out;
}

/** 剑走偏锋却全身而退:全场最离群的描述,却没引火烧身(新颖且安全)。 */
function detectNovelSafeMetaphors(ctx: Ctx): HighlightCandidate[] {
  const out: HighlightCandidate[] = [];
  for (const round of ctx.rounds) {
    const roundDescriptions = ctx.descriptions.filter((d) => d.round === round);
    if (roundDescriptions.length < 3) continue;
    const ballot = finalBallotOf(ctx.votes, round);
    const counts = ballot > 0 ? tally(votesIn(ctx.votes, round, ballot)) : new Map<string, number>();
    for (const description of roundDescriptions) {
      const speaker = description.playerId;
      if (ctx.elim.get(speaker) === round) continue; // 本轮出局 → 不算安全
      const div = divergenceInRound(description.text, roundDescriptions, speaker);
      const received = counts.get(speaker) ?? 0;
      if (div < 0.6 || received > 1) continue; // 需足够离群 + 未被合围
      const quote = quoteOf(ctx, speaker, round);
      if (!quote) continue;
      out.push({
        type: 'novel_safe_metaphor',
        round,
        anchorSeq: ctx.events.findIndex((e) => e.id === quote.eventId),
        citedEventIds: [quote.eventId!],
        title: `第 ${round} 轮 · 剑走偏锋却全身而退`,
        caption: `${nameOf(ctx, speaker)} 给出了全场最离经叛道的描述,却没有引火烧身。`,
        quotes: [quote],
        measures: [{ label: '新颖度', value: round2(div) }, { label: '得票', value: received }],
        score: Math.min(1, div * (1 - 0.2 * received)),
        spoiler: buildRevealSpoiler(ctx, [speaker], `敢于剑走偏锋的 ${nameOf(ctx, speaker)} 的真实身份。`),
      });
    }
  }
  return out;
}

// —— spoiler 层构造(仅在终局 + 显式请求时随卡片附出) ——

function buildRevealSpoiler(ctx: Ctx, playerIds: readonly string[], note: string): HighlightSpoiler {
  const roleReveals = playerIds
    .map((id) => roleRevealOf(ctx, id))
    .filter((reveal): reveal is { playerId: string; role: Role; word: string } => reveal !== null);
  return { note, roleReveals };
}

/** 共识翻转的 spoiler:身份揭晓 + 各 agent 对该目标的结构化信念增量(无自由文本)。 */
function buildFlipSpoiler(ctx: Ctx, targetId: string): HighlightSpoiler {
  const base = buildRevealSpoiler(ctx, [targetId], `矛头所向的 ${nameOf(ctx, targetId)} 究竟是谁。`);
  if (!ctx.beliefs) return base;
  const beliefDeltas: Array<{ agentId: string; targetId: string; before: number; after: number }> = [];
  for (const [agentId, belief] of ctx.beliefs) {
    if (agentId === targetId) continue;
    const suspicion = belief.suspicions.find((s) => s.playerId === targetId);
    if (suspicion) beliefDeltas.push({ agentId, targetId, before: 0, after: round2(suspicion.score) });
  }
  return { ...base, beliefDeltas: beliefDeltas.sort((a, b) => (a.agentId < b.agentId ? -1 : 1)) };
}

// —— 忠实性闸 + 排名 + 投影 ——

export interface FaithfulnessResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

/**
 * 忠实性闸:拦下援引不存在事件、伪造引语、伪造票的候选。
 * 这一层是 design 决策 8 的硬保证 —— 即便未来由终局模型来润色标题/字幕,也须过此闸。
 */
export function verifyFaithfulness(candidate: HighlightCandidate, input: HighlightInput): FaithfulnessResult {
  const issues: string[] = [];
  const eventIds = new Set(input.events.map((event) => event.id));
  for (const id of candidate.citedEventIds) {
    if (!eventIds.has(id)) issues.push(`未知事件援引:${id}`);
  }
  for (const quote of candidate.quotes) {
    const real = input.descriptions.find(
      (d) => d.playerId === quote.playerId && d.round === quote.round && d.text === quote.text,
    );
    if (!real) issues.push(`伪造引语:${quote.playerId}@r${quote.round}`);
    if (quote.eventId && !eventIds.has(quote.eventId)) issues.push(`引语事件不存在:${quote.eventId}`);
  }
  for (const ref of candidate.citedVotes ?? []) {
    const real = input.votes.find(
      (v) =>
        v.voterId === ref.voterId &&
        v.targetId === ref.targetId &&
        v.round === ref.round &&
        v.ballot === ref.ballot,
    );
    if (!real) issues.push(`伪造票:${ref.voterId}→${ref.targetId}@r${ref.round}b${ref.ballot}`);
  }
  if (candidate.anchorSeq < 0) issues.push('锚点缺失');
  return { ok: issues.length === 0, issues };
}

/**
 * 排名:按 score 降序选一小束**多样**时刻。先按每类上限贪心保多样,
 * 若仍不足 maxReel 再以纯 score 补位;候选不足则**只给这些,不填充**(不无中生有)。
 */
export function rankReel(candidates: readonly HighlightCandidate[], options: RankOptions = {}): HighlightCandidate[] {
  const maxReel = options.maxReel ?? DEFAULT_MAX_REEL;
  const perType = options.perType ?? DEFAULT_PER_TYPE;
  const sorted = [...candidates].sort(
    (a, b) => b.score - a.score || a.anchorSeq - b.anchorSeq || (a.type < b.type ? -1 : a.type > b.type ? 1 : 0),
  );
  const picked: HighlightCandidate[] = [];
  const perTypeCount = new Map<HighlightType, number>();
  // 第一遍:每类不超过 perType,保多样。
  for (const candidate of sorted) {
    if (picked.length >= maxReel) break;
    const count = perTypeCount.get(candidate.type) ?? 0;
    if (count >= perType) continue;
    picked.push(candidate);
    perTypeCount.set(candidate.type, count + 1);
  }
  // 第二遍:仍有空位则以 score 补位(允许同类超额),但绝不填充不存在的候选。
  if (picked.length < maxReel) {
    for (const candidate of sorted) {
      if (picked.length >= maxReel) break;
      if (picked.includes(candidate)) continue;
      picked.push(candidate);
    }
  }
  return picked;
}

/** 候选 → 对外卡片。默认剥离 spoiler;revealSpoilers 时保留(仅终局路径调用)。 */
export function toCard(candidate: HighlightCandidate, revealSpoilers: boolean): HighlightCard {
  const card: HighlightCard = {
    id: `${candidate.type}-${candidate.anchorSeq}`,
    type: candidate.type,
    round: candidate.round,
    title: candidate.title,
    caption: candidate.caption,
    citedEventIds: candidate.citedEventIds,
    citedVotes: candidate.citedVotes ?? [],
    quotes: candidate.quotes,
    measures: candidate.measures,
  };
  if (revealSpoilers && candidate.spoiler) return { ...card, spoiler: candidate.spoiler };
  return card;
}

export interface HighlightReel {
  readonly available: boolean;
  readonly cards: readonly HighlightCard[];
}

/**
 * 端到端:跑全部检测器 → 忠实性闸过滤 → 排名取一小束多样时刻 → 投影为卡片。
 * revealSpoilers 仅应在**终局揭晓**后为 true;默认卡片结构上不含 role/word。
 */
export function buildHighlights(
  input: HighlightInput,
  options: RankOptions & { revealSpoilers?: boolean } = {},
): HighlightReel {
  const ctx = buildCtx(input);
  const candidates = [
    ...detectDecisiveVotes(ctx),
    ...detectConsensusFlips(ctx),
    ...detectSelfSaves(ctx),
    ...detectLoneCorrectReads(ctx),
    ...detectUndercoverBlend(ctx),
    ...detectCallbacks(ctx),
    ...detectNovelSafeMetaphors(ctx),
  ].filter((candidate) => verifyFaithfulness(candidate, input).ok);
  const reel = rankReel(candidates, options);
  return { available: true, cards: reel.map((candidate) => toCard(candidate, options.revealSpoilers ?? false)) };
}
