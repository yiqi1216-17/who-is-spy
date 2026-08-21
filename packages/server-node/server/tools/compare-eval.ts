/**
 * 策略迭代对比 CLI(OpenSpec 04 · §5.3 champion/challenger · §6.1 消融 · 题面②「看到提升 diff」)
 *
 * 用法(仓库根):
 *   npm run compare:node                          # 默认 collapsed → v1 → v2,12 局/配置,seed 1
 *   npm run compare:node -- --games 24 --seed 7   # 调整规模/种子
 *   npm run compare:node -- --log runs/x.jsonl    # 落一份脱敏 JSONL 运行日志(逐配置逐指标一行)
 *   npm run compare:node -- --report docs/evidence/04-strategy-compare.md  # 落 Markdown 分析报告
 *   npm run compare:node -- --json                # 机器可读整块 JSON
 *
 * 退出码:任一步关键指标劣化超回归预算 → **非零退出**(CI/回归门可用)。
 *
 * 日志脱敏:落盘前对每一行 `scanSecrets`,命中密词/凭据即拒绝写入并非零退出——
 * 结构上,本对比只承载指标聚合值(无逐条描述文本),密词本就无从进入;这是双保险。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { scanSecrets } from '../redaction.js';
import {
  DEFAULT_BUDGET,
  defaultConfigs,
  renderComparisonMarkdown,
  runComparison,
  toLogLines,
  TRACKED_METRICS,
  type ComparisonReport,
} from '../eval/compare.js';

interface CliOptions {
  games: number;
  seed: number;
  logPath?: string;
  reportPath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { games: 12, seed: 1, json: false };
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
      case '--json':
        opts.json = true;
        break;
      default:
        throw new Error(`未知参数:${arg}`);
    }
  }
  return opts;
}

/** 把对比结果打印成人类可读的完整日志(stdout)。 */
function printLog(cmp: ComparisonReport): void {
  console.log(`\n=== 策略迭代对比 · ${cmp.games} 局/配置 · seed=${cmp.seed} ===\n`);
  for (const o of cmp.outcomes) {
    console.log(`▸ [${o.config.id}] ${o.config.label}  门禁:${o.gate.passed ? '通过' : '失败(' + o.gate.failures.length + ')'}`);
    for (const key of TRACKED_METRICS) {
      const m = o.metrics.find((x) => x.key === key);
      if (m) console.log(`    ${key.padEnd(28)} ${String(m.value).padStart(10)}   (n=${m.n})`);
    }
    if (!o.gate.passed) for (const f of o.gate.failures) console.log(`    · [${f.code}] ${f.detail}`);
    console.log('');
  }
  console.log('--- 逐步 diff(后 − 前) ---');
  for (const s of cmp.steps) {
    console.log(`  ${s.from} → ${s.to}${s.regressed ? '  ⚠回归' : ''}`);
    for (const d of s.deltas) {
      const flag = d.regressed ? ' ⚠' : d.improved ? ' ✓' : '';
      console.log(`    ${d.key.padEnd(28)} ${String(d.from).padStart(9)} → ${String(d.to).padStart(9)}  Δ=${d.delta}${flag}`);
    }
  }
  console.log(`\n总体裁决:${cmp.regressed ? '❌ 回归(非零退出)' : '✅ 无回归'}\n`);
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
  const cmp = await runComparison(defaultConfigs(), opts.games, opts.seed, DEFAULT_BUDGET);

  if (opts.json) {
    console.log(JSON.stringify(cmp, null, 2));
  } else {
    printLog(cmp);
  }

  if (opts.logPath) {
    const lines = toLogLines(cmp);
    assertClean(lines);
    mkdirSync(dirname(opts.logPath), { recursive: true });
    writeFileSync(opts.logPath, lines.join('\n') + '\n', 'utf8');
    console.log(`📝 运行日志(脱敏 JSONL)已写入 ${opts.logPath}(${lines.length} 行)`);
  }

  if (opts.reportPath) {
    const md = renderComparisonMarkdown(cmp);
    assertClean([md]);
    mkdirSync(dirname(opts.reportPath), { recursive: true });
    writeFileSync(opts.reportPath, md + '\n', 'utf8');
    console.log(`📄 分析报告(Markdown)已写入 ${opts.reportPath}`);
  }

  // 回归门:劣化超预算即非零退出(CI/回归保护的闭环)。
  process.exitCode = cmp.regressed ? 1 : 0;
}

void main();
