import 'dotenv/config';
import { DeepSeekClient, type GameModel, ModelError } from '../model.js';
import { GameEngine } from '../game-engine.js';
import type { AgentContext, GameReview, GameState, VoteTarget, PublicGameState } from '../types.js';

/**
 * 真机 demo:用真实 DeepSeek 跑一整局到终局,打印**脱敏**公开 transcript。
 *
 * 用途:现场投屏演示真机链路 + 为 DECISIONS §4「真实模型完整跑一局」留证据。
 * 运行:先在 packages/server-node/.env 填 DEEPSEEK_API_KEY,再
 *   cd packages/server-node && npx tsx server/tools/play-real-game.ts
 *
 * 约束:预算封顶(MODEL_CALL_BUDGET),人类由内置安全启发式代打(不泄词、投存活他人),
 * 输出前把所有玩家的秘密词替换为 ▢▢(终局揭示除外,单独在末尾脱敏打印)。
 */

const MODEL_CALL_BUDGET = 80;

class BudgetCappedModel implements GameModel {
  calls = 0;
  constructor(private readonly inner: GameModel) {}
  get model(): string {
    return this.inner.model;
  }
  isConfigured(): boolean {
    return this.inner.isConfigured();
  }
  private tick(kind: string): void {
    this.calls += 1;
    if (this.calls > MODEL_CALL_BUDGET) {
      throw new ModelError(`预算封顶:模型调用超过 ${MODEL_CALL_BUDGET} 次(${kind}),主动中止`);
    }
  }
  async describe(c: AgentContext): Promise<string> {
    this.tick('describe');
    return this.inner.describe(c);
  }
  async vote(c: AgentContext, t: VoteTarget[]): Promise<{ targetId: string; reason: string }> {
    this.tick('vote');
    return this.inner.vote(c, t);
  }
  async review(g: GameState): Promise<GameReview> {
    this.tick('review');
    return this.inner.review(g);
  }
}

/** 人类每轮的候选安全描述(通用、不含任何词,若撞质量门则换下一句)。 */
const HUMAN_LINES = [
  '我脑海里先浮现出一个日常的画面',
  '换个角度说,它给人的感觉挺具体',
  '我更在意它带来的那种氛围',
  '说点别人还没提到的侧面',
  '它让我联想到某个熟悉的场景',
  '从用途上想,它的定位挺清楚',
];

function redactor(words: string[]): (s: string) => string {
  const uniq = [...new Set(words.filter(Boolean))];
  return (s: string) => uniq.reduce((acc, w) => acc.split(w).join('▢▢'), s);
}

function printRound(state: PublicGameState, redact: (s: string) => string): void {
  const round = state.round;
  const descs = state.descriptions.filter((d) => d.round === round);
  if (descs.length === 0) return;
  const nameOf = new Map(state.players.map((p) => [p.id, p.name]));
  console.log(`\n—— 第 ${round} 轮 · 描述 ——`);
  for (const d of descs) {
    console.log(`  ${nameOf.get(d.playerId) ?? d.playerId}: ${redact(d.text)}`);
  }
  const votes = state.votes.filter((v) => v.round === round);
  if (votes.length > 0) {
    console.log(`  · 票型:`);
    for (const v of votes) {
      console.log(
        `    ${nameOf.get(v.voterId) ?? v.voterId} → ${nameOf.get(v.targetId) ?? v.targetId}(${redact(v.reason)})`,
      );
    }
  }
  const elim = state.events.find((e) => e.type === 'elimination' && e.round === round);
  if (elim) console.log(`  · ${redact(elim.text)}`);
}

async function main(): Promise<void> {
  const client = new DeepSeekClient();
  if (!client.isConfigured()) {
    console.error('未配置 DEEPSEEK_API_KEY —— 请先在 packages/server-node/.env 填写后重试。');
    process.exitCode = 1;
    return;
  }
  const model = new BudgetCappedModel(client);
  const engine = new GameEngine(model);
  let state = engine.createGame();
  const internal = engine.getInternalGame(state.id);
  const redact = redactor(internal.players.map((p) => p.word));

  console.log(`真机对局开始 · 模型标识 ${state.model} · gameId ${state.id.slice(0, 8)}…`);
  console.log(`你的身份(仅本地可见,已脱敏):角色 ${state.human.role} / 词 ▢▢`);

  let guard = 0;
  try {
    while (state.phase !== 'finished' && guard < 40) {
      guard += 1;
      const human = state.players.find((p) => p.isHuman)!;
      if (state.phase === 'describing') {
        if (human.alive) {
          state = await describeAsHuman(engine, state);
        } else {
          state = await engine.continueAsSpectator(state.id);
        }
      } else {
        if (human.alive) {
          const target = state.players.find((p) => !p.isHuman && p.alive)!;
          state = await engine.submitHumanVote(state.id, target.id);
        } else {
          state = await engine.continueAsSpectator(state.id);
        }
      }
    }
  } catch (error) {
    console.error(`\n对局中止:${error instanceof Error ? error.message : String(error)}`);
  }

  // 终局(或中止)后一次性打印完整 transcript,避免"某轮票型晚到"被漏印。
  const maxRound = Math.max(
    0,
    ...state.descriptions.map((d) => d.round),
    ...state.votes.map((v) => v.round),
  );
  for (let r = 1; r <= maxRound; r += 1) printRound({ ...state, round: r }, redact);

  if (state.phase === 'finished') {
    console.log(`\n===== 终局 =====`);
    console.log(`胜方:${state.winner === 'undercover' ? '卧底' : '平民'}`);
    console.log(`揭示(脱敏):`);
    for (const p of state.players) {
      const role = p.revealedRole === 'undercover' ? '卧底' : '平民';
      console.log(`  ${p.name}:${role} / 词 ▢▢${p.alive ? '' : '(已出局)'}`);
    }
    if (state.review) {
      console.log(`\n复盘 · ${redact(state.review.headline)}`);
      console.log(`  ${redact(state.review.summary)}`);
    }
  }
  console.log(`\n模型调用次数:${model.calls} / 预算 ${MODEL_CALL_BUDGET}`);
}

/** 人类描述:依次尝试候选安全句,撞质量门(整回合原子终止)则换下一句重开该命令。 */
async function describeAsHuman(engine: GameEngine, state: PublicGameState): Promise<PublicGameState> {
  let lastError: unknown;
  for (const line of HUMAN_LINES) {
    try {
      return await engine.submitHumanDescription(state.id, line);
    } catch (error) {
      lastError = error; // 该轮已原子回滚,可安全换句重试
    }
  }
  throw lastError instanceof Error ? lastError : new Error('人类描述反复失败');
}

void main();
