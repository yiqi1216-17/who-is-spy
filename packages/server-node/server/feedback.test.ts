import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { deterministicSafeHuman } from './eval/self-play.js';
import {
  FeedbackError,
  FeedbackStore,
  assertDeidentified,
  deidentify,
  feedbackSubmissionSchema,
  resolveReferences,
  summarize,
  todayBucket,
  type DeidentifiedFeedback,
  type FeedbackSubmission,
} from './feedback.js';
import { FakeGameModel } from './test-utils.js';
import type { PublicGameState } from './types.js';

/**
 * 知情、去标识反馈 · 单元 + 端到端(OpenSpec 05-H · 任务 5.5)
 * 钉死:知情闸(未同意零落库)、去标识(gameId/自由文本永不入库)、引用忠实性
 * (最爱 Agent/瞬间必须真实存在)、完整退出路径(不发送即零遥测)、聚合只出计数。
 */

const base: FeedbackSubmission = {
  consent: true,
  gameId: 'game-abc',
  completion: 'completed',
  rematch: 'yes',
  favoriteAgentId: null,
  favoriteMomentId: null,
  share: 'maybe',
  replayIntent: 'yes',
  playtestPreference: 'portrait',
};

describe('feedback schema · 知情闸(consent 必须字面量 true)', () => {
  it('consent 缺失 / false / 非布尔 → 解析失败(结构上无法落库)', () => {
    expect(feedbackSubmissionSchema.safeParse({ ...base, consent: false }).success).toBe(false);
    const { consent: _drop, ...withoutConsent } = base;
    expect(feedbackSubmissionSchema.safeParse(withoutConsent).success).toBe(false);
    expect(feedbackSubmissionSchema.safeParse({ ...base, consent: 'true' }).success).toBe(false);
  });

  it('strict:夹带任何多余字段(如自由文本)一律拒绝', () => {
    const smuggled = { ...base, freeText: '我叫张三，手机号 138…' };
    expect(feedbackSubmissionSchema.safeParse(smuggled).success).toBe(false);
  });

  it('合法提交(含 null 最爱)通过', () => {
    expect(feedbackSubmissionSchema.safeParse(base).success).toBe(true);
  });
});

describe('resolveReferences · 引用忠实性', () => {
  const references = {
    agentIds: ['ai-1', 'ai-2', 'ai-3', 'ai-4'],
    moments: [{ id: 'lone_correct_read-12', type: 'lone_correct_read' as const }],
  };

  it('真实 Agent + 真实瞬间 → 解析出 id 与类型', () => {
    const resolved = resolveReferences(
      { ...base, favoriteAgentId: 'ai-2', favoriteMomentId: 'lone_correct_read-12' },
      references,
    );
    expect(resolved.favoriteAgentId).toBe('ai-2');
    expect(resolved.favoriteMomentType).toBe('lone_correct_read');
  });

  it('null 最爱 → 解析为 null(可以不选)', () => {
    const resolved = resolveReferences(base, references);
    expect(resolved).toEqual({ favoriteAgentId: null, favoriteMomentType: null });
  });

  it('不存在的 Agent / 瞬间 → FeedbackError(不能点赞没发生过的东西)', () => {
    expect(() => resolveReferences({ ...base, favoriteAgentId: 'ai-9' }, references)).toThrow(
      FeedbackError,
    );
    expect(() => resolveReferences({ ...base, favoriteMomentId: 'nope-1' }, references)).toThrow(
      FeedbackError,
    );
  });
});

describe('deidentify / assertDeidentified · 去标识', () => {
  it('落库记录**不含** gameId,只留天桶 + 枚举 + 稳定原型', () => {
    const record = deidentify(
      { ...base, favoriteAgentId: 'ai-1' },
      { favoriteAgentId: 'ai-1', favoriteMomentType: 'callback' },
      '2026-08-19',
    );
    const json = JSON.stringify(record);
    expect(json).not.toContain('game-abc');
    expect(json).not.toContain('gameId');
    expect(record.dayBucket).toBe('2026-08-19');
    expect(record.favoriteAgentId).toBe('ai-1');
    expect(record.favoriteMomentType).toBe('callback');
  });

  it('天桶粗到「天」:无小时/分钟(难以据此重标识)', () => {
    expect(todayBucket(new Date('2026-08-19T13:45:07.123Z'))).toBe('2026-08-19');
  });

  it('assertDeidentified 挡住非白名单键(重构护栏)', () => {
    const tainted = { ...base, dayBucket: '2026-08-19' } as unknown as DeidentifiedFeedback;
    expect(() => assertDeidentified(tainted)).toThrow(FeedbackError);
  });
});

