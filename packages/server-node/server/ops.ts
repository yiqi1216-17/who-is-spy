import type express from 'express';
import { z } from 'zod';
import { DEFAULT_THRESHOLDS, evaluateSelfPlay } from './eval/report.js';
import { runSelfPlayBatch } from './eval/self-play.js';
import type { GameModel } from './model.js';
import { type FaultSpec, syntheticError } from './obs/fault-injection.js';
import { type MemoryTraceSink, scanTraceArtifacts } from './obs/tracer.js';
import { FakeGameModel } from './test-utils.js';
import type { AgentContext, GameReview, GameState, VoteTarget } from './types.js';

/**
 * 观测台出口(题面任务线③的前端呈现层 · 后端侧)—— **仅限开发环境**
 *
 * 题面第 3 节明说:「评测面板、trace 视图、故障注入开关」在前端有自然呈现是加分项。
 * 本模块把已交付的 04-E/04-F 能力开成三个 **附加** 端点(不改冻结契约),供 `/ops.html` 消费:
 *   - `GET  /api/ops/trace`   脱敏 trace 只读快照(可按 局/边界/结局/世系 过滤);
 *   - `GET/POST/DELETE /api/ops/faults` 运行时故障注入开关(装配在真实模型链上);
 *   - `POST /api/ops/eval`    进程内跑一批确定性自博弈评测,回传记分卡 + 门禁结果。
 *
 * 生产禁用是**三重闸**,每一重都可独立测试:
 *   1. `app.ts` 在 `NODE_ENV=production` 时不挂载本路由(/api/ops/* → 404);
 *   2. 生产模型链上根本不装 `FaultSwitch`(TracedModel 直包真实模型);
 *   3. `FaultSwitch.arm` 与 `registerOpsRoutes` 自校环境,生产调用即抛。
 * 另:前端 `/ops.html` 不在 vite 构建入口里,生产 bundle 结构上不含观测台(第四重,见 web)。
 */

/**
 * 运行时故障开关:平时**逐字节透传**(禁用态零行为差异),`arm` 后在指定边界抛出
 * 指定类别的合成故障(复用 `syntheticError`,保证能被 `classifyFailure` 原样归类)。
 * 与 `FaultInjectingModel`(测试用,构造期定死)的差别只在**可运行时装/卸**;
 * 语义对齐:按边界倒数 `times` 次,耗尽后透传(演示「瞬时故障 → 重试恢复」)。
 */
export class FaultSwitch implements GameModel {
  private spec: FaultSpec | null = null;
  private remaining = 0;
  private injected = 0;

  constructor(private readonly inner: GameModel) {}

  get model(): string {
    return this.inner.model;
  }

  isConfigured(): boolean {
    return this.inner.isConfigured();
  }

  /** 装上一个故障计划;生产环境调用即抛(第 3 重闸)。 */
  arm(spec: FaultSpec): void {
    assertNotProduction('故障注入开关');
    this.spec = { ...spec };
    this.remaining = spec.times ?? Number.POSITIVE_INFINITY;
    this.injected = 0;
  }

  /** 卸下故障计划,恢复纯透传。 */
  disarm(): void {
    this.spec = null;
    this.remaining = 0;
  }

  /** 当前开关状态(供面板呈现):剩余次数 ∞ 以 null 表示,保 JSON 可序列化。 */
  status(): {
    armed: boolean;
    spec?: FaultSpec;
    remaining?: number | null;
    injected: number;
  } {
    if (!this.spec) return { armed: false, injected: this.injected };
    return {
      armed: true,
      spec: { ...this.spec },
      remaining: Number.isFinite(this.remaining) ? this.remaining : null,
      injected: this.injected,
    };
  }

  async describe(context: AgentContext): Promise<string> {
    this.maybeFail('describe');
    return this.inner.describe(context);
  }

