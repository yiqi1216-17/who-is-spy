import { randomUUID } from 'node:crypto';
import { buildAgentContext } from './agent-context.js';
import type { GameModel } from './model.js';
import { type GameAction, canAct, canTransition } from './state-machine.js';
import { type QualityCode, evaluateDescription } from './quality-policy.js';
import { type HookFn, HookRegistry } from './hooks.js';
import { emptyBelief, observeRound } from './beliefs.js';
import { safeDigest } from './redaction.js';
import { runInGameScope } from './obs/game-scope.js';
import { type TraceSink, emitTrace, traceHookResults } from './obs/tracer.js';
import { type ReplayLog, buildReplayLog } from './replay/log.js';
import { type ReconstructedTimeline, reconstructTimeline } from './replay/replay.js';
import { toDatasetRecord } from './replay/dataset.js';
import type { Belief, TraceEvent, Versioned } from './schema.js';
import type {
  Description,
  GameReview,
  GameState,
  GodGameState,
  GodThought,
  Phase,
  Player,
  PublicGameState,
  Role,
  Vote,
  VoteTarget,
} from './types.js';
import { chooseWordPair } from './words.js';
import { strategyForAgent } from './strategies.js';
import {
  GameEventBus,
  projectEnvelopes,
  type EnvelopeListener,
  type StreamEnvelope,
} from './stream.js';
import { type HighlightReel, buildHighlights } from './highlights.js';

const AI_PROFILES = [
  { name: '阿序', avatar: '序', style: '谨慎观察' },
  { name: '弥生', avatar: '弥', style: '直觉敏锐' },
  { name: '老墨', avatar: '墨', style: '逻辑派' },
  { name: '小满', avatar: '满', style: '出其不意' },
] as const;

export class GameRuleError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'GameRuleError';
  }
}

/** 单个 AI 的描述反复不合规、重试耗尽时抛出。回合原子终止,不留半成品(保 CH-4)。 */
export class QualityExhaustedError extends GameRuleError {
  constructor(
    public readonly playerId: string,
    public readonly code: QualityCode,
    public readonly attempts: number,
  ) {
    super(`AI（${playerId}）连续 ${attempts} 次未能给出合规描述（${code}），本回合已安全终止`, 500);
    this.name = 'QualityExhaustedError';
  }
}

/** 单个 AI 描述的最大生成尝试次数:首次不合规后最多再纠正 (N-1) 次。 */
export const MAX_DESCRIBE_ATTEMPTS = 3;

/**
 * 引擎级可观测缝(OpenSpec 04 · §3)。**可选**:不注入则零发射、行为逐字节不变(向后兼容)。
 * 引擎负责模型装饰器看不到的两处边界——**决策纠偏**(质量拒稿,带 hash/length 指纹)与 **hook**;
 * 模型传输重试世系由 `TracedModel` 另在同一把 `sink` 上打点,合成统一世系。
 */
export interface EngineObservability {
  sink: TraceSink;
  /** 注入单调时钟(毫秒);提供则记 latencyMs,不提供则省略(fixture 逐字节稳定)。 */
  now?: () => number;
  /** 注入 correlationId 工厂;默认实例内单调计数,确定性、不依赖 randomUUID(呼应 04-G)。 */
  newCorrelationId?: () => string;
}

export class GameEngine {
  private readonly games = new Map<string, GameState>();
  /** 每局一条命令链:同一对局的命令串行执行,杜绝并发交错。 */
  private readonly chains = new Map<string, Promise<unknown>>();
  /**
   * 公开事件总线(OpenSpec 05-H · §3):命令**原子提交后**向该局 SSE 订阅者广播新增公开事件。
   * 只读呈现通道,与写路径正交;只承载公开 `GameEvent`,绝不发射 role/word/belief/私有 prompt。
   */
  private readonly bus = new GameEventBus();
  /** 观察者注册表:回合公开点向其发射脱敏公开投影(见 hooks.ts)。 */
  private readonly hooks = new HookRegistry();
  /**
   * 私有结构化信念:gameId → (agentId → Belief)。
   * 每个 AI Agent 一份,从公开描述确定性推导,**绝不进公开 DTO / 他人上下文 / 存盘**。
   * 独立于 GameState,故不随 structuredClone 草稿流动,也不被 toPublic 序列化。
   */
  private readonly beliefs = new Map<string, Map<string, Belief>>();

