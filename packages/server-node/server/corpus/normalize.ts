import { envelope, type Versioned } from '../schema.js';
import { safeDigest } from '../redaction.js';

/**
 * 语料归一化 + 隔离(data/README.md 执行路线第 2 步;OpenSpec 03 · tasks 3.1/3.2 拾取)
 *
 * 唯一的来源→处置映射表在此。设计不变量:
 * - `provenance` 的类型是 `'transfer' | 'synthetic'`——**编译期就不存在**把外部语料
 *   标成 `human` 的写法;直接 human 证据只能来自未来的一方自采管线(tasks 3.4)。
 * - 未登记来源**默认拒绝**(安全默认),拒绝携带可执行 diagnostic 而非静默跳过。
 * - 归一化目标是已冻结的 `datasetRecord` schema;所有产出以 { v, kind, data } 信封
 *   落盘,消费者用 parseVersioned 校验(spec「Dataset records are schema-validated」)。
 * - 匿名化:玩家一律座位化为 P<n>;模型身份(llm_id)等非必要信息不进入任何字段
 *   (spec「Personal data is minimized」在 LLM 局来源上的形态)。
 */

type AcceptPolicy = { provenance: 'transfer' | 'synthetic'; license: string };
type RejectPolicy = { rejected: string };

/** 来源处置表(与 data/sources.yaml 一一对应;改这里须同步 manifest 并提版本)。 */
export const SOURCE_POLICY: Record<string, AcceptPolicy | RejectPolicy> = {
  'ck-arena': { provenance: 'synthetic', license: 'Apache-2.0' },
  'werewolf-among-us': { provenance: 'transfer', license: 'Apache-2.0' },
  'ctwei-spy': {
    rejected:
      'unknown-rights:上游仓库无 LICENSE(默认保留所有权利),按 spec「Record with unknown rights is rejected」隔离于 raw/,不入库、不再分发',
  },
  spygame: {
    rejected: 'no-game-records:GPL-3.0 方法论来源(消偏/ToM 设计输入),不产生对局记录',
  },
};

type RawFile = { name: string; json: unknown };

export type ImportOutcome =
  | {
      status: 'imported';
      source: string;
      records: Versioned<'datasetRecord'>[];
      diagnostics: string[]; // 坏文件逐条记录,好坏互不污染
    }
  | { status: 'rejected'; source: string; reason: string };

/** 断言取数:路径缺失/类型不符时抛出带路径的可执行错误(入库前失败,不产半条记录)。 */
function need<T>(value: unknown, path: string): T {
  if (value === undefined || value === null) {
    throw new Error(`归一化失败:缺少必要字段 ${path}`);
  }
  return value as T;
}

/** CK-Arena 对局日志 → datasetRecord 信封(provenance=synthetic)。 */
export function normalizeCkArena(raw: unknown, fileStem: string): Versioned<'datasetRecord'> {
  const record = need<Record<string, unknown>>(
    (raw as Record<string, unknown> | null)?.game_record,
    'game_record',
  );
  const players = need<Array<Record<string, unknown>>>(record.players, 'game_record.players');
  const process = need<Record<string, unknown>>(record.game_process, 'game_record.game_process');
  const statements = need<Array<Record<string, unknown>>>(
    process.statements,
    'game_record.game_process.statements',
  );
  // audience/metric 淘汰模式(audience_decisions / metric_eliminations)没有玩家投票,
  // 描述仍是合法语料 → voting_rounds 容忍缺失,入库为纯 describe 局
  const votingRounds = (process.voting_rounds ?? []) as Array<Record<string, unknown>>;

  const seat = (id: unknown): string => `P${need<number>(id, 'player_id')}`;

  const actions = [
    ...statements.map((s) => ({
      round: need<number>(s.statement_round, 'statement.statement_round'),
      playerId: seat(s.player_id),
      kind: 'describe' as const,
      text: need<string>(s.content, 'statement.content'),
    })),
    ...votingRounds.flatMap((vr) => {
      const round = need<number>(vr.voting_round_id, 'voting_round.voting_round_id');
      const votes = need<Array<Record<string, unknown>>>(vr.votes, 'voting_round.votes');
      return votes.map((v) => ({
        round,
        playerId: seat(v.voter_id),
        kind: 'vote' as const,
        targetId: seat(v.voted_for),
      }));
    }),
  ];

  // describe 按 statement 顺序、vote 按投票轮次追加——重放顺序与原局一致
  actions.sort((a, b) => a.round - b.round || 0);

  const policy = SOURCE_POLICY['ck-arena'] as AcceptPolicy;
  return envelope('datasetRecord', {
    gameId: `ck-arena:${fileStem}`,
    provenance: policy.provenance,
    players: players.map((p) => ({
      pseudoId: seat(p.player_id),
      role: need<'civilian' | 'undercover'>(p.role, 'player.role'),
    })),
    actions,
    license: policy.license,
  });
}

