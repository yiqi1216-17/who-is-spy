import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, parseVersioned } from '../schema.js';
import {
  SOURCE_POLICY,
  importSource,
  normalizeCkArena,
  normalizeWerewolfGame,
  type ImportOutcome,
} from './normalize.js';

/**
 * 语料归一化 + 隔离(data/README.md 执行路线第 2 步;OpenSpec 03 · tasks 3.1/3.2 拾取)
 *
 * 兑现 human-game-data spec 三条:
 * - 「Record with unknown rights is rejected」→ ctwei-spy 在 importer 处被拒并留 diagnostic;
 * - 「Human and synthetic data remain distinguishable」→ 来源→provenance 是封闭映射表,
 *   类型与运行时双重保证**不存在把 LLM 局标成 human 的路径**;
 * - 「Incompatible record enters the pipeline」→ 坏格式在入库前失败,不产出半条记录。
 */

/** 精简版 CK-Arena 对局日志 fixture(结构与 raw 一致,内容缩到最小)。 */
const CK_ARENA_FIXTURE = {
  game_record: {
    game_id: '20250912-084639',
    timestamp: '2025-09-12T08:46:39.189337',
    topic_category: '2ball',
    concept_pair: { concept_a: 'football', concept_b: 'basketball' },
    judges: [{ id: 'gpt-4.1', version: '' }],
    players: [
      {
        player_id: 1,
        llm_id: 'qwen2.5-72b',
        role: 'civilian',
        assigned_concept: 'football',
        eliminated_in_voting_round: null,
        is_winner: false,
      },
      {
        player_id: 2,
        llm_id: 'gpt-4o',
        role: 'undercover',
        assigned_concept: 'basketball',
        eliminated_in_voting_round: 1,
        is_winner: false,
      },
    ],
    game_process: {
      statements: [
        {
          statement_id: 1,
          player_id: 1,
          llm_id: 'qwen2.5-72b',
          content: 'It is a globally recognized team sport.',
          statement_round: 1,
          metrics: {},
        },
        {
          statement_id: 2,
          player_id: 2,
          llm_id: 'gpt-4o',
          content: 'Players bounce it on a court.',
          statement_round: 1,
          metrics: {},
        },
      ],
      voting_rounds: [
        {
          voting_round_id: 1,
          after_statement_round: 1,
          after_statement_id: 2,
          votes: [
            { voter_id: 1, voted_for: 2 },
            { voter_id: 2, voted_for: 1 },
          ],
          vote_results: { '1': 1, '2': 1 },
          eliminated: [
            { player_id: 2, llm_id: 'gpt-4o', role: 'undercover', correct_elimination: true },
          ],
        },
      ],
    },
    game_summary: {},
    game_analysis: {},
  },
};

describe('corpus/normalize · 来源处置表(隔离面)', () => {
  it('每个登记来源要么给出 transfer/synthetic,要么带理由拒绝——不存在 human 路径', () => {
    const ids = Object.keys(SOURCE_POLICY);
    expect(ids).toEqual(
      expect.arrayContaining(['ck-arena', 'werewolf-among-us', 'ctwei-spy', 'spygame']),
    );
    for (const policy of Object.values(SOURCE_POLICY)) {
      if ('provenance' in policy) {
        // 类型上 provenance 就只有 transfer|synthetic;运行时再断言一次,防未来手滑放宽
        expect(['transfer', 'synthetic']).toContain(policy.provenance);
        expect(policy.license.length).toBeGreaterThan(0); // SPDX 串必填
      } else {
        expect(policy.rejected.length).toBeGreaterThan(0);
      }
    }
  });

  it('ctwei-spy 被拒:unknown-rights diagnostic,零记录产出', () => {
    const outcome = importSource('ctwei-spy', [
      { name: '4player.csv', json: null },
    ]) as ImportOutcome;
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') {
      expect(outcome.reason).toMatch(/unknown-rights/);
      expect(outcome.reason).toMatch(/LICENSE/i);
    }
  });

  it('spygame 被拒:方法论来源不产生对局记录', () => {
    const outcome = importSource('spygame', []);
    expect(outcome.status).toBe('rejected');
  });

  it('未登记来源默认拒绝(安全默认),而不是默认放行', () => {
    const outcome = importSource('some-random-corpus', []);
    expect(outcome.status).toBe('rejected');
    if (outcome.status === 'rejected') expect(outcome.reason).toMatch(/未登记|unregistered/);
  });
});