  /**
   * 上帝模式对局(全 AI 旁观)独立存储,与人类局的 `games` 完全隔离:
   * 不经 `/api/games` 出口,故不可能被当作 PublicGameState 取回而误揭身份。
   * `godThoughts` 保存每轮每个 agent 的内心 OS —— 只汇入上帝 DTO,绝不进他人上下文。
   */
  private readonly godGames = new Map<string, GameState>();
  private readonly godThoughts = new Map<string, GodThought[]>();

  /** 引擎级 correlationId 单调计数(仅在注入 obs 时启用)。 */
  private corr = 0;

  constructor(
    private readonly model: GameModel,
    private readonly random: () => number = Math.random,
    private readonly obs?: EngineObservability,
  ) {}

  /** 下一个 correlationId:优先用注入工厂,否则实例内单调 `eng-N`(确定性)。 */
  private nextCorrelationId(): string {
    return this.obs?.newCorrelationId?.() ?? `eng-${(this.corr += 1)}`;
  }

  /**
   * 在描述边界落一条脱敏 trace(仅在注入 obs 时)。被拒候选只带**不可逆指纹**
   * (policyCode 短码 + hash + length),**绝不落原文**;成功候选可由公开事件复放,无需在 trace 留文本。
   */
  private emitDescribeTrace(
    correlationId: string,
    round: number,
    playerId: string,
    attempt: number,
    outcome: TraceEvent['outcome'],
    started: number | undefined,
    extra?: { policyCode?: string; candidateHash?: string; candidateLength?: number },
  ): void {
    if (!this.obs) return;
    const fields: TraceEvent = {
      correlationId,
      round,
      boundary: 'model.describe',
      playerId,
      attempt,
      outcome,
    };
    if (extra?.policyCode !== undefined) fields.policyCode = extra.policyCode;
    if (extra?.candidateHash !== undefined) fields.candidateHash = extra.candidateHash;
    if (extra?.candidateLength !== undefined) fields.candidateLength = extra.candidateLength;
    if (started !== undefined && this.obs.now) {
      fields.latencyMs = Math.max(0, this.obs.now() - started);
    }
    emitTrace(this.obs.sink, fields);
  }

  /** 注册一个"回合已公开"观察者。返回注销函数。观察者只收公开投影,不能改变对局。 */
  registerRoundHook(name: string, fn: HookFn, opts?: { timeoutMs?: number }): () => void {
    return this.hooks.register('onRoundPublished', name, fn, opts);
  }

  /** 只读取某 Agent 的私有信念(供自检/测试);外部消费者拿不到、也不该拿到。 */
  getAgentBelief(gameId: string, agentId: string): Belief | undefined {
    return this.beliefs.get(gameId)?.get(agentId);
  }

  /**
   * 回合描述全部公开后,为每个存活 AI 私有地更新信念(OpenSpec 03 · Task 5.1)。
   * 输入只有本轮**公开**描述 (playerId, text);每个 Agent 独立 observeRound,互不读取他人信念。
   * 结果存入引擎私有 map,永不进入 GameState / 公开 DTO / 他人上下文。
   */
  private updateBeliefs(game: GameState): void {
    const roundDescriptions = game.descriptions
      .filter((d) => d.round === game.round)
      .map(({ playerId, text }) => ({ playerId, text }));
    if (roundDescriptions.length === 0) return;
    let store = this.beliefs.get(game.id);
    if (!store) {
      store = new Map<string, Belief>();
      this.beliefs.set(game.id, store);
    }
    for (const agent of game.players) {
      if (agent.isHuman || !agent.alive) continue;
      const prev = store.get(agent.id) ?? emptyBelief();
      store.set(
        agent.id,
        observeRound(prev, { round: game.round, selfId: agent.id, descriptions: roundDescriptions }),
      );
    }
  }

  /** 在回合描述全部公开后,向观察者发射脱敏公开投影;观察者失败/超时绝不影响对局。 */
  private async publishRound(game: GameState): Promise<void> {
    if (this.hooks.size('onRoundPublished') === 0) return;
    const projection = {
      hook: 'onRoundPublished' as const,
      round: game.round,
      public: {
        descriptions: game.descriptions
          .filter((d) => d.round === game.round)
          .map(({ playerId, text, round }) => ({ playerId, text, round })),
        eliminations: game.events
          .filter((event) => event.type === 'elimination')
          .map(({ text, round }) => ({ text, round })),
      },
    };
    try {
      const results = await this.hooks.emit('onRoundPublished', projection);
      // hook 边界世系:每个观察者的 outcome 映射成脱敏 trace(ok→accepted / timeout|error→error+短码);
      // hook 名字不入 trace(可能含观察者标识),只记结构化 outcome。
      if (this.obs) {
        traceHookResults(this.obs.sink, {
          correlationId: this.nextCorrelationId(),
          round: game.round,
          results,
        });
      }
    } catch {
      // 观察者层的任何异常都不回传主流程(投影已在注册表内校验/隔离)。
    }
  }