/**
 * Werewolf Among Us(Youtube 子集,单局对象)→ datasetRecord 信封(provenance=transfer)。
 *
 * 上游格式(2026-08-19 对 151 局实测):playerNames / votingOutcome / startRoles / endRoles
 * 为平行数组;votingOutcome[i] 是玩家 i 投给的玩家 **0-based** 序号('N/A' = 弃权);
 * Dialogue[].annotation(句级说服策略标注)是策略抽取(执行路线第 4 步)的资产,
 * strict 的 datasetRecord 不承载它——标注留在 raw/,抽取时直读,证据层与分析层分离。
 *
 * 角色映射(仅为复用统一 schema 做策略分类学统计,绝不作直接谁是卧底证据):
 * 狼阵营 Werewolf/Minion → undercover;其余(Villager/Seer/… 及第三方 Tanner)→ civilian。
 * Tanner(求死者)并入 civilian 是**已知近似**;需要精细阵营时请直读 raw 的 endRoles。
 *
 * Ego4D 子集无 playerNames/endRoles(无法诚实定角色),不经此归一化——它的标注同样
 * 从 raw/ 直读。人名仅用于建座位索引,归一化产物中不残留(匿名化要求)。
 */
/**
 * Youtube 子集单局 → 全局唯一 gameId(单一事实源:normalize 与策略抽取共用)。
 * YT_ID 只在视频系列内唯一(实测 41 组跨系列碰撞),须并入 video_name 指纹。
 */
export function werewolfGameId(raw: unknown): string {
  const game = raw as Record<string, unknown>;
  const ytId = need<string>(game.YT_ID, 'YT_ID');
  const gameNo = need<string>(game.Game_ID, 'Game_ID');
  const videoTag = safeDigest(need<string>(game.video_name, 'video_name')).hash;
  return `werewolf-among-us:${ytId}:${gameNo}:${videoTag}`;
}

export function normalizeWerewolfGame(raw: unknown): Versioned<'datasetRecord'> {
  const game = raw as Record<string, unknown>;
  const gameId = werewolfGameId(raw);
  const playerNames = need<string[]>(game.playerNames, 'playerNames');
  const dialogues = need<Array<Record<string, unknown>>>(game.Dialogue, 'Dialogue');
  const endRoles = need<string[]>(game.endRoles ?? game.startRoles, 'endRoles|startRoles');
  if (playerNames.length === 0) throw new Error('归一化失败:playerNames 为空');

  const seat = (index: number): string => `P${index + 1}`;
  const seatOfName = new Map(playerNames.map((name, i) => [name, seat(i)]));

  type Action =
    | { round: number; playerId: string; kind: 'describe'; text: string }
    | { round: number; playerId: string; kind: 'vote'; targetId: string };
  const actions: Action[] = [];

  // 讨论期 → describe(round 0);主持人/旁观等非玩家发言不构成玩家行为证据,跳过
  for (const d of dialogues) {
    const speaker = need<string>(d.speaker, 'Dialogue[].speaker');
    const playerId = seatOfName.get(speaker);
    if (!playerId) continue;
    actions.push({
      round: 0,
      playerId,
      kind: 'describe',
      text: need<string>(d.utterance, 'Dialogue[].utterance'),
    });
  }

  // 终局同时指认 → vote(round 1);'N/A'(弃权)与越界值跳过,不猜测
  const votingOutcome = (game.votingOutcome ?? []) as unknown[];
  votingOutcome.forEach((target, voter) => {
    if (typeof target !== 'number' || !Number.isInteger(target)) return;
    if (voter >= playerNames.length || target < 0 || target >= playerNames.length) return;
    actions.push({ round: 1, playerId: seat(voter), kind: 'vote', targetId: seat(target) });
  });

  const policy = SOURCE_POLICY['werewolf-among-us'] as AcceptPolicy;
  return envelope('datasetRecord', {
    gameId,
    provenance: policy.provenance,
    players: playerNames.map((_, i) => ({
      pseudoId: seat(i),
      role: /werewolf|wolf|minion/i.test(endRoles[i] ?? '')
        ? ('undercover' as const)
        : ('civilian' as const),
    })),
    actions,
    license: policy.license,
  });
}

const NORMALIZERS: Record<string, (raw: unknown, stem: string) => Versioned<'datasetRecord'>> = {
  'ck-arena': normalizeCkArena,
  'werewolf-among-us': (raw) => normalizeWerewolfGame(raw),
};

/** 批量导入一个来源:接受→逐文件归一化(坏文件计 diagnostics);拒绝→带理由整体拒绝。 */
export function importSource(source: string, files: RawFile[]): ImportOutcome {
  const policy = SOURCE_POLICY[source];
  if (!policy) {
    return { status: 'rejected', source, reason: `unregistered:来源「${source}」未登记于 SOURCE_POLICY/sources.yaml,默认拒绝` };
  }
  if ('rejected' in policy) {
    return { status: 'rejected', source, reason: policy.rejected };
  }
  const normalize = NORMALIZERS[source];
  if (!normalize) {
    return { status: 'rejected', source, reason: `no-normalizer:来源「${source}」已登记但缺 normalizer 实现` };
  }
  const records: Versioned<'datasetRecord'>[] = [];
  const diagnostics: string[] = [];
  for (const file of files) {
    try {
      const stem = file.name.replace(/\.[^.]+$/, '');
      records.push(normalize(file.json, stem));
    } catch (error) {
      diagnostics.push(`${file.name}: ${(error as Error).message}`);
    }
  }
  return { status: 'imported', source, records, diagnostics };
}