  /** 上帝模式描述与 describe 共用同一故障边界;内层未实现该可选能力时安全回退。 */
  async describeWithThought(context: AgentContext): Promise<{ text: string; thought: string }> {
    this.maybeFail('describe');
    if (this.inner.describeWithThought) return this.inner.describeWithThought(context);
    return { text: await this.inner.describe(context), thought: '' };
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

  private maybeFail(boundary: FaultSpec['boundary']): void {
    if (!this.spec || this.spec.boundary !== boundary || this.remaining <= 0) return;
    this.remaining -= 1;
    this.injected += 1;
    throw syntheticError(this.spec.failClass, { retryAfterMs: this.spec.retryAfterMs });
  }
}

function assertNotProduction(what: string): void {
  if ((process.env.NODE_ENV ?? '') === 'production') {
    throw new Error(`生产环境禁止启用${what}(development-only)`);
  }
}

const FAILURE_CLASSES = [
  'timeout',
  'rate_limit',
  'upstream',
  'malformed_json',
  'schema',
  'illegal_target',
  'policy',
  'auth_config',
  'unknown',
] as const;

const faultInput = z
  .object({
    boundary: z.enum(['describe', 'vote', 'review']),
    failClass: z.enum(FAILURE_CLASSES),
    /** 缺省 = 恒失败(演示不可恢复 → 原子回滚);有值 = 瞬时故障(演示重试恢复)。 */
    times: z.number().int().positive().max(999).optional(),
    retryAfterMs: z.number().int().nonnegative().max(60_000).optional(),
  })
  .strict();

const evalInput = z
  .object({
    games: z.number().int().min(1).max(32).optional(),
    seed: z.number().int().optional(),
    /** 注入必然泄题的模型:质量门穷尽 → 原子终止 → 完成率门变红(现场演示「门禁真的会红」)。 */
    demoFail: z.boolean().optional(),
  })
  .strict();

/** 必然泄题的假模型(与 tools/evaluate.ts 的 --demo-fail 同源语义):描述直接吐自身密词。 */
class LeakyDescribeModel extends FakeGameModel {
  async describe(context: AgentContext): Promise<string> {
    return context.identity.word;
  }
}

export interface OpsDeps {
  sink: MemoryTraceSink;
  faults: FaultSwitch;
}

/** 挂载观测台端点。生产环境调用即抛(与 app.ts 的不挂载闸互为冗余)。 */
export function registerOpsRoutes(app: express.Express, deps: OpsDeps): void {
  assertNotProduction('观测台端点');

  // —— trace 只读快照:按 局/边界/结局/世系 过滤,回传版本化信封原样 ——
  // 输出前过一遍隐私哨兵(结构上本就装不下机密,此处是运行期自证):命中即拒绝输出。
  app.get('/api/ops/trace', (request, response) => {
    const q = request.query;
    const limit = clampInt(typeof q.limit === 'string' ? Number(q.limit) : NaN, 1, 1000, 200);
    const filtered = deps.sink.events().filter((event) => {
      const d = event.data;
      if (typeof q.gameId === 'string' && q.gameId !== '' && d.gameId !== q.gameId) return false;
      if (typeof q.boundary === 'string' && q.boundary !== '' && d.boundary !== q.boundary) return false;
      if (typeof q.outcome === 'string' && q.outcome !== '' && d.outcome !== q.outcome) return false;
      if (
        typeof q.correlationId === 'string' &&
        q.correlationId !== '' &&
        d.correlationId !== q.correlationId
      )
        return false;
      return true;
    });
    const events = filtered.slice(-limit);
    const secrets = scanTraceArtifacts(events);
    if (secrets.length > 0) {
      response.status(500).json({ error: '隐私哨兵拦截:trace 工件疑似含机密,已拒绝输出' });
      return;
    }
    response.json({ total: filtered.length, count: events.length, scanClean: true, events });
  });

  // —— 故障注入开关 ——
  app.get('/api/ops/faults', (_request, response) => {
    response.json(deps.faults.status());
  });

  app.post('/api/ops/faults', (request, response, next) => {
    try {
      const spec = faultInput.parse(request.body);
      deps.faults.arm(spec);
      response.status(201).json(deps.faults.status());
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/ops/faults', (_request, response) => {
    deps.faults.disarm();
    response.json(deps.faults.status());
  });

  // —— 进程内评测:确定性自博弈批(独立引擎 + 假模型,不触碰线上任何真实对局) ——
  // 同 seed 同批逐字节可复现;门禁失败不改 HTTP 状态(200 + gate.passed=false),由面板红牌呈现。
  app.post('/api/ops/eval', async (request, response, next) => {
    try {
      const input = evalInput.parse(request.body);
      const games = input.games ?? 8;
      const seed = input.seed ?? 1;
      const model: GameModel = input.demoFail ? new LeakyDescribeModel() : new FakeGameModel();
      const results = await runSelfPlayBatch(model, { games, seed });
      const { report, gate } = evaluateSelfPlay(results, {
        suite: input.demoFail ? 'ops-panel-demofail' : 'ops-panel',
        milestone: 'B3-current',
        thresholds: { ...DEFAULT_THRESHOLDS },
      });
      response.json({ games, seed, demoFail: input.demoFail === true, report, gate });
    } catch (error) {
      next(error);
    }
  });
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