  /**
   * 每局守卫 + 原子提交(OpenSpec 03 · Task 5.6)。
   * - 串行:同一 id 的命令排队执行,后一条命令看到的是前一条**已提交**的状态。
   * - 原子:命令在一份 `structuredClone` 草稿上改动,**仅当成功**才整体写回;
   *   中途抛错则草稿丢弃,已提交状态原样保留(回滚),与 CH-4 失败原子性同源。
   */
  private withGame<T>(id: string, fn: (draft: GameState) => Promise<T>): Promise<T> {
    const run = (this.chains.get(id) ?? Promise.resolve()).then(async () => {
      const committed = this.requireGame(id);
      const priorEvents = committed.events.length;
      const draft = structuredClone(committed);
      // 对局作用域:命令体内(含模型调用/质量纠偏/hook)发射的 trace 自动归属本局(「哪一局」维度)。
      const result = await runInGameScope(id, () => fn(draft));
      this.games.set(id, draft); // 成功才提交
      // 单一 choke point:三条命令都经此原子提交,故在此处**提交后**广播新增公开事件即可覆盖全部写路径。
      // 仅当确有新增才发射;afterSeq = priorEvents-1 → 新信封 seq 从 priorEvents 起,与日志下标一致。
      if (draft.events.length > priorEvents) {
        this.bus.publish(id, projectEnvelopes(id, draft.events, priorEvents - 1));
      }
      return result;
    });
    // 记录命令链(吞掉错误,避免一条命令失败阻断后续),但把真实结果交回调用者。
    this.chains.set(id, run.then(() => undefined, () => undefined));
    return run;
  }

  createGame(): PublicGameState {
    const pair = chooseWordPair(this.random);
    const undercoverIndex = Math.floor(this.random() * 5);
    const swapWords = this.random() > 0.5;
    const civilianWord = pair[swapWords ? 1 : 0];
    const undercoverWord = pair[swapWords ? 0 : 1];
    const rawPlayers = [
      { name: '你', avatar: '你', isHuman: true },
      ...AI_PROFILES.map(({ name, avatar }) => ({ name, avatar, isHuman: false })),
    ];
    const players: Player[] = rawPlayers.map((profile, index) => {
      const role: Role = index === undercoverIndex ? 'undercover' : 'civilian';
      return {
        id: index === 0 ? 'human' : `ai-${index}`,
        ...profile,
        role,
        word: role === 'undercover' ? undercoverWord : civilianWord,
        alive: true,
      };
    });
    const id = randomUUID();
    const game: GameState = {
      id,
      phase: 'describing',
      round: 1,
      ballot: 1,
      players,
      descriptions: [],
      votes: [],
      events: [
        {
          id: randomUUID(),
          type: 'system',
          text: '密词已发放。请用一句话描述它，但不要直接说出答案。',
          round: 1,
        },
      ],
      eligibleTargetIds: null,
      winner: null,
      review: null,
      createdAt: Date.now(),
    };
    this.games.set(id, game);
    return this.toPublic(game);
  }

  getGame(id: string): PublicGameState {
    return this.toPublic(this.requireGame(id));
  }

  getInternalGame(id: string): GameState {
    return this.requireGame(id);
  }

  /**
   * 订阅某局公开事件流(SSE 用):listener 只接**新增**信封(提交后广播)。返回取消订阅句柄。
   * 不存在的对局按 `requireGame` 抛 404,与其余读端点语义一致。
   */
  onGameEvents(id: string, listener: EnvelopeListener): () => void {
    this.requireGame(id);
    return this.bus.subscribe(id, listener);
  }

  /**
   * 追平(catch-up):取该局自 `afterSeq`(不含)以来的全部公开信封 —— 首连全量 / 重连补发。
   * seq 恒等于事件下标,故与 `GET` 的 `events` 同尺;订阅前先追平即可零缝衔接实时广播。
   */
  catchUpEnvelopes(id: string, afterSeq: number): StreamEnvelope[] {
    return projectEnvelopes(id, this.requireGame(id).events, afterSeq);
  }