describe('corpus/normalize · CK-Arena → datasetRecord(synthetic)', () => {
  it('产出通过 parseVersioned 的信封:provenance=synthetic,license=Apache-2.0', () => {
    const env = normalizeCkArena(CK_ARENA_FIXTURE, 'football_basketball_20250912-085512_43344');
    expect(env.v).toBe(SCHEMA_VERSION);
    expect(env.kind).toBe('datasetRecord');
    const record = parseVersioned('datasetRecord', env); // 入库前的消费者校验
    expect(record.provenance).toBe('synthetic');
    expect(record.license).toBe('Apache-2.0');
    expect(record.gameId).toBe('ck-arena:football_basketball_20250912-085512_43344');
  });

  it('玩家匿名化为座位 pseudoId,角色保留;llm_id 不进入任何字段', () => {
    const env = normalizeCkArena(CK_ARENA_FIXTURE, 'stem');
    const record = parseVersioned('datasetRecord', env);
    expect(record.players).toEqual([
      { pseudoId: 'P1', role: 'civilian' },
      { pseudoId: 'P2', role: 'undercover' },
    ]);
    // 最小化:序列化后不残留模型身份(等价于"无个人/设备信息"要求在此来源的形态)
    expect(JSON.stringify(env)).not.toMatch(/qwen2\.5-72b|gpt-4o/);
  });

  it('statements→describe(带轮次与文本),votes→vote(带目标),顺序保持', () => {
    const env = normalizeCkArena(CK_ARENA_FIXTURE, 'stem');
    const record = parseVersioned('datasetRecord', env);
    expect(record.actions).toEqual([
      { round: 1, playerId: 'P1', kind: 'describe', text: 'It is a globally recognized team sport.' },
      { round: 1, playerId: 'P2', kind: 'describe', text: 'Players bounce it on a court.' },
      { round: 1, playerId: 'P1', kind: 'vote', targetId: 'P2' },
      { round: 1, playerId: 'P2', kind: 'vote', targetId: 'P1' },
    ]);
  });

  it('坏格式(缺 players)在入库前失败,不产出半条记录', () => {
    const broken = { game_record: { game_id: 'x', game_process: { statements: [], voting_rounds: [] } } };
    expect(() => normalizeCkArena(broken, 'stem')).toThrow(/players/);
  });

  it('audience/metric 淘汰局(无 voting_rounds)容忍入库为纯 describe 局', () => {
    const gr = CK_ARENA_FIXTURE.game_record;
    const audience = {
      game_record: {
        ...gr,
        game_process: { statements: gr.game_process.statements, audience_decisions: [] },
      },
    };
    const record = parseVersioned('datasetRecord', normalizeCkArena(audience, 'aud'));
    expect(record.actions.every((a) => a.kind === 'describe')).toBe(true);
    expect(record.actions).toHaveLength(2);
  });
});

/** 精简版 Youtube 子集单局 fixture(playerNames/votingOutcome/endRoles 平行数组,0-based 票)。 */
const WEREWOLF_FIXTURE = {
  YT_ID: 'part15',
  video_name: 'ONUW Retro 10',
  Game_ID: 'Game2',
  Dialogue: [
    { Rec_Id: 1, speaker: 'Justin', timestamp: '00:03', utterance: 'I am the Seer.', annotation: ['Identity Declaration'] },
    { Rec_Id: 2, speaker: 'Host', timestamp: '00:05', utterance: 'Please begin.', annotation: ['No Strategy'] },
    { Rec_Id: 3, speaker: 'Laura', timestamp: '00:07', utterance: 'No, you were not.', annotation: ['Defense'] },
  ],
  startTime: '00:10:00',
  endTime: '00:16:27',
  playerNames: ['Justin', 'Laura', 'Paul'],
  votingOutcome: [1, 'N/A', 0], // Laura 弃权;其余 0-based 指认
  startRoles: ['Tanner', 'Troublemaker', 'Werewolf'],
  endRoles: ['Werewolf', 'Troublemaker', 'Tanner'],
  warning: 'N/A',
};

