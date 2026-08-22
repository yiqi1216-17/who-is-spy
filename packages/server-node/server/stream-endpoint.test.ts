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

describe('预告帧 · 引擎逐句直播(体验修复:异步发言感)', () => {
  it('describe 命令期间:每条 AI 描述产出即广播预告帧,顺序与座次一致且先于命令返回', async () => {
    const { engine } = createApp(new FakeGameModel());
    const created = engine.createGame();

    const previews: Array<{ playerId: string; text: string; atCommandDone: boolean }> = [];
    let commandDone = false;
    const off = engine.onPreviews(created.id, (frame) => {
      previews.push({ playerId: frame.playerId, text: frame.text, atCommandDone: commandDone });
    });
    const next = await engine.submitHumanDescription(
      created.id,
      deterministicSafeHuman.describe(created, 1),
    );
    commandDone = true;
    off();

    // 四条 AI 预告,座次顺序,全部发生在命令返回**之前**(异步发言感的实质)。
    expect(previews.map((p) => p.playerId)).toEqual(['ai-1', 'ai-2', 'ai-3', 'ai-4']);
    expect(previews.every((p) => !p.atCommandDone)).toBe(true);
    // 预告文本与最终权威描述逐条一致(过同一质量门,先播不改权威)。
    for (const preview of previews) {
      expect(
        next.descriptions.some((d) => d.playerId === preview.playerId && d.text === preview.text),
      ).toBe(true);
    }
    // 隐私:预告帧序列化后扫不出任何密词。
    expect(scanSecrets(JSON.stringify(previews))).toEqual([]);
  });

  it('vote 命令期间:每张 AI 票产出即广播 vote 预告帧(带 targetId/理由),先于命令返回且不泄密', async () => {
    const { engine } = createApp(new FakeGameModel());
    const created = engine.createGame();
    // 先由人类描述推进到投票相位。
    const afterDescribe = await engine.submitHumanDescription(
      created.id,
      deterministicSafeHuman.describe(created, 1),
    );

    const votePreviews: Array<{ playerId: string; targetId?: string; text: string; atDone: boolean }> = [];
    let commandDone = false;
    const off = engine.onPreviews(created.id, (frame) => {
      if (frame.kind !== 'vote') return; // 本用例只看投票预告
      votePreviews.push({
        playerId: frame.playerId,
        targetId: frame.targetId,
        text: frame.text,
        atDone: commandDone,
      });
    });
    const next = await engine.submitHumanVote(
      created.id,
      deterministicSafeHuman.vote(afterDescribe),
    );
    commandDone = true;
    off();

    // 四席 AI 逐票直播(人类另占一席),座次顺序,全部先于命令返回。
    expect(votePreviews.map((p) => p.playerId)).toEqual(['ai-1', 'ai-2', 'ai-3', 'ai-4']);
    expect(votePreviews.every((p) => !p.atDone)).toBe(true);
    // 每帧都带合法的被投席位 id 与非空理由(公开字段)。
    for (const preview of votePreviews) {
      expect(preview.targetId && preview.targetId.length > 0).toBe(true);
      expect(preview.text.length).toBeGreaterThan(0);
    }
    // 权威票型里能逐条对上(先播不改权威裁决)。
    for (const preview of votePreviews) {
      expect(
        next.votes.some((v) => v.voterId === preview.playerId && v.targetId === preview.targetId),
      ).toBe(true);
    }
    // 隐私:vote 预告序列化后扫不出任何密词。
    expect(scanSecrets(JSON.stringify(votePreviews))).toEqual([]);
  });

  it('未知对局订阅预告 → 404 语义;退订后不再收到', async () => {
    const { engine } = createApp(new FakeGameModel());
    expect(() => engine.onPreviews('does-not-exist', () => {})).toThrow(/不存在|过期/);

    const created = engine.createGame();
    const seen: string[] = [];
    const off = engine.onPreviews(created.id, (frame) => seen.push(frame.playerId));
    off();
    await engine.submitHumanDescription(created.id, deterministicSafeHuman.describe(created, 1));
    expect(seen).toEqual([]);
  });

  it('SSE 端点:活跃流在生成期间下发 preview 帧(无 id 行),与事件帧并存', async () => {
    const { app, engine } = createApp(new FakeGameModel());
    const created = engine.createGame();

    // 真实监听 + 流式读取:命令进行期间边生成边下发 preview 帧,命令后事件帧跟上。
    const server = app.listen(0);
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const response = await fetch(`http://127.0.0.1:${port}/api/games/${created.id}/stream`);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const pump = (async () => {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
        }
      })();

      await engine.submitHumanDescription(created.id, deterministicSafeHuman.describe(created, 1));
      // 给事件循环一拍冲刷分帧,然后收流。
      await new Promise((resolve) => setTimeout(resolve, 120));
      await reader.cancel().catch(() => {});
      await pump.catch(() => {});

      const frames = buffer.split('\n\n').filter(Boolean);
      const previewFrames = frames.filter((f) => f.startsWith('event: preview'));
      expect(previewFrames.length).toBe(4); // 四条 AI 逐句直播
      expect(previewFrames.every((f) => !f.includes('id:'))).toBe(true); // 不参与 Last-Event-ID
      expect(frames.some((f) => f.startsWith('id: '))).toBe(true); // 权威事件帧并存
      expect(scanSecrets(buffer)).toEqual([]);
    } finally {
      server.close();
    }
  });
});
