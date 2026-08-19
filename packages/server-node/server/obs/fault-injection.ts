import type { GameModel } from '../model.js';
import type { AgentContext, GameReview, GameState, VoteTarget } from '../types.js';
import type { FailureClass } from './failure-taxonomy.js';

/**
 * 定向故障注入(OpenSpec 04 · Task 4.3 / 4.4)—— **仅限开发/测试**
 *
 * 造一个能在指定边界抛出指定故障类的模型,用于:
 *   - §4.4:把 9 类故障逐一注入每个边界,断言 trace 分类正确 + 终局失败后权威状态前后相等;
 *   - §4.3:证明**生产环境拒绝**故障开关——`FaultInjectingModel` 构造时若 `NODE_ENV=production` 直接抛。
 *
 * `syntheticError` 造出的错误必须能被 `classifyFailure` **原样归回**同一类(往返性质,
 * 由 `taxonomy.test.ts` 逐类断言),否则注入就失真了。
 */

export interface FaultSpec {
  boundary: 'describe' | 'vote' | 'review';
  failClass: FailureClass;
  /** 失败次数;默认 Infinity(恒失败 → 触发终局失败,用于状态相等断言)。 */
  times?: number;
  /** 供 rate_limit/upstream 演示 `Retry-After`(毫秒)。 */
  retryAfterMs?: number;
}

/** 造一个会被 `classifyFailure` 归回 `failClass` 的合成错误。 */
export function syntheticError(failClass: FailureClass, opts?: { retryAfterMs?: number }): Error {
  switch (failClass) {
    case 'timeout':
      return assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' });
    case 'rate_limit':
      return assign(new Error('DeepSeek 429: Too Many Requests'), {
        status: 429,
        retryAfterMs: opts?.retryAfterMs,
      });
    case 'upstream':
      return assign(new Error('DeepSeek 503: Service Unavailable'), { status: 503 });
    case 'malformed_json':
      return new SyntaxError('Unexpected token < in JSON at position 0');
    case 'schema':
      return assign(new Error('invalid_type: expected string, received number'), { name: 'ZodError' });
    case 'illegal_target':
      return new Error('无效投票目标: nobody');
    case 'policy':
      return assign(
        new Error('AI（ai-1）连续 3 次未能给出合规描述（exact_leak），本回合已安全终止'),
        { name: 'QualityExhaustedError', code: 'exact_leak', status: 500 },
      );
    case 'auth_config':
      return new Error('未配置 DEEPSEEK_API_KEY，请复制 .env.example 为 .env 后填写密钥');
    case 'unknown':
      return new Error('boom: 未预期的未知故障');
    default: {
      const exhaustive: never = failClass;
      return new Error(String(exhaustive));
    }
  }
}

function assign(error: Error, extra: Record<string, unknown>): Error {
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) (error as unknown as Record<string, unknown>)[key] = value;
  }
  return error;
}

/**
 * 包裹任意模型,在匹配的边界抛合成故障。**生产环境构造即抛**(拒绝故障开关)。
 * 每个边界维护独立的剩余失败计数;耗尽后透传给内层模型(用于「瞬时故障后恢复」场景)。
 */
export class FaultInjectingModel implements GameModel {
  readonly model: string;
  private readonly inner: GameModel;
  private readonly remaining: Map<string, number>;
  private readonly byBoundary: Map<string, FaultSpec>;

  constructor(inner: GameModel, specs: FaultSpec[]) {
    if ((process.env.NODE_ENV ?? '') === 'production') {
      throw new Error('生产环境禁止启用故障注入(fault injection is development-only)');
    }
    this.inner = inner;
    this.model = inner.model;
    this.remaining = new Map();
    this.byBoundary = new Map();
    for (const spec of specs) {
      this.byBoundary.set(spec.boundary, spec);
      this.remaining.set(spec.boundary, spec.times ?? Number.POSITIVE_INFINITY);
    }
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  async describe(context: AgentContext): Promise<string> {
    this.maybeFail('describe');
    return this.inner.describe(context);
  }

  async vote(
    context: AgentContext,
    allowedTargets: VoteTarget[],
  ): Promise<{ targetId: string; reason: string }> {
    this.maybeFail('vote');
    return this.inner.vote(context, allowedTargets);
  }

  async review(game: GameState): Promise<GameReview> {
    this.maybeFail('review');
    return this.inner.review(game);
  }

  private maybeFail(boundary: 'describe' | 'vote' | 'review'): void {
    const left = this.remaining.get(boundary) ?? 0;
    if (left <= 0) return;
    const spec = this.byBoundary.get(boundary);
    if (!spec) return;
    this.remaining.set(boundary, left - 1);
    throw syntheticError(spec.failClass, { retryAfterMs: spec.retryAfterMs });
  }
}
