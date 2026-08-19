import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { deterministicSafeHuman } from './eval/self-play.js';
import { scanSecrets } from './redaction.js';
import { STREAM_VERSION, type StreamEnvelope } from './stream.js';
import { FakeGameModel } from './test-utils.js';
import type { PublicGameState } from './types.js';

/**
 * 公开事件流 · 端到端(OpenSpec 05-H · 任务 4.1)
 * 钉死:提交后广播(choke point 覆盖全部写路径)、追平/重连补发、有界终局流、
 * Last-Event-ID 续传、以及「信封只含公开 GameEvent、绝不泄 role/word/密词」。
 */

/** 把 SSE 响应体拆成逐事件信封(只取带 id 的 `event: event` 帧)。 */
function parseEnvelopes(body: string): StreamEnvelope[] {
  return body
    .split('\n\n')
    .filter((frame) => frame.startsWith('id: '))
    .map((frame) => {
      const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))!;
      return JSON.parse(dataLine.slice('data: '.length)) as StreamEnvelope;
    });
}

/** 经 HTTP 把一局驱动到终局(镜像 playSelfPlayGame,但走冻结契约命令端点)。 */
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

describe('公开事件流 · 提交后广播(engine 层,确定性)', () => {
  it('describe 提交后只广播本轮新增公开事件,seq 单调续接创世事件', async () => {
    const { engine } = createApp(new FakeGameModel());
    const created = engine.createGame(); // 创世:1 条 system 事件(seq 0)

    const received: StreamEnvelope[] = [];
    const off = engine.onGameEvents(created.id, (envelopes) => received.push(...envelopes));
    await engine.submitHumanDescription(created.id, deterministicSafeHuman.describe(created, 1));
    off();

    // 人类 + 四 AI 五条描述 + 一条「投票开始」system = 6 条新增,seq 从 1 起(创世 seq 0 不重播)。
    expect(received.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(received.every((e) => e.v === STREAM_VERSION && e.gameId === created.id)).toBe(true);
    // 结构性无泄漏:信封与其内嵌事件都不含 role/word 键。
    for (const envelope of received) {
      expect(envelope.event).not.toHaveProperty('role');
      expect(envelope.event).not.toHaveProperty('word');
    }
    expect(scanSecrets(JSON.stringify(received))).toEqual([]);
  });

  it('catchUp:首连全量与重连补发的 seq 均与事件下标一致', async () => {
    const { engine } = createApp(new FakeGameModel());
    const created = engine.createGame();
    await engine.submitHumanDescription(created.id, deterministicSafeHuman.describe(created, 1));

    const all = engine.catchUpEnvelopes(created.id, -1);
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const resumed = engine.catchUpEnvelopes(created.id, 3);
    expect(resumed.map((e) => e.seq)).toEqual([4, 5, 6]);
    // 退订后无残留订阅者(无长跑泄漏)。
    const off = engine.onGameEvents(created.id, () => {});
    off();
  });

  it('未知对局订阅 → 404 语义(与其余读端点一致)', () => {
    const { engine } = createApp(new FakeGameModel());
    expect(() => engine.onGameEvents('does-not-exist', () => {})).toThrow(/不存在|过期/);
  });
});

describe('公开事件流 · HTTP SSE(有界终局流 + 续传)', () => {
  it('终局流:补发整条公开日志 + end 帧,单调 id,零密词泄漏', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const finished = await driveToFinished(app, created.body.id, created.body);

    const streamed = await request(app).get(`/api/games/${created.body.id}/stream`).expect(200);
    expect(streamed.headers['content-type']).toContain('text/event-stream');

    const envelopes = parseEnvelopes(streamed.text);
    // 逐事件信封数 == 公开事件总数;id 单调递增且从 0 起。
    expect(envelopes).toHaveLength(finished.events.length);
    expect(envelopes.map((e) => e.seq)).toEqual(finished.events.map((_, index) => index));
    // 终局控制帧到达,winner 公开于此帧。
    expect(streamed.text).toContain('event: end');
    expect(streamed.text).toContain('"phase":"finished"');

    // 剧透安全:即便终局,事件流也绝不含身份/密词。人类密词与任一 revealedWord 均不出现在流体里。
    expect(streamed.text).not.toContain(finished.human.word);
    for (const player of finished.players as Array<{ revealedWord?: string }>) {
      if (player.revealedWord) expect(streamed.text).not.toContain(player.revealedWord);
    }
    expect(streamed.text).not.toContain('"role"');
    expect(streamed.text).not.toContain('"word"');
    expect(scanSecrets(streamed.text)).toEqual([]);
  });

  it('Last-Event-ID 续传:只补发更晚的信封,不回放已见拍', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const finished = await driveToFinished(app, created.body.id, created.body);
    expect(finished.events.length).toBeGreaterThan(4);

    const resumed = await request(app)
      .get(`/api/games/${created.body.id}/stream`)
      .set('Last-Event-ID', '2')
      .expect(200);

    const envelopes = parseEnvelopes(resumed.text);
    expect(envelopes[0].seq).toBe(3); // 从断点之后续起
    expect(envelopes.every((e) => e.seq > 2)).toBe(true);
    expect(resumed.text).not.toContain('id: 0\n');
    expect(resumed.text).toContain('event: end');
  });

  it('未知对局的流端点 → 404', async () => {
    const { app } = createApp(new FakeGameModel());
    await request(app).get('/api/games/does-not-exist/stream').expect(404);
  });
});
