import { z } from 'zod';
import type { HighlightType } from './highlights.js';

/**
 * 知情、去标识的产品反馈(OpenSpec 05-H · 任务 5.5)
 *
 * 设计三原则:
 *  1. **知情**:`consent` 恒为字面量 `true` —— 未明确同意在**结构上**无法落库(schema 即闸)。
 *     完整退出路径在前端:选择「不用了」则一个字节都不发送(零遥测),后端亦拒绝任何未同意提交。
 *  2. **去标识**:提交里绝无自由文本;`gameId` 仅用于把「最爱 Agent / 最爱瞬间」校验到真实对局,
 *     校验后**即弃**,永不入库。落库记录只含:粗到「天」的时间桶、若干枚举、稳定原型引用。
 *  3. **可聚合**:最爱 Agent 记为稳定席位原型(ai-N,跨局同一人设);最爱瞬间记为**高光类型**
 *     而非某局特有的卡片 id —— 天然可跨局汇总,且进一步去标识。
 *
 * 采集信号(与任务 5.5 一一对应):完成度 / 再来一局 / 最爱 Agent / 最爱瞬间 / 分享意向 /
 * 重玩意向 / playtest 偏好(竖屏 vs B0)。
 */

const triState = z.enum(['yes', 'no', 'maybe']);

/** 客户端提交(经 /api/feedback)。strict:多余字段一律拒绝,杜绝夹带 PII/自由文本。 */
export const feedbackSubmissionSchema = z
  .object({
    // 知情闸:必须是字面量 true。缺失 / false / 非布尔 → ZodError → 400,记录零落库。
    consent: z.literal(true),
    // 仅用于服务端把下面两个「最爱」引用校验到真实对局,校验后即弃(不入库)。
    gameId: z.string().min(1),
    completion: z.enum(['completed', 'abandoned']),
    rematch: triState,
    favoriteAgentId: z.string().min(1).nullable().default(null),
    favoriteMomentId: z.string().min(1).nullable().default(null),
    share: triState,
    replayIntent: triState,
    playtestPreference: z.enum(['portrait', 'b0', 'no_preference']),
  })
  .strict();

export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

/**
 * 落库记录:**去标识**后的最终形态。
 * 无 gameId、无 IP/UA、无精确时间戳、无任何自由文本 —— 只有粗时间桶、枚举与稳定原型引用。
 */
export interface DeidentifiedFeedback {
  /** 粗到「天」的时间桶(YYYY-MM-DD):可做趋势,却难以据此重标识个体。 */
  readonly dayBucket: string;
  readonly completion: FeedbackSubmission['completion'];
  readonly rematch: z.infer<typeof triState>;
  /** 稳定席位原型引用(ai-N)或 null;跨局同一人设,故可聚合。 */
  readonly favoriteAgentId: string | null;
  /** 最爱瞬间记为**高光类型**(非某局特有 id),可跨局聚合;无对应则 null。 */
  readonly favoriteMomentType: HighlightType | null;
  readonly share: z.infer<typeof triState>;
  readonly replayIntent: z.infer<typeof triState>;
  readonly playtestPreference: FeedbackSubmission['playtestPreference'];
}

/** 落库记录允许出现的键(白名单):assertDeidentified 据此做防御性自检。 */
const ALLOWED_KEYS = [
  'dayBucket',
  'completion',
  'rematch',
  'favoriteAgentId',
  'favoriteMomentType',
  'share',
  'replayIntent',
  'playtestPreference',
] as const;

export class FeedbackError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'FeedbackError';
  }
}

/** 校验所需的对局侧只读事实(由端点从引擎读入后传入,保持本模块与引擎解耦)。 */
export interface FeedbackReferences {
  /** 对局里的 AI 席位 id(不含人类)。 */
  readonly agentIds: readonly string[];
  /** 终局高光卡:id → 类型。用于把 favoriteMomentId 解析为可聚合的类型。 */
  readonly moments: ReadonlyArray<{ id: string; type: HighlightType }>;
}

