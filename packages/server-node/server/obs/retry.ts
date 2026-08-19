import { type Classification, classifyFailure } from './failure-taxonomy.js';

/**
 * 有界退避重试(OpenSpec 04 · Task 4.2)
 *
 * **一条**可测的恢复路径:指数退避 + 抖动 + 尊重 `Retry-After` + 不可重试类快速失败。
 * 时钟经**注入**,所以单测可断言退避序列而**绝不真的 sleep**(测试用记录型时钟)。
 * `onAttempt` 回调导出「尝试世系」(每次失败一条),上层 `TracedModel` 据此逐尝试打 trace。
 */

/** 注入式时钟:sleep 决定「等多久」,jitter 提供 [0,1) 抖动源。测试注入确定性实现。 */
export interface RetryClock {
  sleep(ms: number): Promise<void>;
  jitter(): number;
}

/** 生产时钟:真的等待 + Math.random 抖动。fixture/单测请勿使用。 */
export const realClock: RetryClock = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  jitter: () => Math.random(),
};

export interface RetryPolicy {
  /** 总尝试次数(含首次)。 */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 3, baseDelayMs: 200, maxDelayMs: 2000 };

export interface AttemptInfo {
  attempt: number;
  classification: Classification;
  willRetry: boolean;
  delayMs: number;
}

/** 满退避 + 抖动;若分类带 `retryAfterMs` 则优先尊重(仍受 maxDelay 封顶)。 */
export function computeDelay(
  policy: RetryPolicy,
  attempt: number,
  classification: Classification,
  jitter: number,
): number {
  if (classification.retryAfterMs != null) {
    return Math.min(policy.maxDelayMs, classification.retryAfterMs);
  }
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(policy.maxDelayMs, exponential);
  // full jitter:落在 [capped/2, capped],削平「重试风暴」的同步尖峰。
  return Math.round(capped * (0.5 + 0.5 * jitter));
}

/**
 * 以有界退避重试 `fn`。`fn` 收到当前尝试序号(从 1 起)。
 * - 分类不可重试(auth_config / policy)→ 首次失败即抛,不等待。
 * - 达到 maxAttempts → 抛最后一次错误(世系已由 onAttempt 导出)。
 * - 成功 → 立即返回;`onSuccess` 收到成功时的尝试序号。
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: {
    policy?: RetryPolicy;
    clock?: RetryClock;
    classify?: (error: unknown) => Classification;
    onAttempt?: (info: AttemptInfo) => void;
    onSuccess?: (attempt: number) => void;
  } = {},
): Promise<T> {
  const policy = opts.policy ?? DEFAULT_RETRY;
  const clock = opts.clock ?? realClock;
  const classify = opts.classify ?? classifyFailure;

  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      const value = await fn(attempt);
      opts.onSuccess?.(attempt);
      return value;
    } catch (error) {
      lastError = error;
      const classification = classify(error);
      const isLast = attempt >= policy.maxAttempts;
      const willRetry = classification.retryable && !isLast;
      const delayMs = willRetry ? computeDelay(policy, attempt, classification, clock.jitter()) : 0;
      opts.onAttempt?.({ attempt, classification, willRetry, delayMs });
      if (!willRetry) break;
      await clock.sleep(delayMs);
    }
  }
  throw lastError;
}

/** 记录型测试时钟:sleep 只把毫秒推进 `delays` 数组,永不真等;jitter 恒定可控。 */
export function recordingClock(jitterValue = 0): RetryClock & { delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
    jitter: () => jitterValue,
  };
}
