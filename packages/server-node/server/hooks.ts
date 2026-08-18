import { type SchemaKind, envelope, parseVersioned } from './schema.js';

/**
 * Typed hook 注册表(OpenSpec 03 · Task 5.2)
 *
 * 扩展缝:观察者(直播叠加、审计、外部记分板)在回合公开点被通知,但受严格约束:
 *   - 投影:只收版本化的 **公开投影**(hookPayload),经 strict schema 校验;
 *     任何密词/身份/私有 prompt 混入都会在发射前被拒(secret-sentinel)。
 *   - 权限:拿到的是**深冻结的克隆**,无法改动对局状态;返回值一律忽略(观察者非裁决者)。
 *   - 超时:每个 hook 有独立时间预算,超时按失败计,绝不拖垮对局。
 *   - 失败隔离:任一 hook 抛错/超时都不影响其他 hook 与主流程(默认 isolate)。
 */

export type HookName = 'onRoundPublished';

/** 传给 hook 的公开投影(与 schema.ts 的 hookPayload 对齐)。 */
export type HookPayload = ReturnType<typeof parseHookPayload>;

function parseHookPayload(input: unknown) {
  return parseVersioned('hookPayload', input);
}

export type HookFn = (payload: HookPayload) => unknown | Promise<unknown>;

interface HookRecord {
  name: string;
  hook: HookName;
  fn: HookFn;
  timeoutMs: number;
}

export interface HookEmitResult {
  name: string;
  outcome: 'ok' | 'error' | 'timeout';
}

/** 单个 hook 的默认时间预算(毫秒)。 */
export const DEFAULT_HOOK_TIMEOUT_MS = 200;

export class HookTimeoutError extends Error {
  constructor(name: string, ms: number) {
    super(`hook「${name}」超过 ${ms}ms 预算,已按失败计`);
    this.name = 'HookTimeoutError';
  }
}

export class HookRegistry {
  private readonly records: HookRecord[] = [];

  /** 注册一个观察者。返回注销函数。 */
  register(
    hook: HookName,
    name: string,
    fn: HookFn,
    opts?: { timeoutMs?: number },
  ): () => void {
    const record: HookRecord = {
      name,
      hook,
      fn,
      timeoutMs: opts?.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS,
    };
    this.records.push(record);
    return () => {
      const idx = this.records.indexOf(record);
      if (idx >= 0) this.records.splice(idx, 1);
    };
  }

  /**
   * 向所有该类 hook 发射一份公开投影。
   * - 投影先经版本化 strict schema 校验:不干净(夹带密词/身份等)则整批拒绝、不触发任何 hook。
   * - 每个 hook 收深冻结克隆、带超时、错误隔离;返回结果数组供 trace 记录,绝不抛给主流程。
   */
  async emit(hook: HookName, projection: unknown): Promise<HookEmitResult[]> {
    // secret-sentinel:strict schema 拒绝任何未登记字段(密词/prompt/身份等)。
    const payload = parseHookPayload(envelope('hookPayload', projection as never));
    const targets = this.records.filter((record) => record.hook === hook);
    const results: HookEmitResult[] = [];
    for (const record of targets) {
      const frozen = deepFreeze(structuredClone(payload)); // 权限:观察者不可变更投影
      try {
        await withTimeout(Promise.resolve(record.fn(frozen)), record.timeoutMs, record.name);
        results.push({ name: record.name, outcome: 'ok' });
      } catch (error) {
        results.push({
          name: record.name,
          outcome: error instanceof HookTimeoutError ? 'timeout' : 'error',
        });
      }
    }
    return results;
  }

  /** 已注册的 hook 数(用于自检/测试)。 */
  size(hook?: HookName): number {
    return hook ? this.records.filter((r) => r.hook === hook).length : this.records.length;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new HookTimeoutError(name, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}

// 让 SchemaKind 的引用显式化,避免未使用告警并锁定 hookPayload 是已登记种类。
const _hookKind: SchemaKind = 'hookPayload';
void _hookKind;