  /**
   * 回放日志(OpenSpec 04 · §5.1):把有序公开事件折成带单调 ID + 链式校验和的日志。
   * 只读、纯函数派生 —— 引擎内部 randomUUID 事件 id 被丢弃,故日志逐字节稳定、可离线校验。
   */
  getReplayLog(id: string): ReplayLog {
    const game = this.requireGame(id);
    return buildReplayLog(game.id, game.events);
  }

  /**
   * 重建公开决策时间线(§5.1 / §3.3 accepted 侧):先过完整性四关,再从事件折出时间线。
   * **不重跑模型**(重建函数无模型参数)——被拒私有候选不在事件里,天然只复放已接受的公开动作。
   */
  reconstructReplay(id: string): ReconstructedTimeline {
    return reconstructTimeline(this.getReplayLog(id));
  }

  /**
   * 高光时刻(OpenSpec 05-H · 任务 5.3/5.4 · design 决策 8):确定性检测 → 忠实性闸 → 排名成束。
   *
   * **终局门禁(任务 5.2)**:终局揭晓前一律返回 `{ available:false, cards:[] }` ——
   * 检测器需读终局身份(谁是卧底/是否指对)才能提名,故未终局不解锁任何时刻。
   * `revealSpoilers` 仅在终局路径可为 true,且身份/密词/结构化信念增量只落在 spoiler 层;
   * 默认卡片结构上不含 role/word。信念快照取自私有 beliefs(无自由文本 CoT),仅随 spoiler 附出。
   */
  getHighlights(id: string, revealSpoilers = false): HighlightReel {
    const game = this.requireGame(id);
    if (game.phase !== 'finished') return { available: false, cards: [] };
    return buildHighlights(
      {
        players: game.players,
        descriptions: game.descriptions,
        votes: game.votes,
        events: game.events,
        beliefs: this.beliefs.get(id),
      },
      { revealSpoilers },
    );
  }

  /**
   * 数据记录导出(§5 数据记录侧):投影成假名化、无密词、来源分离的 `datasetRecord`。
   * **服务端专用**(含 role 终局标签)——不经 HTTP 下发,避免终局前泄身份。
   */
  exportDataset(
    id: string,
    provenance: 'human' | 'transfer' | 'synthetic',
    license?: string,
  ): Versioned<'datasetRecord'> {
    return toDatasetRecord(this.requireGame(id), provenance, license);
  }

  async submitHumanDescription(id: string, text: string): Promise<PublicGameState> {
    return this.withGame(id, (game) => this.describeCommand(game, text));
  }

  private async describeCommand(game: GameState, text: string): Promise<PublicGameState> {
    this.assertAction(game, 'describe');
    const human = this.human(game);
    if (!human.alive) throw new GameRuleError('你已出局，请继续观战');
    const description = normalizeText(text);
    if (description.length < 2 || description.length > 60) {
      throw new GameRuleError('描述需为 2–60 个字符');
    }
    if (description.includes(human.word)) {
      throw new GameRuleError('不能直接说出你的秘密词');
    }
    if (game.descriptions.some((item) => item.round === game.round && item.playerId === human.id)) {
      throw new GameRuleError('本轮已经描述过了');
    }

    const humanDescription = { playerId: human.id, text: description, round: game.round };
    const contextGame = { ...game, descriptions: [...game.descriptions, humanDescription] };
    const aiDescriptions = await this.generateDescriptions(contextGame);
    const roundDescriptions: Description[] = [humanDescription, ...aiDescriptions];
    game.descriptions.push(...roundDescriptions);
    game.events.push(
      ...roundDescriptions.map((item) => ({
        id: randomUUID(),
        type: 'description' as const,
        text: item.text,
        round: game.round,
        playerId: item.playerId,
      })),
    );
    this.transitionTo(game, 'voting');
    game.ballot = 1;
    game.eligibleTargetIds = null;
    game.events.push({
      id: randomUUID(),
      type: 'system',
      text: '所有人描述完毕。观察措辞，投出你最怀疑的一票。',
      round: game.round,
    });
    this.updateBeliefs(game);
    await this.publishRound(game);
    return this.toPublic(game);
  }

  async submitHumanVote(id: string, targetId: string): Promise<PublicGameState> {
    return this.withGame(id, (game) => this.voteCommand(game, targetId));
  }

