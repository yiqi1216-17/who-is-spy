import { describe, expect, it } from 'vitest';
import { GameEngine } from './game-engine.js';
import { deterministicSafeHuman, mulberry32 } from './eval/self-play.js';
import { scanSecrets } from './redaction.js';
import { projectEnvelopes, type StreamEnvelope } from './stream.js';
import { FakeGameModel } from './test-utils.js';
import { WORD_PAIRS } from './words.js';
import type { GameEvent, PublicGameState } from './types.js';

/**
 * 直播 AI 剧场 · 配对隐私证明(OpenSpec 05-H · 任务 5.1)
 *
 * 「直播剧场」= 只读公开事件流(SSE 信封)。本文件用**配对/差分**方式钉死一条强不变量:
 * 终局前的剧场投影只由**公开事件日志**决定 —— role / word / belief / 私有 prompt / 未公布票
 * 都无法影响它。这比「扫不到已知密词」更强:证明的是「私有态改变 → 公开投影不变」。
 *
 * 三层证明:
 *  A. 纯函数:projectEnvelopes 的唯一入参是公开事件日志;两套截然不同的私有宇宙留不下痕迹。
 *  B. 配对差分(engine 层):两个不同种子的引擎——卧底座次 / 词对确有差异——在同一检查点
 *     产出**逐拍全等**的剧场信封(剥离易变 UUID 后)。附非空断言:两局身份指派确实不同。
 *  C. 私有信念与未公布票:信念已被私有地计算并存储,却零痕迹进入公开流;每张进入公开投影的
 *     票都已有对应「已公布结果」,不存在抢跑泄漏。
 */

/** 剥离易变 id(事件 UUID、gameId)后,只留公开内容,用于配对逐拍深比。 */
function stableFeed(feed: StreamEnvelope[]) {
  return feed.map((envelope) => ({
    seq: envelope.seq,
    v: envelope.v,
    event: {
      type: envelope.event.type,
      text: envelope.event.text,
      round: envelope.event.round,
      playerId: envelope.event.playerId ?? null,
    },
  }));
}

/** 把一局推进到「第 1 轮描述完毕、进入投票、尚无人出局」的检查点(此刻公开日志与身份无关)。 */
async function toRound1VotingCheckpoint(engine: GameEngine): Promise<string> {
  const created = engine.createGame();
  await engine.submitHumanDescription(created.id, deterministicSafeHuman.describe(created, 1));
  return created.id;
}

/** engine 层驱动到终局(镜像 HTTP driveToFinished),用于「非空」与「票—结果配对」断言。 */
async function driveToFinished(engine: GameEngine, id: string): Promise<PublicGameState> {
  let state = engine.getGame(id);
  let guard = 0;
  while (state.phase !== 'finished' && guard < 64) {
    guard += 1;
    const human = state.players.find((player) => player.isHuman);
    if (human && !human.alive) {
      state = await engine.continueAsSpectator(id);
      continue;
    }
    state =
      state.phase === 'describing'
        ? await engine.submitHumanDescription(id, deterministicSafeHuman.describe(state, state.round))
        : await engine.submitHumanVote(id, deterministicSafeHuman.vote(state));
  }
  expect(state.phase).toBe('finished');
  return state;
}

/** 一局的身份指纹(仅终局可读),用于「两局确有差异」的非空断言。 */
function secretFingerprint(finished: PublicGameState): string {
  return finished.players
    .map((player) => `${player.id}:${player.revealedRole}:${player.revealedWord}`)
    .join('|');
}

describe('直播剧场 · 公开事件日志是投影的唯一输入(纯函数)', () => {
  it('两套截然不同的私有宇宙共享同一公开日志 → 信封零泄漏且可复现', () => {
    const events: GameEvent[] = [
      { id: 'e0', type: 'system', text: '密词已发放。请用一句话描述它，但不要直接说出答案。', round: 1 },
      { id: 'e1', type: 'description', text: '黑白相间，按下去会发出声音', round: 1, playerId: 'human' },
      { id: 'e2', type: 'description', text: '需要用手指去逐一触碰', round: 1, playerId: 'ai-1' },
      { id: 'e3', type: 'vote_result', text: '本轮 ai-4 得票最高', round: 1 },
      { id: 'e4', type: 'elimination', text: 'ai-4 被票出', round: 1, playerId: 'ai-4' },
    ];
    // 两套私有宇宙(role / word / 信念理由),**均不**作为 projectEnvelopes 的入参。
    const universe1 = { undercover: 'human', pair: WORD_PAIRS[9] /* 钢琴 / 吉他 */, beliefReason: '钢琴 最像' };
    const universe2 = { undercover: 'ai-3', pair: WORD_PAIRS[2] /* 火锅 / 麻辣烫 */, beliefReason: '火锅 太稳' };

    const feed = projectEnvelopes('game-x', events, -1);
    const json = JSON.stringify(feed);

    for (const word of [...universe1.pair, ...universe2.pair]) expect(json).not.toContain(word);
    expect(json).not.toContain(universe1.beliefReason);
    expect(json).not.toContain(universe2.beliefReason);
    expect(json).not.toContain('"role"');
    expect(json).not.toContain('"reason"');
    expect(json).not.toContain('suspicions');
    expect(scanSecrets(json)).toEqual([]);

    // 纯函数:同一公开日志必得同一投影(投影不携带任何隐藏可变态)。
    expect(projectEnvelopes('game-x', events, -1)).toEqual(feed);
  });
});