describe('corpus/normalize · Werewolf Among Us → datasetRecord(transfer)', () => {
  it('产出 transfer + Apache-2.0;gameId 由 YT_ID/Game_ID/视频指纹构成(YT_ID 跨系列会碰撞)', () => {
    const record = parseVersioned('datasetRecord', normalizeWerewolfGame(WEREWOLF_FIXTURE));
    expect(record.provenance).toBe('transfer'); // 真实人类局,但非谁是卧底 → 永不标 human
    expect(record.license).toBe('Apache-2.0');
    expect(record.gameId).toMatch(/^werewolf-among-us:part15:Game2:[0-9a-f]{8}$/);
    // 同 YT_ID+Game_ID、不同视频 → 不同 gameId(41 组实测碰撞的解法)
    const other = normalizeWerewolfGame({ ...WEREWOLF_FIXTURE, video_name: 'ONUW Retro 11' });
    expect(parseVersioned('datasetRecord', other).gameId).not.toBe(record.gameId);
  });

  it('endRoles 决定阵营:Werewolf/Minion→undercover,其余(含 Tanner)→civilian;人名不残留', () => {
    const env = normalizeWerewolfGame(WEREWOLF_FIXTURE);
    const record = parseVersioned('datasetRecord', env);
    expect(record.players).toEqual([
      { pseudoId: 'P1', role: 'undercover' },
      { pseudoId: 'P2', role: 'civilian' },
      { pseudoId: 'P3', role: 'civilian' }, // Tanner 并入 civilian 是文档化的已知近似
    ]);
    expect(JSON.stringify(env)).not.toMatch(/Justin|Laura|Paul|Host/);
  });

  it('玩家发言→describe(round 0),非玩家(主持人)发言跳过;弃权票跳过,合法票→vote(round 1)', () => {
    const record = parseVersioned('datasetRecord', normalizeWerewolfGame(WEREWOLF_FIXTURE));
    expect(record.actions).toEqual([
      { round: 0, playerId: 'P1', kind: 'describe', text: 'I am the Seer.' },
      { round: 0, playerId: 'P2', kind: 'describe', text: 'No, you were not.' },
      { round: 1, playerId: 'P1', kind: 'vote', targetId: 'P2' }, // votingOutcome 0-based
      { round: 1, playerId: 'P3', kind: 'vote', targetId: 'P1' },
    ]);
  });

  it('Ego4D 局(无 playerNames/endRoles,无法诚实定角色)在入库前被拒', () => {
    const ego4d = { EG_ID: '3ba069be', Game_ID: 'Game4', Dialogue: [] };
    expect(() => normalizeWerewolfGame(ego4d)).toThrow(/YT_ID|playerNames/);
  });

  it('importSource 批量:好文件入库、坏文件计入 diagnostics,互不污染', () => {
    const outcome = importSource('ck-arena', [
      { name: 'good.json', json: CK_ARENA_FIXTURE },
      { name: 'bad.json', json: { game_record: {} } },
    ]);
    expect(outcome.status).toBe('imported');
    if (outcome.status === 'imported') {
      expect(outcome.records).toHaveLength(1);
      expect(outcome.diagnostics).toHaveLength(1);
      expect(outcome.diagnostics[0]).toMatch(/bad\.json/);
      for (const env of outcome.records) {
        const record = parseVersioned('datasetRecord', env);
        expect(record.provenance).not.toBe('human'); // 红线 2:synthetic 永不洗成 human
      }
    }
  });
});