  private async voteCommand(game: GameState, targetId: string): Promise<PublicGameState> {
    this.assertAction(game, 'vote');
    const human = this.human(game);
    if (!human.alive) throw new GameRuleError('你已出局，请继续观战');
    this.validateVoteTarget(game, human, targetId);

    const aiVotes = await this.generateVotes(game);
    const target = game.players.find((player) => player.id === targetId)!;
    const roundVotes: Vote[] = [
      {
        voterId: human.id,
        targetId,
        reason: `我认为 ${target.name} 的描述最可疑`,
        round: game.round,
        ballot: game.ballot,
      },
      ...aiVotes,
    ];
    game.votes.push(...roundVotes);
    await this.resolveBallot(game, roundVotes);
    return this.toPublic(game);
  }

  async continueAsSpectator(id: string): Promise<PublicGameState> {
    return this.withGame(id, (game) => this.spectateCommand(game));
  }

  private async spectateCommand(game: GameState): Promise<PublicGameState> {
    if (this.human(game).alive) throw new GameRuleError('你仍在场上，请亲自完成行动');
    if (game.phase === 'finished') return this.toPublic(game);

    let safety = 0;
    while (!this.isFinished(game) && safety < 12) {
      safety += 1;
      if (game.phase === 'describing') {
        const descriptions = await this.generateDescriptions(game);
        game.descriptions.push(...descriptions);
        game.events.push(
          ...descriptions.map((item) => ({
            id: randomUUID(),
            type: 'description' as const,
            text: item.text,
            round: game.round,
            playerId: item.playerId,
          })),
        );
        this.transitionTo(game, 'voting');
        game.ballot = 1;
        game.eligibleTargetIds = null;
        this.updateBeliefs(game);
        await this.publishRound(game);
      } else {
        const votes = await this.generateVotes(game);
        game.votes.push(...votes);
        await this.resolveBallot(game, votes);
      }
    }
    if (safety >= 12 && !this.isFinished(game)) {
      throw new GameRuleError('自动对局轮次异常，请重新开局', 500);
    }
    return this.toPublic(game);
  }

  // ——————————————————————————————————————————————————————————————————————
  // 上帝模式(附加能力):一桌全 AI 旁观对局 + 内心 OS。
  // 走独立端点(/api/god-games)与独立 DTO(GodGameState),**绝不**触碰冻结契约的
  // /api/games 与 PublicGameState;隔离不变量照旧——每个 agent 内部仍只经
  // buildAgentContext 拿到自己的身份/词,内心 OS 只汇入上帝 DTO,绝不进他人上下文、绝不落盘。
  // ——————————————————————————————————————————————————————————————————————

  /**
   * 创建并**一次性推进到终局**的全 AI 上帝局(呼应 continueAsSpectator 的整段解算):
   * 4 个 agent(复用四种策略人设,1 名卧底)自动描述/投票,逐轮采集每个 agent 的内心 OS。
   * 复用 generateVotes / resolveBallot / checkWinner / createReview —— 裁决逻辑单一来源,零漂移。
   */
  async createGodGame(): Promise<GodGameState> {
    const game = this.buildGodGame();
    const thoughts: GodThought[] = [];
    let safety = 0;
    while (!this.isFinished(game) && safety < 12) {
      safety += 1;
      if (game.phase === 'describing') {
        const produced: Description[] = [];
        // 确定性座次串行:后发 agent 能读到本轮已公开的先发描述(与人类局同源)。
        for (const agent of game.players.filter((player) => player.alive)) {
          const visible = [...game.descriptions, ...produced];
          const contextGame: GameState = { ...game, descriptions: visible };
          const { text, thought } = await runInGameScope(game.id, () =>
            this.gatedDescribe(contextGame, agent, visible, true),
          );
          produced.push({ playerId: agent.id, text, round: game.round });
          if (thought) thoughts.push({ round: game.round, playerId: agent.id, text: thought });
        }
        game.descriptions.push(...produced);
        game.events.push(
          ...produced.map((item) => ({
            id: randomUUID(),
            type: 'description' as const,
            text: item.text,
            round: game.round,
            playerId: item.playerId,
          })),
        );
        this.transitionTo(game, 'voting');
        game.ballot = 1;
        game.eligibleTargetIds = null;
      } else {
        const votes = await runInGameScope(game.id, () => this.generateVotes(game));
        game.votes.push(...votes);
        await runInGameScope(game.id, () => this.resolveBallot(game, votes));
      }
    }
    if (safety >= 12 && !this.isFinished(game)) {
      throw new GameRuleError('上帝对局轮次异常，请重开', 500);
    }
    this.godGames.set(game.id, game);
    this.godThoughts.set(game.id, thoughts);
    return this.toPublicGod(game, thoughts);
  }

