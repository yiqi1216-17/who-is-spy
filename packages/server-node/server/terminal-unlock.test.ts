import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { deterministicSafeHuman } from './eval/self-play.js';
import { scanSecrets } from './redaction.js';
import { FakeGameModel } from './test-utils.js';
import type { PublicGameState } from './types.js';

/**
 * 终局解锁边界 · 端到端(OpenSpec 05-H · 任务 5.2)
 *
 * 把「只有权威终局揭晓后才解锁」这条契约串成一处可读的证明:
 *  - 赛前:身份 / 密词 / 信念 / 证据链 / 高光,一律锁死(投影里结构上不存在)。
 *  - 终局默认:身份 / 密词解锁于 getGame;高光可见且**每张都带证据链**(citedEventIds),
 *    但默认层绝无 role / word / 信念 / spoiler。
 *  - 终局 + 剧透:结构化信念演化与身份线索才解锁,且**始终**无自由文本思维链
 *    (无 thought / monologue / chainOfThought,信念增量只有分数,不含 text/reason)。
 *  - 跨面:冻结契约的 /api/games 各读端点永不出现上帝内心 OS 键(thoughts / monologue)。
 *
 * 单元层已在 highlights.test.ts 钉死「spoiler 结构化信念增量无 CoT」;此处补端到端边界。
 */

async function driveToFinished(
  app: ReturnType<typeof createApp>['app'],
  id: string,
  seed: PublicGameState,
): Promise<PublicGameState> {
  let state = seed;
  let guard = 0;
  while (state.phase !== 'finished' && guard < 64) {
    guard += 1;
    const human = state.players.find((player) => player.isHuman);
    if (human && !human.alive) {
      state = (await request(app).post(`/api/games/${id}/continue`).expect(200)).body;
      continue;
    }
    state =
      state.phase === 'describing'
        ? (
            await request(app)
              .post(`/api/games/${id}/describe`)
              .send({ text: deterministicSafeHuman.describe(state, state.round) })
              .expect(200)
          ).body
        : (
            await request(app)
              .post(`/api/games/${id}/vote`)
              .send({ targetId: deterministicSafeHuman.vote(state) })
              .expect(200)
          ).body;
  }
  expect(state.phase).toBe('finished');
  return state;
}

/** 任何冻结契约读投影都不该出现的「自由文本思维链」痕迹键。 */
const COT_MARKERS = ['thoughts', 'monologue', 'inner_monologue', 'chainOfThought', 'reasoning'];

describe('终局解锁边界 · 赛前全锁', () => {
  it('赛前:无 revealed*、高光 available=false(身份/密词/证据链皆不可得)', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const state = created.body as PublicGameState;

    for (const player of state.players) {
      expect(player).not.toHaveProperty('revealedRole');
      expect(player).not.toHaveProperty('revealedWord');
      expect(player).not.toHaveProperty('role');
      expect(player).not.toHaveProperty('word');
    }
    const highlights = await request(app).get(`/api/games/${state.id}/highlights`).expect(200);
    expect(highlights.body.available).toBe(false);
    expect(highlights.body.cards).toEqual([]);
  });
});

describe('终局解锁边界 · 终局默认层(解身份/密词 + 证据链,但无剧透)', () => {
  it('身份/密词解锁于 getGame;每张高光都带证据链;默认层无 role/word/信念/spoiler', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const finished = await driveToFinished(app, created.body.id, created.body);

    // 身份/密词:终局解锁。
    expect(finished.players.every((player) => player.revealedRole)).toBe(true);
    expect(finished.players.every((player) => player.revealedWord)).toBe(true);

    const highlights = await request(app).get(`/api/games/${finished.id}/highlights`).expect(200);
    expect(highlights.body.available).toBe(true);

    // 证据链:每张卡都至少援引一个真实公开事件 id(标题—证据可追溯)。
    const cards = highlights.body.cards as Array<{ citedEventIds: string[] }>;
    const publicEventIds = new Set(finished.events.map((event) => event.id));
    for (const card of cards) {
      expect(card.citedEventIds.length).toBeGreaterThan(0);
      for (const eid of card.citedEventIds) expect(publicEventIds.has(eid)).toBe(true);
    }

    // 默认层剧透安全:无 spoiler / 身份 / 密词 / 信念结构 / 上帝 OS 痕迹,且扫不出密词。
    const serialized = JSON.stringify(cards);
    for (const key of ['"spoiler"', '"role"', '"word"', 'suspicions', 'selfExposure', 'evidenceRefs']) {
      expect(serialized).not.toContain(key);
    }
    for (const marker of COT_MARKERS) expect(serialized).not.toContain(marker);
    expect(serialized).not.toContain(finished.human.word);
    expect(scanSecrets(serialized)).toEqual([]);
  });
});

describe('终局解锁边界 · 终局剧透层(结构化信念,永不自由文本 CoT)', () => {
  it('spoilers=1 才解锁身份/信念线索;信念增量只有分数,且全程无思维链键', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const finished = await driveToFinished(app, created.body.id, created.body);

    const spoiled = await request(app)
      .get(`/api/games/${finished.id}/highlights`)
      .query({ spoilers: '1' })
      .expect(200);
    expect(spoiled.body.available).toBe(true);

    // 即便是剧透层,也绝不出现自由文本思维链键;若携信念增量,则只有结构化分数字段。
    const spoiledJson = JSON.stringify(spoiled.body.cards);
    for (const marker of COT_MARKERS) expect(spoiledJson).not.toContain(marker);

    type Delta = { agentId: string; targetId: string; before: number; after: number };
    const deltas = (spoiled.body.cards as Array<{ spoiler?: { beliefDeltas?: Delta[] } }>)
      .flatMap((card) => card.spoiler?.beliefDeltas ?? []);
    for (const delta of deltas) {
      // 结构化:恰四个键,值为玩家 id 与有限分数;无任何自由文本。
      expect(Object.keys(delta).sort()).toEqual(['after', 'agentId', 'before', 'targetId']);
      expect(Number.isFinite(delta.before)).toBe(true);
      expect(Number.isFinite(delta.after)).toBe(true);
    }
    expect(JSON.stringify(deltas)).not.toMatch(/text|reason|thought/i);
  });
});

describe('终局解锁边界 · 冻结契约读端点永不泄上帝内心 OS', () => {
  it('getGame(终局) 与 公开事件流 均无 thoughts/monologue 键', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const finished = await driveToFinished(app, created.body.id, created.body);

    const liveJson = JSON.stringify(finished);
    const streamText = (await request(app).get(`/api/games/${finished.id}/stream`).expect(200)).text;
    for (const marker of COT_MARKERS) {
      expect(liveJson).not.toContain(marker);
      expect(streamText).not.toContain(marker);
    }
  });
});