/**
 * 把提交里的两个「最爱」引用校验到真实对局并解析:
 *  - favoriteAgentId 必须是真实 AI 席位(不能凭空点赞不存在的人);
 *  - favoriteMomentId 必须是真实终局高光卡,解析为其**类型**(忠实性:不能收藏没发生过的瞬间)。
 * 任一越界 → FeedbackError(400)。null 合法(可以不选)。
 */
export function resolveReferences(
  submission: FeedbackSubmission,
  references: FeedbackReferences,
): { favoriteAgentId: string | null; favoriteMomentType: HighlightType | null } {
  let favoriteAgentId: string | null = null;
  if (submission.favoriteAgentId !== null) {
    if (!references.agentIds.includes(submission.favoriteAgentId)) {
      throw new FeedbackError('最爱 Agent 不在本局席位中');
    }
    favoriteAgentId = submission.favoriteAgentId;
  }

  let favoriteMomentType: HighlightType | null = null;
  if (submission.favoriteMomentId !== null) {
    const moment = references.moments.find((m) => m.id === submission.favoriteMomentId);
    if (!moment) throw new FeedbackError('最爱瞬间不在本局高光中');
    favoriteMomentType = moment.type;
  }

  return { favoriteAgentId, favoriteMomentType };
}

/** 把提交 + 已解析引用 + 天桶,组装成**去标识**落库记录(gameId 在此彻底消失)。 */
export function deidentify(
  submission: FeedbackSubmission,
  resolved: { favoriteAgentId: string | null; favoriteMomentType: HighlightType | null },
  dayBucket: string,
): DeidentifiedFeedback {
  return {
    dayBucket,
    completion: submission.completion,
    rematch: submission.rematch,
    favoriteAgentId: resolved.favoriteAgentId,
    favoriteMomentType: resolved.favoriteMomentType,
    share: submission.share,
    replayIntent: submission.replayIntent,
    playtestPreference: submission.playtestPreference,
  };
}

/** 防御性自检:落库记录只能含白名单键(杜绝重构时误把 gameId/自由文本混入存储)。 */
export function assertDeidentified(record: DeidentifiedFeedback): void {
  for (const key of Object.keys(record)) {
    if (!ALLOWED_KEYS.includes(key as (typeof ALLOWED_KEYS)[number])) {
      throw new FeedbackError(`去标识记录出现非白名单键: ${key}`, 500);
    }
  }
}

function tallyOf<T extends string>(values: Iterable<T>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
}

/** 去标识聚合快照:只出计数,不出单条记录(个体不可见,仅趋势可见)。 */
export interface FeedbackSummary {
  total: number;
  completion: Record<string, number>;
  rematch: Record<string, number>;
  share: Record<string, number>;
  replayIntent: Record<string, number>;
  playtestPreference: Record<string, number>;
  favoriteAgent: Record<string, number>;
  favoriteMoment: Record<string, number>;
}

export function summarize(records: readonly DeidentifiedFeedback[]): FeedbackSummary {
  return {
    total: records.length,
    completion: tallyOf(records.map((r) => r.completion)),
    rematch: tallyOf(records.map((r) => r.rematch)),
    share: tallyOf(records.map((r) => r.share)),
    replayIntent: tallyOf(records.map((r) => r.replayIntent)),
    playtestPreference: tallyOf(records.map((r) => r.playtestPreference)),
    favoriteAgent: tallyOf(records.filter((r) => r.favoriteAgentId).map((r) => r.favoriteAgentId!)),
    favoriteMoment: tallyOf(
      records.filter((r) => r.favoriteMomentType).map((r) => r.favoriteMomentType!),
    ),
  };
}

/**
 * 进程内去标识反馈存储(take-home 免依赖;持久化可替换为追加式 JSONL / 数据库)。
 * 只暴露「记录」与「聚合快照」;**不**提供逐条读取出口 —— 个体记录不出存储。
 */
export class FeedbackStore {
  private readonly records: DeidentifiedFeedback[] = [];

  record(entry: DeidentifiedFeedback): void {
    assertDeidentified(entry);
    this.records.push(entry);
  }

  summary(): FeedbackSummary {
    return summarize(this.records);
  }

  size(): number {
    return this.records.length;
  }
}

/** 今日「天桶」(YYYY-MM-DD)。抽成函数便于端点注入固定值做确定性测试。 */
export function todayBucket(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