  getGodGame(id: string): GodGameState {
    const game = this.godGames.get(id);
    const thoughts = this.godThoughts.get(id);
    if (!game || !thoughts) throw new GameRuleError('上帝对局不存在或已过期', 404);
    return this.toPublicGod(game, thoughts);
  }

  /** 组建一桌全 AI(4 席)上帝局:复用词库与四种策略座次;确定性地放入 1 名卧底。 */
  private buildGodGame(): GameState {
    const pair = chooseWordPair(this.random);
    const undercoverIndex = Math.floor(this.random() * AI_PROFILES.length);
    const swapWords = this.random() > 0.5;
    const civilianWord = pair[swapWords ? 1 : 0];
    const undercoverWord = pair[swapWords ? 0 : 1];
    const players: Player[] = AI_PROFILES.map((profile, index) => {
      const role: Role = index === undercoverIndex ? 'undercover' : 'civilian';
      return {
        id: `ai-${index + 1}`,
        name: profile.name,
        avatar: profile.avatar,
        isHuman: false,
        role,
        word: role === 'undercover' ? undercoverWord : civilianWord,
        alive: true,
      };
    });
    return {
      id: randomUUID(),
      phase: 'describing',
      round: 1,
      ballot: 1,
      players,
      descriptions: [],
      votes: [],
      events: [
        {
          id: randomUUID(),
          type: 'system',
          text: '密词已发放。四位 agent 将依次描述——上帝能看见他们各自的内心。',
          round: 1,
        },
      ],
      eligibleTargetIds: null,
      winner: null,
      review: null,
      createdAt: Date.now(),
    };
  }

  /** 上帝投影:旁观者看得见全部身份/词/策略与内心 OS(这正是上帝模式的意义所在)。 */
  private toPublicGod(game: GameState, thoughts: GodThought[]): GodGameState {
    return {
      id: game.id,
      phase: game.phase,
      round: game.round,
      ballot: game.ballot,
      players: game.players.map((player) => ({
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        alive: player.alive,
        role: player.role,
        word: player.word,
        strategy: strategyForAgent(player),
      })),
      descriptions: game.descriptions,
      votes: game.votes,
      events: game.events,
      thoughts,
      winner: game.winner,
      review: game.review,
      model: this.model.model,
    };
  }

  private async generateDescriptions(game: GameState): Promise<Description[]> {
    const agents = game.players.filter((player) => !player.isHuman && player.alive);
    // 确定性座次串行:每个后发 Agent 都能看到本轮已公开的先发描述(人类 + 更早座次的 AI),
    // 同时仍只经 buildAgentContext 的允许列投影,读不到他人身份与词(反转 CH-1,保持隔离)。
    const produced: Description[] = [];
    for (const agent of agents) {
      const visible = [...game.descriptions, ...produced];
      const contextGame: GameState = { ...game, descriptions: visible };
      const text = await this.describeWithQualityGate(contextGame, agent, visible);
      produced.push({ playerId: agent.id, text, round: game.round });
    }
    return produced;
  }

  /**
   * 在生成边界应用共享质量策略:有界重试(correction)→ 穷尽即抛错(exhaustion)。
   * 策略是纯函数、模型无关;引擎只负责重试与原子终止,不改判定逻辑(反转 CH-3)。
   */
  private async describeWithQualityGate(
    contextGame: GameState,
    agent: Player,
    visible: Description[],
  ): Promise<string> {
    return (await this.gatedDescribe(contextGame, agent, visible, false)).text;
  }

