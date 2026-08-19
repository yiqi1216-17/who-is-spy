import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { deterministicSafeHuman } from './eval/self-play.js';
import { scanSecrets } from './redaction.js';
import { FakeGameModel } from './test-utils.js';
import type { PublicGameState } from './types.js';

/**
 * 高光端点 · 端到端(OpenSpec 05-H · 任务 5.2/5.4)
 * 钉死:终局门禁(未终局 available:false)、默认剧透安全(结构上无 role/word、密词零泄漏)、
 * 以及 spoilers 开关只在终局路径附出剧透层。走冻结契约之外的附加端点,不触碰既有命令。
 */

async function driveToFinished(app: ReturnType<typeof createApp>['app'], id: string, seed: PublicGameState) {
  let state = seed;
  let guard = 0;
  while (state.phase !== 'finished' && guard < 64) {
    guard += 1;
    const human = state.players.find((player) => player.isHuman);
    if (human && !human.alive) {
      state = (await request(app).post(`/api/games/${id}/continue`).expect(200)).body;
      continue;
    }
    if (state.phase === 'describing') {
      state = (
        await request(app)
          .post(`/api/games/${id}/describe`)
          .send({ text: deterministicSafeHuman.describe(state, state.round) })
          .expect(200)
      ).body;
    } else {
      state = (
        await request(app)
          .post(`/api/games/${id}/vote`)
          .send({ targetId: deterministicSafeHuman.vote(state) })
          .expect(200)
      ).body;
    }
  }
  expect(state.phase).toBe('finished');
  return state;
}

describe('高光端点 · 终局门禁 + 剧透安全', () => {
  it('未终局:available=false,cards 为空(终局前不解锁任何时刻)', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const highlights = await request(app).get(`/api/games/${created.body.id}/highlights`).expect(200);
    expect(highlights.body.available).toBe(false);
    expect(highlights.body.cards).toEqual([]);
  });

  it('终局默认:available=true,结构上无 role/word,密词与身份零泄漏', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const finished = await driveToFinished(app, created.body.id, created.body);

    const highlights = await request(app).get(`/api/games/${created.body.id}/highlights`).expect(200);
    expect(highlights.body.available).toBe(true);
    expect(Array.isArray(highlights.body.cards)).toBe(true);

    const serialized = JSON.stringify(highlights.body.cards);
    expect(serialized).not.toContain('"role"');
    expect(serialized).not.toContain('"word"');
    expect(serialized).not.toContain('"spoiler"');
    expect(serialized).not.toContain(finished.human.word);
    for (const player of finished.players as Array<{ revealedWord?: string }>) {
      if (player.revealedWord) expect(serialized).not.toContain(player.revealedWord);
    }
    expect(scanSecrets(serialized)).toEqual([]);
  });

  it('spoilers=1:仍 available=true;若有卡携剧透层,则该层可含身份线索', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    await driveToFinished(app, created.body.id, created.body);

    const spoiled = await request(app)
      .get(`/api/games/${created.body.id}/highlights`)
      .query({ spoilers: '1' })
      .expect(200);
    expect(spoiled.body.available).toBe(true);
    // 默认层永不含 spoiler 键;开关打开后,承载剧透的卡片才可能出现 spoiler。
    const plain = await request(app).get(`/api/games/${created.body.id}/highlights`).expect(200);
    expect(JSON.stringify(plain.body.cards)).not.toContain('"spoiler"');
  });

  it('未知对局 → 404', async () => {
    const { app } = createApp(new FakeGameModel());
    await request(app).get('/api/games/does-not-exist/highlights').expect(404);
  });
});