describe('直播剧场 · 配对差分:两局身份不同,剧场投影全等(engine 层)', () => {
  it('两个不同种子的引擎在第 1 轮检查点产出逐拍全等的公开信封(剥离易变 UUID 后)', async () => {
    const engineA = new GameEngine(new FakeGameModel(), mulberry32(1));
    const engineB = new GameEngine(new FakeGameModel(), mulberry32(2));
    const idA = await toRound1VotingCheckpoint(engineA);
    const idB = await toRound1VotingCheckpoint(engineB);

    const feedA = engineA.catchUpEnvelopes(idA, -1);
    const feedB = engineB.catchUpEnvelopes(idB, -1);

    // 逐拍全等:公开剧场流不随隐藏身份 / 词漂移。
    expect(stableFeed(feedA)).toEqual(stableFeed(feedB));
    // 且两条流里都没有任何身份键 / 密词。
    expect(scanSecrets(JSON.stringify([feedA, feedB]))).toEqual([]);

    // 非空断言:把两局各自推进到终局,权威揭晓证明二者身份指派确实不同(否则配对无意义)。
    const finishedA = await driveToFinished(engineA, idA);
    const finishedB = await driveToFinished(engineB, idB);
    expect(secretFingerprint(finishedA)).not.toEqual(secretFingerprint(finishedB));
  });

  it('检查点(尚未投票):votes 为空、无本轮 vote_result —— 未公布票不先行出现', async () => {
    const engine = new GameEngine(new FakeGameModel(), mulberry32(3));
    const id = await toRound1VotingCheckpoint(engine);
    const live = engine.getGame(id);

    expect(live.phase).toBe('voting');
    expect(live.votes).toEqual([]);
    expect(live.events.some((event) => event.type === 'vote_result')).toBe(false);
  });
});

describe('直播剧场 · 私有信念 / 未公布票不进公开流', () => {
  it('信念已被私有地计算并存储,但剧场信封零信念痕迹(差分证明)', async () => {
    const engine = new GameEngine(new FakeGameModel(), mulberry32(7));
    const id = await toRound1VotingCheckpoint(engine);

    // 第 1 轮描述公开后,引擎已为存活 AI 私有地更新信念 —— 确有其物:
    const anyBelief = ['ai-1', 'ai-2', 'ai-3', 'ai-4']
      .map((agentId) => engine.getAgentBelief(id, agentId))
      .find(Boolean);
    expect(anyBelief).toBeDefined();
    expect(anyBelief!.suspicions.length).toBeGreaterThan(0);

    // 然而剧场信封里既无信念键,也无任何自由文本理由。
    const json = JSON.stringify(engine.catchUpEnvelopes(id, -1));
    expect(json).not.toContain('suspicions');
    expect(json).not.toContain('selfExposure');
    expect(json).not.toContain('evidenceRefs');
    expect(json).not.toContain('reason');
    expect(scanSecrets(json)).toEqual([]);
  });

  it('每张进入公开投影的票都已有对应已公布结果:没有「未公布票」抢跑泄漏', async () => {
    const engine = new GameEngine(new FakeGameModel(), mulberry32(8));
    const created = engine.createGame();
    const finished = await driveToFinished(engine, created.id);

    // votes 只在 ballot 原子裁决时一并提交,且同一提交里必落一枚公开结局事件
    // (平票 → vote_result,出局 → elimination)。故 votes 里出现的每一轮,
    // 都能在公开事件里找到该轮的已公布结局;不存在「有票却无结果」的抢跑窗口。
    expect(finished.votes.length).toBeGreaterThan(0);
    for (const vote of finished.votes) {
      const published = finished.events.some(
        (event) =>
          event.round === vote.round &&
          (event.type === 'vote_result' || event.type === 'elimination'),
      );
      expect(published).toBe(true);
    }
  });
});