  /**
   * 共享质量门:有界重试(correction)→ 穷尽即抛错(exhaustion);策略是纯函数、模型无关。
   * `wantThought` 为真时走 `describeWithThought` 额外取回内心 OS(上帝模式);其余判定、trace
   * 世系与人类局**逐字节一致**——单一实现,零逻辑漂移(反转 CH-3)。
   */
  private async gatedDescribe(
    contextGame: GameState,
    agent: Player,
    visible: Description[],
    wantThought: boolean,
  ): Promise<{ text: string; thought: string }> {
    // 同轮他人描述 → 同质判定;本 Agent 更早轮次自述 → 自我重复判定。
    const priorPublicTexts = visible
      .filter((d) => d.round === contextGame.round && d.playerId !== agent.id)
      .map((d) => d.text);
    const ownPriorTexts = visible
      .filter((d) => d.round < contextGame.round && d.playerId === agent.id)
      .map((d) => d.text);

    // 决策纠偏世系:同一 correlationId 贯穿本 Agent 本轮的多次质量尝试(与传输重试世系区分而互补)。
    const correlationId = this.nextCorrelationId();
    let lastCode: QualityCode = 'too_short';
    for (let attempt = 1; attempt <= MAX_DESCRIBE_ATTEMPTS; attempt += 1) {
      const started = this.obs?.now?.();
      const context = buildAgentContext(contextGame, agent);
      // 上帝模式取回 {text, thought};人类局仍走原 describe(thought 恒为空),行为不变。
      const { text, thought } =
        wantThought && this.model.describeWithThought
          ? await this.model.describeWithThought(context)
          : { text: await this.model.describe(context), thought: '' };
      const verdict = evaluateDescription({
        text,
        secretWord: agent.word,
        priorPublicTexts,
        ownPriorTexts,
      });
      if (verdict.ok) {
        // 被接受:公开动作可由事件复放,trace 不留文本(design.md §5)。
        this.emitDescribeTrace(correlationId, contextGame.round, agent.id, attempt, 'accepted', started);
        return { text, thought };
      }
      // 被拒私有候选:只留不可逆指纹 + 质量短码(§3.3),原文即刻丢弃、绝不入 trace。
      const digest = safeDigest(text);
      this.emitDescribeTrace(correlationId, contextGame.round, agent.id, attempt, 'rejected', started, {
        policyCode: verdict.code,
        candidateHash: digest.hash,
        candidateLength: digest.length,
      });
      lastCode = verdict.code;
    }
    throw new QualityExhaustedError(agent.id, lastCode, MAX_DESCRIBE_ATTEMPTS);
  }

  private async generateVotes(game: GameState): Promise<Vote[]> {
    const voters = game.players.filter((player) => !player.isHuman && player.alive);
    return Promise.all(
      voters.map(async (voter) => {
        const allowed = this.allowedTargets(game, voter);
        // 隐私(M 边界):只把非机密投影(id/name/isHuman/alive)交给模型——role/word
        // 结构上无法随 allowedTargets 越界,不再依赖适配器自觉剥离(独立评审 ①×M 的结构性封堵)。
        const allowedView: VoteTarget[] = allowed.map(({ id, name, isHuman, alive }) => ({
          id,
          name,
          isHuman,
          alive,
        }));
        const result = await this.model.vote(buildAgentContext(game, voter), allowedView);
        // 授权:目标合法性由确定性代码裁决,不信任模型返回值——越界/已出局/自投一律
        // 回落到确定性首选合法目标,杜绝 resolveBallot 误淘汰已出局者的状态腐坏。
        const targetId = allowed.some((p) => p.id === result.targetId)
          ? result.targetId
          : allowed[0].id;
        return {
          voterId: voter.id,
          targetId,
          reason: result.reason,
          round: game.round,
          ballot: game.ballot,
        };
      }),
    );
  }

  private async resolveBallot(game: GameState, votes: Vote[]): Promise<void> {
    const counts = new Map<string, number>();
    for (const vote of votes) counts.set(vote.targetId, (counts.get(vote.targetId) ?? 0) + 1);
    const maxVotes = Math.max(...counts.values());
    const leaders = [...counts.entries()].filter(([, count]) => count === maxVotes).map(([id]) => id);

    if (leaders.length > 1 && game.ballot < 2) {
      game.ballot += 1;
      game.eligibleTargetIds = leaders;
      const names = leaders.map((id) => game.players.find((player) => player.id === id)?.name).join('、');
      game.events.push({
        id: randomUUID(),
        type: 'vote_result',
        text: `${names} 同票，进入最终加票。`,
        round: game.round,
      });
      return;
    }

    const eliminatedId = leaders.length === 1 ? leaders[0] : leaders[Math.floor(this.random() * leaders.length)];
    const eliminated = game.players.find((player) => player.id === eliminatedId);
    if (!eliminated) throw new GameRuleError('投票结果无效', 500);
    eliminated.alive = false;
    game.eligibleTargetIds = null;
    game.events.push({
      id: randomUUID(),
      type: 'elimination',
      text: `${eliminated.name} 被投出局。身份将在终局揭晓。`,
      round: game.round,
      playerId: eliminated.id,
    });

    const winner = this.checkWinner(game);
    if (winner) {
      game.winner = winner;
      this.transitionTo(game, 'finished');
      game.review = await this.createReview(game);
      return;
    }

    game.round += 1;
    game.ballot = 1;
    this.transitionTo(game, 'describing');
    game.events.push({
      id: randomUUID(),
      type: 'system',
      text: `第 ${game.round} 轮开始。换个角度描述，别让身份暴露。`,
      round: game.round,
    });
  }

