import { z } from 'zod';

/**
 * 版本化 schema 底座(OpenSpec 03 · Task 2.1)
 *
 * 每个跨边界工件(公开状态、事件、Agent 上下文、信念、策略、模型输出、
 * 数据记录、hook 投影、trace、报告)都用 `{ v, kind, data }` 信封承载。
 * 消费者用 parseVersioned 校验:主版本与 kind 必须匹配,否则抛可执行的
 * SchemaVersionError;data 再经该 kind 的 zod schema 校验。
 *
 * strict() 是隐私接缝的一部分:trace / hook / belief 拒绝任何未知字段,
 * 从结构上阻止密词、私有 prompt、自由文本推理混入投影或落盘工件。
 */

/** 当前 schema 主版本。破坏性变更时 +1;消费者据此拒绝不兼容工件。 */
export const SCHEMA_VERSION = 1;

const role = z.enum(['civilian', 'undercover']);
const phase = z.enum(['describing', 'voting', 'finished']);
const unit = z.number().min(0).max(1);

// —— 公开状态与事件 ——
const eventSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(['system', 'description', 'vote_result', 'elimination']),
    text: z.string(),
    round: z.number().int().nonnegative(),
    playerId: z.string().optional(),
  })
  .strict();

const descriptionSchema = z
  .object({ playerId: z.string(), text: z.string(), round: z.number().int().nonnegative() })
  .strict();

const voteSchema = z
  .object({
    voterId: z.string(),
    targetId: z.string(),
    reason: z.string(),
    round: z.number().int().nonnegative(),
    ballot: z.number().int().positive(),
  })
  .strict();

const publicStateSchema = z
  .object({
    id: z.string().min(1),
    phase,
    round: z.number().int().nonnegative(),
    ballot: z.number().int().positive(),
    players: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
          avatar: z.string(),
          isHuman: z.boolean(),
          alive: z.boolean(),
          revealedRole: role.optional(),
          revealedWord: z.string().optional(),
        })
        .strict(),
    ),
    descriptions: z.array(descriptionSchema),
    votes: z.array(voteSchema),
    events: z.array(eventSchema),
    eligibleTargetIds: z.array(z.string()).nullable(),
    winner: role.nullable(),
    review: z.unknown().nullable(),
    human: z.object({ playerId: z.string(), role, word: z.string() }).strict(),
    model: z.string(),
  })
  .strict();

// —— Agent 上下文(允许列投影) ——
const strategyViewSchema = z
  .object({
    persona: z.string(),
    tactics: z.array(z.string()),
    specificity: unit,
    novelty: unit,
    risk: unit,
  })
  .strict();

const agentContextSchema = z
  .object({
    identity: z
      .object({ playerId: z.string(), name: z.string(), role, word: z.string() })
      .strict(),
    strategy: strategyViewSchema,
    game: z
      .object({
        round: z.number().int().nonnegative(),
        alivePlayers: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
        publicDescriptions: z.array(
          z
            .object({
              playerId: z.string(),
              playerName: z.string(),
              text: z.string(),
              round: z.number().int().nonnegative(),
            })
            .strict(),
        ),
        publicEliminations: z.array(
          z.object({ text: z.string(), round: z.number().int().nonnegative() }).strict(),
        ),
      })
      .strict(),
  })
  .strict();

// —— 私有结构化信念(无自由文本 CoT) ——
const beliefSchema = z
  .object({
    round: z.number().int().nonnegative(),
    suspicions: z.array(z.object({ playerId: z.string(), score: unit }).strict()),
    selfExposure: unit,
    evidenceRefs: z.array(
      z.object({ playerId: z.string(), round: z.number().int().nonnegative() }).strict(),
    ),
  })
  .strict();

// —— 可解释策略原型 ——
const strategySchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    role: z.enum(['civilian', 'undercover', 'any']),
    persona: z.string().min(1),
    tactics: z.array(z.string().min(1)),
    specificity: unit,
    novelty: unit,
    risk: unit,
    provenance: z
      .object({
        kind: z.enum(['human', 'transfer', 'synthetic']),
        sampleIds: z.array(z.string()).optional(),
      })
      .strict(),
  })
  .strict();

