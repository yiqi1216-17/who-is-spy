import type { HookEmitResult } from '../hooks.js';
import { scanSecrets } from '../redaction.js';
import { type TraceEvent, type Versioned, envelope, parseVersioned } from '../schema.js';
import { currentGameId } from './game-scope.js';

/**
 * 脱敏 trace 汇(OpenSpec 04 · Task 3.1 / 3.2)
 *
 * 每条 trace 是**版本化 `traceEvent` 信封**,其 schema 是 `.strict()` 的——结构上
 * 只有 {correlationId, round, ballot?, boundary, playerId?, attempt, outcome, policyCode?,
 * latencyMs?},**没有任何自由文本 / 密词 / prompt / 信念字段可容身**(R1 的结构性封堵)。
 * `policyCode` 再经**允许列**闸一道:只收登记过的短码,杜绝把自由文本塞进这唯一的字符串位。
 */

/**
 * `policyCode` 允许列:失败分类 9 类 + 质量策略码 5 类 + hook 边界 2 类 + 恢复标记。
 * 任何不在列内的值都会被 `assertPolicyCode` 拒绝——policyCode 是 trace 里唯一的自由字符串位,
 * 必须锁成短码,否则就成了自由文本(乃至密词)的旁路。
 */
export const POLICY_CODES: readonly string[] = [
  'timeout',
  'rate_limit',
  'upstream',
  'malformed_json',
  'schema',
  'illegal_target',
  'policy',
  'auth_config',
  'unknown',
  'too_short',
  'exact_leak',
  'obfuscated_leak',
  'too_similar',
  'duplicate_self',
  'hook_timeout',
  'hook_error',
  'retry',
  'exhausted',
];
const POLICY_SET = new Set(POLICY_CODES);

export function assertPolicyCode(code: string): void {
  if (!POLICY_SET.has(code)) {
    throw new Error(`policyCode「${code}」不在允许列内:trace 只接受登记短码,禁止自由文本`);
  }
}

export interface TraceSink {
  record(event: Versioned<'traceEvent'>): void;
}

/** 内存 trace 汇:测试/CLI 用;可按边界过滤,便于断言世系。 */
export class MemoryTraceSink implements TraceSink {
  private readonly log: Versioned<'traceEvent'>[] = [];

  /**
   * `maxEvents` 为可选**环形上限**:超出即丢最旧,防止长跑服务的 trace 无界增长。
   * 测试默认无界(`Infinity`)以便精确断言世系;生产(见 `app.ts`)取有限值。
   */
  constructor(private readonly maxEvents: number = Number.POSITIVE_INFINITY) {}

  record(event: Versioned<'traceEvent'>): void {
    this.log.push(event);
    if (this.log.length > this.maxEvents) {
      this.log.splice(0, this.log.length - this.maxEvents);
    }
  }

  events(): readonly Versioned<'traceEvent'>[] {
    return this.log;
  }

  byBoundary(boundary: TraceEvent['boundary']): Versioned<'traceEvent'>[] {
    return this.log.filter((event) => event.data.boundary === boundary);
  }

  byCorrelation(correlationId: string): Versioned<'traceEvent'>[] {
    return this.log.filter((event) => event.data.correlationId === correlationId);
  }

  byGame(gameId: string): Versioned<'traceEvent'>[] {
    return this.log.filter((event) => event.data.gameId === gameId);
  }

  clear(): void {
    this.log.length = 0;
  }
}

/**
 * 构造一条 trace 并落汇。**双重校验**:
 *  1. policyCode 若有,必须在允许列内(短码闸)。
 *  2. 经 `envelope`+`parseVersioned` 往返:strict schema 结构上拒绝任何未登记字段。
 * 任一不过即抛,绝不静默落一条脏 trace。
 */
export function emitTrace(sink: TraceSink, fields: TraceEvent): Versioned<'traceEvent'> {
  if (fields.policyCode !== undefined) assertPolicyCode(fields.policyCode);
  // 「哪一局」维度在**单一收口点**补齐:所有发射方(TracedModel 传输世系 / 引擎决策纠偏 /
  // hook 边界)都经本函数落汇,对局作用域内自动归属局号;作用域外(离线单测直发)保持缺省。
  const gameId = fields.gameId ?? currentGameId();
  const scoped: TraceEvent = gameId === undefined ? fields : { ...fields, gameId };
  const validated = parseVersioned('traceEvent', envelope('traceEvent', scoped));
  const event = envelope('traceEvent', validated);
  sink.record(event);
  return event;
}

/**
 * 把一次 hook 发射的结果映射成 hook 边界 trace(OpenSpec 04 · §3.2 的 hook 侧)。
 * ok→accepted;timeout→error(policyCode=hook_timeout);error→error(policyCode=hook_error)。
 * hook 名字**不入 trace**(可能含观察者标识);只记结构化 outcome + 短码。
 */
export function traceHookResults(
  sink: TraceSink,
  args: { correlationId: string; round: number; results: readonly HookEmitResult[] },
): void {
  args.results.forEach((result) => {
    emitTrace(sink, {
      correlationId: args.correlationId,
      round: args.round,
      boundary: 'hook',
      attempt: 1,
      outcome: result.outcome === 'ok' ? 'accepted' : 'error',
      ...(result.outcome === 'timeout'
        ? { policyCode: 'hook_timeout' }
        : result.outcome === 'error'
          ? { policyCode: 'hook_error' }
          : {}),
    });
  });
}

/**
 * 隐私工件扫描(OpenSpec 04 · Task 3.1):trace 工件序列化后不得出现任何机密字面量。
 * 因 traceEvent 是 strict schema,结构上本就装不下密词——本扫描是**结构安全的证明**,应恒返回空。
 */
export function scanTraceArtifacts(events: readonly Versioned<'traceEvent'>[]): string[] {
  return scanSecrets(JSON.stringify(events));
}