  private checkWinner(game: GameState): Role | null {
    const alive = game.players.filter((player) => player.alive);
    const undercoverAlive = alive.filter((player) => player.role === 'undercover').length;
    if (undercoverAlive === 0) return 'civilian';
    if (undercoverAlive >= alive.length - undercoverAlive) return 'undercover';
    return null;
  }

  private async createReview(game: GameState): Promise<GameReview> {
    try {
      return await this.model.review(game);
    } catch {
      const undercover = game.players.find((player) => player.role === 'undercover')!;
      return {
        headline: game.winner === 'civilian' ? '平民锁定了那处微妙偏差' : '卧底把相似性利用到了最后',
        summary: `${undercover.name} 拿到的是“${undercover.word}”，其余玩家拿到“${game.players.find((p) => p.role === 'civilian')!.word}”。本局共进行了 ${game.round} 轮，胜负来自描述细节与投票联盟的共同变化。`,
        turningPoints: ['终局票型决定了阵营胜负；可展开每轮记录回看判断依据。'],
        playerInsights: game.players.map((player) => ({
          playerId: player.id,
          insight: `${player.name} 以“${player.word}”为出发点完成了本局表达与判断。`,
        })),
      };
    }
  }

  private allowedTargets(game: GameState, voter: Player): Player[] {
    const eligible = game.eligibleTargetIds ? new Set(game.eligibleTargetIds) : null;
    const targets = game.players.filter(
      (player) => player.alive && player.id !== voter.id && (!eligible || eligible.has(player.id)),
    );
    if (targets.length === 0) throw new GameRuleError(`${voter.name} 没有可投票目标`, 500);
    return targets;
  }

  private validateVoteTarget(game: GameState, voter: Player, targetId: string): void {
    if (!this.allowedTargets(game, voter).some((player) => player.id === targetId)) {
      throw new GameRuleError('请选择一名有效的存活玩家');
    }
  }

  private toPublic(game: GameState): PublicGameState {
    const finished = game.phase === 'finished';
    const human = this.human(game);
    return {
      id: game.id,
      phase: game.phase,
      round: game.round,
      ballot: game.ballot,
      players: game.players.map(({ id, name, avatar, isHuman, alive, role, word }) => ({
        id,
        name,
        avatar,
        isHuman,
        alive,
        ...(finished ? { revealedRole: role, revealedWord: word } : {}),
      })),
      descriptions: game.descriptions,
      votes: game.votes,
      events: game.events,
      eligibleTargetIds: game.eligibleTargetIds,
      winner: game.winner,
      review: game.review,
      human: { playerId: human.id, role: human.role, word: human.word },
      model: this.model.model,
    };
  }

  private requireGame(id: string): GameState {
    const game = this.games.get(id);
    if (!game) throw new GameRuleError('对局不存在或已过期', 404);
    return game;
  }

  private human(game: GameState): Player {
    return game.players.find((player) => player.isHuman)!;
  }

  /** 动作合法性经域状态机判定;非法动作复用原有阶段错误文案(HTTP 400)。 */
  private assertAction(game: GameState, action: GameAction): void {
    if (!canAct(game.phase, action)) {
      throw new GameRuleError(`当前不在${action === 'describe' ? '描述' : '投票'}阶段`);
    }
  }

  /** 所有相位切换的唯一入口:非法转移即引擎不变量被破坏(HTTP 500)。 */
  private transitionTo(game: GameState, next: Phase): void {
    if (!canTransition(game.phase, next)) {
      throw new GameRuleError(`非法相位转移: ${game.phase} → ${next}`, 500);
    }
    game.phase = next;
  }

  private isFinished(game: GameState): boolean {
    return game.phase === 'finished';
  }
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}
