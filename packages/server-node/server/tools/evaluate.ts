import 'dotenv/config';
import { FakeGameModel } from '../test-utils.js';
import type { GameModel } from '../model.js';
import type { AgentContext } from '../types.js';
import { runSelfPlayBatch } from '../eval/self-play.js';
import { DEFAULT_THRESHOLDS, type GateThresholds, evaluateSelfPlay } from '../eval/report.js';

/**
 * 批量评测 CLI(OpenSpec 04 · Task 1.2 / 2.2 / 2.3)——「一条命令跑多局,输出可对比指标」。
 *
 *   cd packages/server-node && npx tsx server/tools/evaluate.ts [--games N] [--seed S]
 *     [--suite NAME] [--milestone M] [--min-completion x] [--min-diversity x]
 *     [--min-distinguish x] [--min-belief-hit x] [--demo-fail] [--json]
 *
 * 默认 fixture 模式(确定性假模型),同 seed 同批**逐字节可复现**;门禁在泄题/非法动作/
 * 未完成/隐私哨兵/阈值突破任一命中时以**非零退出**。`--demo-fail` 注入一个必然泄题的模型,
 * 触发质量穷尽→整回合原子终止→完成率门捕获,现场演示「门禁真的会红」。
 */

interface CliOptions {
  games: number;
  seed: number;
  suite: string;
  milestone: string;
  thresholds: GateThresholds;
  demoFail: boolean;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    games: 8,
    seed: 1,
    suite: 'fixture-selfplay',
    milestone: 'B3-current',
    thresholds: { ...DEFAULT_THRESHOLDS },
    demoFail: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`参数 ${arg} 缺少取值`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--games':
        opts.games = Number(next());
        break;
      case '--seed':
        opts.seed = Number(next());
        break;
      case '--suite':
        opts.suite = next();
        break;
      case '--milestone':
        opts.milestone = next();
        break;
      case '--min-completion':
        opts.thresholds.minCompletionRate = Number(next());
        break;
      case '--min-diversity':
        opts.thresholds.minDiversityRate = Number(next());
        break;
      case '--min-distinguish':
        opts.thresholds.minStrategyDistinguishability = Number(next());
        break;
      case '--min-belief-hit':
        opts.thresholds.minBeliefHitRate = Number(next());
        break;
      case '--demo-fail':
        opts.demoFail = true;
        break;
      case '--json':
        opts.json = true;
        break;
      default:
        throw new Error(`未知参数:${arg}`);
    }
  }
  return opts;
}

/** 必然泄题的假模型:描述直接吐自身密词 → 质量门穷尽 → 整回合原子终止(仅供 --demo-fail)。 */
class LeakyDescribeModel extends FakeGameModel {
  async describe(context: AgentContext): Promise<string> {
    return context.identity.word; // 精确泄题,evaluateDescription 判 exact_leak,重试耗尽后抛错
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function printScorecard(
  report: ReturnType<typeof evaluateSelfPlay>['report'],
  gate: ReturnType<typeof evaluateSelfPlay>['gate'],
): void {
  const val = (key: string): number => report.data.metrics.find((m) => m.key === key)?.value ?? 0;
  const n = (key: string): number => report.data.metrics.find((m) => m.key === key)?.n ?? 0;
  console.log(`\n===== 评测记分卡 · ${report.data.suite} / ${report.data.milestone} =====`);
  console.log(`样本:${report.data.sampleSize} 局(fixture 确定性,逐字节可复现)\n`);

  console.log(`— 安全不变量(应恒 0)—`);
  console.log(`  泄题条数        ${val('leak_count')} / ${n('leak_count')} 条 AI 描述`);
  console.log(`  非法投票        ${val('illegal_vote_count')} / ${n('illegal_vote_count')} 张 AI 票`);

  console.log(`\n— 完成度 —`);
  console.log(`  完成率          ${pct(val('completion_rate'))} ±${pct(val('completion_rate_ci95'))}(n=${n('completion_rate')})`);
  console.log(`  平均轮数        ${val('mean_rounds').toFixed(2)}`);

  console.log(`\n— 差异化(反转 CH-2 的可测证据)—`);
  console.log(`  多样度          ${pct(val('diversity_rate'))}(同轮跨 AI 平均措辞距离,n=${n('diversity_rate')} 对)`);
  console.log(`  策略可区分率    ${pct(val('strategy_distinguishability'))} ±${pct(val('strategy_distinguishability_ci95'))}`);
  console.log(`  自我重复率      ${pct(val('self_repetition_rate'))}(越低越好,n=${n('self_repetition_rate')} 对)`);

  console.log(`\n— 信念校准(离线特征,永不回流 context)—`);
  console.log(`  最高怀疑命中率  ${pct(val('belief_hit_rate'))} ±${pct(val('belief_hit_rate_ci95'))}(n=${n('belief_hit_rate')} 名平民 AI)`);
  console.log(`  平均怀疑差      ${val('mean_suspicion_gap').toFixed(4)}(对真卧底 − 对他人)`);

  console.log(`\n— 角色结果 / 用量 —`);
  console.log(`  卧底胜率        ${pct(val('undercover_win_rate'))} · 平民胜率 ${pct(val('civilian_win_rate'))}`);
  console.log(`  模型调用总数    ${val('model_calls_total')} · 描述重试 ${val('describe_retries_total')}`);

  console.log(`\n===== 门禁 =====`);
  if (gate.passed) {
    console.log(`✅ 通过:五类门(泄题/非法/未完成/隐私哨兵/阈值)均未触发。`);
  } else {
    console.log(`❌ 失败(${gate.failures.length} 项)——process 将以非零退出:`);
    for (const f of gate.failures) console.log(`  · [${f.code}] ${f.detail}`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const model: GameModel = opts.demoFail ? new LeakyDescribeModel() : new FakeGameModel();

  const results = await runSelfPlayBatch(model, { games: opts.games, seed: opts.seed });
  const { report, gate } = evaluateSelfPlay(results, {
    suite: opts.demoFail ? `${opts.suite}-demofail` : opts.suite,
    milestone: opts.milestone,
    thresholds: opts.thresholds,
  });

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printScorecard(report, gate);
  }

  // 非零退出闭环:门禁失败即 exit 1(CI 可用;--demo-fail 现场演示门禁触发)。
  process.exitCode = gate.passed ? 0 : 1;
}

void main();
