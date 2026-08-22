/**
 * 阵营胜率军备竞赛 CLI(OpenSpec 04 · 题面②「学了更强策略后,平民/卧底能不能更容易赢」)
 *
 * 用法(仓库根):
 *   npm run arms-race:node                                  # 默认四档,80 局/迭代,seed 7
 *   npm run arms-race:node -- --games 120 --seed 7          # 调整规模/种子
 *   npm run arms-race:node -- --log docs/evidence/04-arms-race.jsonl    # 落聚合胜率 JSONL
 *   npm run arms-race:node -- --report docs/evidence/04-arms-race.md    # 落 Markdown 分析报告
 *   npm run arms-race:node -- --trace docs/evidence/04-arms-race-trace.jsonl  # 落逐局逐轮 trace
 *   npm run arms-race:node -- --sample 1                    # stdout 打印每档抓/逃各一局完整复盘
 *   npm run arms-race:node -- --json                        # 机器可读整块 JSON
 *
 * 三种日志层次:①stdout 聚合摆动;②--log 聚合胜率 JSONL;③--trace 逐局逐轮(描述/离群度/
 * 投票/出局/终局)——回答「胜率是怎么打出来的」。--sample 把其中代表性对局打到 stdout。
 *
 * 退出码:未形成预期摆动(某步方向不符,或有未完局)→ **非零退出**(可作回归保护)。
 * 日志脱敏:落盘前对每一行 `scanSecrets`——trace 里词只以假名 wordTag 呈现、role 终局后揭示,
 * 密词结构上无从进入。这是双保险。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scanSecrets } from '../redaction.js';
import {
  defaultSkills,
  renderArmsRaceMarkdown,
  runArmsRace,
  toArmsRaceLogLines,
  toArmsRaceTraceLines,
  type ArmsRaceReport,
} from '../eval/arms-race.js';
import { renderGameTraceText } from '../eval/arms-race-trace.js';

interface CliOptions {
  games: number;
  seed: number;
  logPath?: string;
  reportPath?: string;
  tracePath?: string;
  sample: number;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { games: 80, seed: 7, sample: 0, json: false };
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
      case '--log':
        opts.logPath = next();
        break;
      case '--report':
        opts.reportPath = next();
        break;
      case '--trace':
        opts.tracePath = next();
        break;
      case '--sample':
        opts.sample = Number(next());
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

/** 人类可读的完整日志(stdout)。 */
function printLog(report: ArmsRaceReport): void {
  console.log(`\n=== 阵营胜率军备竞赛 · ${report.games} 局/迭代 · seed=${report.seed} ===\n`);
  for (const it of report.iterations) {
    console.log(`▸ [${it.skill.id}] ${it.skill.label}`);
    console.log(
      `    平民胜率 ${(it.civilianWinRate * 100).toFixed(1)}%   卧底胜率 ${(it.undercoverWinRate * 100).toFixed(1)}%   完局率 ${(it.completionRate * 100).toFixed(1)}%`,
    );
  }
  console.log('\n--- 逐步摆动(后 − 前) ---');
  for (const s of report.steps) {
    const flag = s.swungAsExpected ? '✓' : '✗';
    console.log(
      `  ${s.from} → ${s.to}  平民Δ=${(s.civilianDelta * 100).toFixed(1)}pp  卧底Δ=${(s.undercoverDelta * 100).toFixed(1)}pp  期望[${s.expected}] 实际[${s.actual}] ${flag}`,
    );
  }
  console.log(`\n军备竞赛裁决:${report.armsRaceHolds ? '✅ 三步摆动成立(civ↑→spy↑→civ↑)' : '⚠ 未完全成立'}\n`);
}

/** 落盘前脱敏校验:任一行命中机密即抛,拒绝写出。 */
function assertClean(lines: string[]): void {
  for (const line of lines) {
    const hits = scanSecrets(line);
    if (hits.length > 0) throw new Error(`日志行命中机密字面量,拒绝落盘:${hits.join(', ')}`);
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const { skills, expectations } = defaultSkills();
  const report = await runArmsRace(skills, expectations, opts.games, opts.seed);

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printLog(report);
  }

  if (opts.logPath) {
    const lines = toArmsRaceLogLines(report);
    assertClean(lines);
    mkdirSync(dirname(opts.logPath), { recursive: true });
    writeFileSync(opts.logPath, lines.join('\n') + '\n', 'utf8');
    console.log(`📝 运行日志(脱敏 JSONL)已写入 ${opts.logPath}(${lines.length} 行)`);
  }

  if (opts.reportPath) {
    const md = renderArmsRaceMarkdown(report);
    assertClean([md]);
    mkdirSync(dirname(opts.reportPath), { recursive: true });
    writeFileSync(opts.reportPath, md + '\n', 'utf8');
    console.log(`📄 分析报告(Markdown)已写入 ${opts.reportPath}`);
  }

  if (opts.tracePath) {
    const lines = toArmsRaceTraceLines(report);
    assertClean(lines);
    mkdirSync(dirname(opts.tracePath), { recursive: true });
    writeFileSync(opts.tracePath, lines.join('\n') + '\n', 'utf8');
    console.log(`🔍 逐局逐轮 trace(脱敏 JSONL)已写入 ${opts.tracePath}(${lines.length} 局)`);
  }

  if (opts.sample > 0) {
    // 打印每档「卧底被抓」与「卧底逃脱」各一局的完整过程,直观展示胜负是怎么打出来的。
    console.log('\n=== 逐局复盘样本(每档:卧底被抓 / 卧底逃脱 各一例) ===');
    for (const it of report.iterations) {
      const caught = it.traces.find((t) => t.winner === 'civilian' && t.completed);
      const escaped = it.traces.find((t) => t.winner === 'undercover' && t.completed);
      for (const t of [caught, escaped].filter(Boolean).slice(0, opts.sample)) {
        console.log(renderGameTraceText(t!));
      }
    }
  }

  // 摆动门:未形成预期军备竞赛即非零退出。
  process.exitCode = report.armsRaceHolds ? 0 : 1;
}

void main();