describe('summarize / FeedbackStore · 只出聚合,不出逐条', () => {
  it('聚合计数正确;store 只暴露 summary/size,无逐条读取出口', () => {
    const store = new FeedbackStore();
    const mk = (over: Partial<DeidentifiedFeedback>): DeidentifiedFeedback => ({
      dayBucket: '2026-08-19',
      completion: 'completed',
      rematch: 'yes',
      favoriteAgentId: null,
      favoriteMomentType: null,
      share: 'no',
      replayIntent: 'maybe',
      playtestPreference: 'portrait',
      ...over,
    });
    store.record(mk({ favoriteAgentId: 'ai-1', favoriteMomentType: 'self_save' }));
    store.record(mk({ favoriteAgentId: 'ai-1', rematch: 'no', playtestPreference: 'b0' }));

    const summary = store.summary();
    expect(summary.total).toBe(2);
    expect(summary.favoriteAgent['ai-1']).toBe(2);
    expect(summary.rematch).toEqual({ yes: 1, no: 1 });
    expect(summary.playtestPreference).toEqual({ portrait: 1, b0: 1 });
    expect(summary.favoriteMoment).toEqual({ self_save: 1 });
    // 存储不提供逐条读取:表面只有 summary/size/record。
    expect(Object.keys(Object.getPrototypeOf(store))).not.toContain('records');
  });

  it('summarize 纯函数:空输入 → 全零', () => {
    expect(summarize([])).toEqual({
      total: 0,
      completion: {},
      rematch: {},
      share: {},
      replayIntent: {},
      playtestPreference: {},
      favoriteAgent: {},
      favoriteMoment: {},
    });
  });
});

// —— 端到端 ——

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
  return state;
}

describe('反馈端点 · 端到端', () => {
  it('未同意提交 → 400,且聚合零落库(完整退出路径的服务端护栏)', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    await request(app)
      .post('/api/feedback')
      .send({ ...base, consent: false, gameId: created.body.id })
      .expect(400);
    const summary = await request(app).get('/api/feedback/summary').expect(200);
    expect(summary.body.total).toBe(0);
  });

  it('从不提交(选择「不用了」)→ 聚合恒为 0(不发送即零遥测)', async () => {
    const { app } = createApp(new FakeGameModel());
    await request(app).post('/api/games').expect(201);
    const summary = await request(app).get('/api/feedback/summary').expect(200);
    expect(summary.body.total).toBe(0);
  });

  it('知情提交:201 recorded,聚合反映计数,且响应里不出现 gameId', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    const finished = await driveToFinished(app, created.body.id, created.body);
    expect(finished.phase).toBe('finished');

    // 若本局确有高光卡,取一张真实卡片 id 做「最爱瞬间」;否则留 null(仍合法)。
    const highlights = await request(app).get(`/api/games/${created.body.id}/highlights`).expect(200);
    const favoriteMomentId: string | null = highlights.body.cards[0]?.id ?? null;

    const submit = await request(app)
      .post('/api/feedback')
      .send({ ...base, gameId: created.body.id, favoriteAgentId: 'ai-1', favoriteMomentId })
      .expect(201);
    expect(submit.body).toEqual({ recorded: true });

    const summary = await request(app).get('/api/feedback/summary').expect(200);
    expect(summary.body.total).toBe(1);
    expect(summary.body.favoriteAgent['ai-1']).toBe(1);
    expect(summary.body.playtestPreference.portrait).toBe(1);
    // 去标识:聚合快照里绝无 gameId。
    expect(JSON.stringify(summary.body)).not.toContain(created.body.id);
  });

  it('最爱 Agent / 瞬间越界 → 400(引用忠实性)', async () => {
    const { app } = createApp(new FakeGameModel());
    const created = await request(app).post('/api/games').expect(201);
    await driveToFinished(app, created.body.id, created.body);

    await request(app)
      .post('/api/feedback')
      .send({ ...base, gameId: created.body.id, favoriteAgentId: 'human' }) // 人类不是 AI 席位
      .expect(400);
    await request(app)
      .post('/api/feedback')
      .send({ ...base, gameId: created.body.id, favoriteMomentId: 'fabricated-1' })
      .expect(400);
  });

  it('未知对局 → 404', async () => {
    const { app } = createApp(new FakeGameModel());
    await request(app)
      .post('/api/feedback')
      .send({ ...base, gameId: 'does-not-exist' })
      .expect(404);
  });
});