// —— 模型输出 ——
const modelDescribeOutputSchema = z
  .object({
    description: z.string().trim().min(2).max(60),
    private_reasoning_summary: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

const modelVoteOutputSchema = z
  .object({ targetId: z.string().min(1), reason: z.string().trim().min(2).max(80) })
  .strict();

const modelReviewOutputSchema = z
  .object({
    headline: z.string().trim().min(2).max(40),
    summary: z.string().trim().min(10).max(300),
    turningPoints: z.array(z.string().trim().min(2).max(120)).min(1).max(4),
    playerInsights: z.array(
      z.object({ playerId: z.string(), insight: z.string().trim().min(2).max(120) }).strict(),
    ),
  })
  .strict();

// —— 数据记录(三类来源显式分离) ——
const datasetRecordSchema = z
  .object({
    gameId: z.string().min(1),
    provenance: z.enum(['human', 'transfer', 'synthetic']),
    players: z.array(z.object({ pseudoId: z.string(), role }).strict()),
    actions: z.array(
      z
        .object({
          round: z.number().int().nonnegative(),
          playerId: z.string(),
          kind: z.enum(['describe', 'vote']),
          text: z.string().optional(),
          targetId: z.string().optional(),
        })
        .strict(),
    ),
    license: z.string().optional(),
  })
  .strict();

// —— hook 投影(只公开信息) ——
const hookPayloadSchema = z
  .object({
    hook: z.string().min(1),
    round: z.number().int().nonnegative(),
    public: z
      .object({
        descriptions: z.array(descriptionSchema),
        eliminations: z.array(
          z.object({ text: z.string(), round: z.number().int().nonnegative() }).strict(),
        ),
      })
      .strict(),
  })
  .strict();

// —— trace 事件(脱敏,拒绝私有字段) ——
const traceEventSchema = z
  .object({
    correlationId: z.string().min(1),
    round: z.number().int().nonnegative(),
    ballot: z.number().int().positive().optional(),
    boundary: z.enum(['model.describe', 'model.vote', 'model.review', 'hook']),
    playerId: z.string().optional(),
    attempt: z.number().int().positive(),
    outcome: z.enum(['accepted', 'rejected', 'error']),
    policyCode: z.string().optional(),
    latencyMs: z.number().nonnegative().optional(),
    // 被拒私有候选只留**不可逆**指纹(design.md §5 / §3.3):8 位十六进制短哈希 + 字符长度。
    // 供「重试确实换了候选 / 长度是否异常」复盘;哈希不可逆、长度信息量不足以重建文本,
    // 故即便候选夹带密词,指纹里也不出现密词字面量——原文永不入 trace。
    candidateHash: z
      .string()
      .regex(/^[0-9a-f]{8}$/)
      .optional(),
    candidateLength: z.number().int().nonnegative().optional(),
  })
  .strict();

// —— 评测报告信封 ——
const reportSchema = z
  .object({
    suite: z.string().min(1),
    milestone: z.string().min(1),
    sampleSize: z.number().int().nonnegative(),
    metrics: z.array(
      z
        .object({
          key: z.string().min(1),
          value: z.number(),
          n: z.number().int().nonnegative(),
        })
        .strict(),
    ),
  })
  .strict();

/** 已注册的跨边界工件种类。新增工件必须在此登记,才能获得版本守卫。 */
export const SCHEMAS = {
  publicState: publicStateSchema,
  event: eventSchema,
  agentContext: agentContextSchema,
  belief: beliefSchema,
  strategy: strategySchema,
  modelDescribeOutput: modelDescribeOutputSchema,
  modelVoteOutput: modelVoteOutputSchema,
  modelReviewOutput: modelReviewOutputSchema,
  datasetRecord: datasetRecordSchema,
  hookPayload: hookPayloadSchema,
  traceEvent: traceEventSchema,
  report: reportSchema,
} as const;

export type SchemaKind = keyof typeof SCHEMAS;
export type Strategy = z.infer<typeof strategySchema>;
export type Belief = z.infer<typeof beliefSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;
export type Versioned<K extends SchemaKind> = {
  v: number;
  kind: K;
  data: z.infer<(typeof SCHEMAS)[K]>;
};

/** 版本/种类不兼容时抛出;消息可执行(指明期望值与实际值)。 */
export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SchemaVersionError';
  }
}

/** 用当前主版本包装一个工件为版本化信封。 */
export function envelope<K extends SchemaKind>(
  kind: K,
  data: z.infer<(typeof SCHEMAS)[K]>,
): Versioned<K> {
  return { v: SCHEMA_VERSION, kind, data };
}

/**
 * 校验并解包一个版本化信封。
 * - v 缺失/不等于 SCHEMA_VERSION → SchemaVersionError
 * - kind 缺失/与期望不符 → SchemaVersionError
 * - data 不满足该 kind 的 schema → 抛 zod 校验错误
 */
export function parseVersioned<K extends SchemaKind>(
  kind: K,
  input: unknown,
): z.infer<(typeof SCHEMAS)[K]> {
  if (typeof input !== 'object' || input === null) {
    throw new SchemaVersionError(`工件缺少版本信封,无法作为 ${kind} 消费`);
  }
  const record = input as Record<string, unknown>;
  if (record.v !== SCHEMA_VERSION) {
    throw new SchemaVersionError(
      `${kind} 版本不兼容:期望 v${SCHEMA_VERSION},实际 v${String(record.v)};请迁移或重建该工件`,
    );
  }
  if (record.kind !== kind) {
    throw new SchemaVersionError(
      `工件 kind 不符:期望 ${kind},实际 ${String(record.kind)}`,
    );
  }
  return SCHEMAS[kind].parse(record.data) as z.infer<(typeof SCHEMAS)[K]>;
}
