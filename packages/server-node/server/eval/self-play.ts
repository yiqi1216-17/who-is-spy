import { GameEngine, GameRuleError } from '../game-engine.js';
import type { GameModel } from '../model.js';
import type { Belief } from '../schema.js';
import type { AgentContext, GameReview, GameState, PublicGameState, VoteTarget } from '../types.js';

/**
 * 无头自博弈 harness(OpenSpec 04 · Task 1.2 / 1.3 · MED「无 headless 全 AI 入口」)
 *
 * 评测的前置:要在**一条命令**里批量跑多局,就不能有交互式人类在环。但引擎的 `createGame`
 * 按题目设定把人类硬编码在 seat0(不改核心规则),所以本 harness 用一个**确定性、安全**的
 * 脚本策略驱动人类座位——它只是把 seat0 当作第 5 个确定性 bot,**不触碰任何引擎规则**:
 *   - describe 只吐轮换的安全句(对全部 24 个候选密词都不含子串,恒过引擎的字面泄题检查);
 *   - vote 恒投「首个合法的存活 AI」(平票复投时投首个合法 eligible 目标),完全确定。
 * 评测指标只在 4 个**模型驱动**的 AI 座位上计算——人类座位是确定性陪跑,不进指标分子。
 *
 * 复现性:整批共享一条 `mulberry32(seed)` 伪随机流(驱动词对/卧底位/换词/平票裁决)。
 * 一条流跨多局**顺序推进**:每局 `createGame` 消耗若干抽样 → 局与局各异(覆盖不同角色/座位/
 * 词对/终局),但**同 seed 同批次逐字节可复现**(Task 1.2 byte-stable 的根)。
 */

/** mulberry32:32 位种子 → [0,1) 确定性伪随机;分布良好、可复现,替代 `Math.random`。 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 每局的模型调用计数(usage / retries 指标之源)。retries 由「调用数 − 落地描述数」推导。 */
export interface ModelCallCounts {
  describeCalls: number;
  voteCalls: number;
  reviewCalls: number;
}

/**
 * 计数装饰器:在模型边界记录调用次数,供 usage/retries 指标使用。
 * 只计数、不改行为、不测时延(fixture 报告要逐字节稳定,墙钟时延留给真机模式单列)。
 */
export class CountingModel implements GameModel {
  describeCalls = 0;
  voteCalls = 0;
  reviewCalls = 0;
  constructor(private readonly inner: GameModel) {}
  get model(): string {
    return this.inner.model;
  }
  isConfigured(): boolean {
    return this.inner.isConfigured();
  }
  reset(): void {
    this.describeCalls = 0;
    this.voteCalls = 0;
    this.reviewCalls = 0;
  }
  counts(): ModelCallCounts {
    return {
      describeCalls: this.describeCalls,
      voteCalls: this.voteCalls,
      reviewCalls: this.reviewCalls,
    };
  }
  async describe(context: AgentContext): Promise<string> {
    this.describeCalls += 1;
    return this.inner.describe(context);
  }
  async vote(
    context: AgentContext,
    allowed: VoteTarget[],
  ): Promise<{ targetId: string; reason: string }> {
    this.voteCalls += 1;
    return this.inner.vote(context, allowed);
  }
  async review(game: GameState): Promise<GameReview> {
    this.reviewCalls += 1;
    return this.inner.review(game);
  }
}

/** 人类座位的脚本策略:纯确定性,不含任何密词。给 harness 当第 5 个陪跑 bot。 */
export interface HumanSeatPolicy {
  describe(state: PublicGameState, round: number): string;
  vote(state: PublicGameState): string;
}

/**
 * 安全轮换句:对 `words.ts` 全部 24 个候选密词均不含子串,故恒过引擎 `describeCommand`
 * 的字面泄题检查(引擎对人类只做字面子串判定);长度 2–60。按轮次轮换,措辞各异。
 */
const SAFE_HUMAN_LINES = [
  '这个东西我算熟悉，先抛块砖引引路',
  '日常里偶尔会打交道，说不上稀罕',
  '给我的印象比较温和，不张扬',
  '我先给个大方向，看看大家怎么接',
  '需要亲手体会才有感觉的那一类',
  '常出现在几个人凑一起的场合',
] as const;

