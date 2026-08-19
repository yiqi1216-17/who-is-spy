import type { GameModel } from '../model.js';
import type { TraceEvent } from '../schema.js';
import type { AgentContext, GameReview, GameState, VoteTarget } from '../types.js';
import { classifyFailure } from './failure-taxonomy.js';
import { type RetryClock, type RetryPolicy, DEFAULT_RETRY, realClock, withRetry } from './retry.js';
import { type TraceSink, emitTrace } from './tracer.js';

/**
 * 可观测 + 可恢复的模型装饰器(OpenSpec 04 · Task 3.2 / 4.1 / 4.4)
 *
 * 像 `CountingModel` 一样**只包裹、不改核心**:引擎照常调 `model.describe/vote/review`,
 * 本装饰器在每个边界:
 *   - 起一个 `correlationId`(注入式 id 工厂,默认单调计数 → 确定性,呼应 04-G);
 *   - 走**唯一**的 `withRetry` 恢复路径(有界退避,时钟注入);
 *   - 逐尝试打一条**脱敏 trace**(每次失败一条 error/rejected,成功一条 accepted)——即「尝试世系」;
 *   - 失败经 `classifyFailure` 归入 9 类,`policyCode` 落对应短码。
 *
 * 终局失败时错误照常上抛,引擎的 `withGame` 原子边界丢弃草稿 → 权威状态前后相等(CH-4,§4.4)。
 */
export interface TracedModelOptions {
  sink: TraceSink;
  policy?: RetryPolicy;
  clock?: RetryClock;
  /** 注入单调时钟(毫秒);提供则记录 latencyMs,不提供则省略(fixture 逐字节稳定)。 */
  now?: () => number;
  /** 注入 correlationId 工厂;默认实例内单调计数 `corr-1/2/...`(确定性,不依赖 randomUUID)。 */
  newCorrelationId?: () => string;
}

export class TracedModel implements GameModel {
  readonly model: string;
  private readonly inner: GameModel;
  private readonly sink: TraceSink;
  private readonly policy: RetryPolicy;
  private readonly clock: RetryClock;
  private readonly now?: () => number;
  private readonly newCorrelationId: () => string;
  private corr = 0;

  constructor(inner: GameModel, options: TracedModelOptions) {
    this.inner = inner;
    this.model = inner.model;
    this.sink = options.sink;
    this.policy = options.policy ?? DEFAULT_RETRY;
    this.clock = options.clock ?? realClock;
    this.now = options.now;
    this.newCorrelationId = options.newCorrelationId ?? (() => `corr-${(this.corr += 1)}`);
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  describe(context: AgentContext): Promise<string> {
    return this.run('model.describe', context.game.round, context.identity.playerId, () =>
      this.inner.describe(context),
    );
  }

  vote(
    context: AgentContext,
    allowedTargets: VoteTarget[],
  ): Promise<{ targetId: string; reason: string }> {
    return this.run('model.vote', context.game.round, context.identity.playerId, () =>
      this.inner.vote(context, allowedTargets),
    );
  }

  review(game: GameState): Promise<GameReview> {
    return this.run('model.review', game.round, undefined, () => this.inner.review(game));
  }

  private run<T>(
    boundary: TraceEvent['boundary'],
    round: number,
    playerId: string | undefined,
    op: () => Promise<T>,
  ): Promise<T> {
    const correlationId = this.newCorrelationId();
    return withRetry(
      async (attempt) => {
        const started = this.now?.();
        const value = await op();
        this.emit({ correlationId, round, playerId, boundary, attempt, outcome: 'accepted', started });
        return value;
      },
      {
        policy: this.policy,
        clock: this.clock,
        classify: classifyFailure,
        onAttempt: ({ attempt, classification }) => {
          this.emit({
            correlationId,
            round,
            playerId,
            boundary,
            attempt,
            outcome: classification.outcome,
            policyCode: classification.policyCode,
          });
        },
      },
    );
  }

  /** 组装并落一条 trace;playerId/latencyMs/policyCode 仅在有值时出现(避免空字段/不稳定)。 */
  private emit(args: {
    correlationId: string;
    round: number;
    playerId: string | undefined;
    boundary: TraceEvent['boundary'];
    attempt: number;
    outcome: TraceEvent['outcome'];
    policyCode?: string;
    started?: number;
  }): void {
    const fields: TraceEvent = {
      correlationId: args.correlationId,
      round: args.round,
      boundary: args.boundary,
      attempt: args.attempt,
      outcome: args.outcome,
    };
    if (args.playerId !== undefined) fields.playerId = args.playerId;
    if (args.policyCode !== undefined) fields.policyCode = args.policyCode;
    if (args.started !== undefined && this.now) {
      fields.latencyMs = Math.max(0, this.now() - args.started);
    }
    emitTrace(this.sink, fields);
  }
}