/** 确定性人类座位:轮换安全句、投首个合法存活 AI(平票时投首个合法 eligible)。 */
export const deterministicSafeHuman: HumanSeatPolicy = {
  describe(_state, round) {
    return SAFE_HUMAN_LINES[(round - 1) % SAFE_HUMAN_LINES.length];
  },
  vote(state) {
    const eligible = state.eligibleTargetIds;
    const pool = eligible
      ? state.players.filter((p) => eligible.includes(p.id))
      : state.players.filter((p) => p.alive && !p.isHuman);
    const pick =
      pool.find((p) => p.alive && !p.isHuman) ?? pool.find((p) => p.alive && p.id !== 'human');
    if (!pick) throw new GameRuleError('自博弈:人类座位无合法投票目标', 500);
    return pick.id;
  },
};

/** 单局自博弈结果快照:内部对局(含 role/word,仅供离线指标)+ 各 AI 最终私有信念 + 调用计数。 */
export interface SelfPlayResult {
  gameId: string;
  /** 内部 GameState 的深拷贝快照:承载 role/word/descriptions/votes/winner,只离线打分用。 */
  internal: GameState;
  /** aiId → 该 AI 终局时的私有信念(校准指标之源);人类无信念。 */
  beliefs: Record<string, Belief>;
  /** 本局模型调用计数。 */
  calls: ModelCallCounts;
  /** 是否打到终局。false 表示被质量穷尽/规则错误原子终止(CH-4),用于 completion 门。 */
  completed: boolean;
  /** 原子终止时的信号码(如 QualityExhaustedError 的 policyCode);正常收局为 undefined。 */
  abortCode?: string;
}

/** 驱动单局到终局(或原子终止)。人类座位由确定性策略陪跑,4 AI 由 `model` 驱动。 */
export async function playSelfPlayGame(
  engine: GameEngine,
  policy: HumanSeatPolicy = deterministicSafeHuman,
): Promise<SelfPlayResult> {
  const created = engine.createGame();
  const gameId = created.id;
  let state: PublicGameState = created;
  let completed = true;
  let abortCode: string | undefined;

  try {
    let guard = 0;
    while (state.phase !== 'finished' && guard < 64) {
      guard += 1;
      const human = state.players.find((p) => p.isHuman);
      if (human && !human.alive) {
        state = await engine.continueAsSpectator(gameId);
        continue;
      }
      if (state.phase === 'describing') {
        state = await engine.submitHumanDescription(gameId, policy.describe(state, state.round));
      } else {
        state = await engine.submitHumanVote(gameId, policy.vote(state));
      }
    }
    if (state.phase !== 'finished') {
      completed = false;
      abortCode = 'nonterminating';
    }
  } catch (err) {
    // 质量穷尽 / 规则错误 → 引擎已原子回滚(CH-4)。评测记为「未完成」,让 completion 门捕获。
    completed = false;
    abortCode =
      err instanceof GameRuleError
        ? // QualityExhaustedError 携带 policyCode,其余 GameRuleError 记通用码。
          ((err as { code?: string }).code ?? classifyRuleError(err))
        : 'unknown';
  }

  const internal = structuredClone(engine.getInternalGame(gameId));
  const beliefs: Record<string, Belief> = {};
  for (const p of internal.players) {
    if (p.isHuman) continue;
    const belief = engine.getAgentBelief(gameId, p.id);
    if (belief) beliefs[p.id] = belief;
  }
  return { gameId, internal, beliefs, calls: { describeCalls: 0, voteCalls: 0, reviewCalls: 0 }, completed, abortCode };
}

function classifyRuleError(err: GameRuleError): string {
  return err.status >= 500 ? 'engine_abort' : 'rule_violation';
}

/** 批量自博弈的配置。 */
export interface SelfPlayBatchOptions {
  games: number;
  seed: number;
  policy?: HumanSeatPolicy;
}

/**
 * 批量自博弈:构造**一个**引擎(共享 `mulberry32(seed)` 流 + 计数模型),顺序跑 `games` 局。
 * 每局重置计数器得到**逐局**调用数;共享随机流保证同 seed 同批逐字节复现,又让局与局各异。
 */
export async function runSelfPlayBatch(
  model: GameModel,
  options: SelfPlayBatchOptions,
): Promise<SelfPlayResult[]> {
  const counting = new CountingModel(model);
  const engine = new GameEngine(counting, mulberry32(options.seed));
  const policy = options.policy ?? deterministicSafeHuman;
  const results: SelfPlayResult[] = [];
  for (let i = 0; i < options.games; i += 1) {
    counting.reset();
    const result = await playSelfPlayGame(engine, policy);
    result.calls = counting.counts();
    results.push(result);
  }
  return results;
}
