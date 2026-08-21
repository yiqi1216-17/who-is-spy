import type { Strategy } from '../schema.js';
import type { Player, StrategyView } from '../types.js';
import { projectStrategy, SEED_STRATEGIES } from '../strategies.js';
import { StrategyDrivenModel } from './strategy-model.js';
import { runSelfPlayBatch } from './self-play.js';
import { evaluateSelfPlay } from './report.js';
import type { AggregateResult, ReportMetric } from './metrics.js';
import type { GateResult } from './report.js';

/**
 * 迭代对比评测(OpenSpec 04 · §5.3 champion/challenger 核心 · §6.1 消融)
 *
 * 回答题面②最难的一问:「这一版比上一版**更好还是更差**?」——不靠感觉,靠**同 seed、同随机流、
 * 同人类陪跑**下的指标 diff。三个可对比配置:
 *   - `collapsed`:所有 AI 坍缩成同一 persona(CH-2 未修复的基线,人设无效)——预期同质、可区分率低;
 *   - `synthetic-v1`:手写四人设(第一版迭代);
 *   - `transfer-v2`:语料抽取的四人设(当前版)。
 * 每一步 vs 前一步产出一张 **metric diff 表**(值 + 分母 n + 绝对增量 + 方向),
 * 并施加**回归预算门**:若「挑战者」在关键指标上比「冠军」劣化超过预算,`regressed=true` → CLI 非零退出。
 * 这就是「基于 benchmark 不断迭代、能看到提升 diff、且劣化会被拦下」的闭环。
 */

/** 一个可对比配置:一份策略集 + 一个是否坍缩人设的开关。 */
export interface EvalConfig {
  id: string;
  label: string;
  /** 策略集(按座次循环取);collapsed=true 时模型忽略 persona 差异。 */
  strategies: readonly Strategy[];
  collapsed: boolean;
}

/** 座次 → StrategyView 的解析器(与引擎 `resolveStrategy` 签名一致)。 */
function resolverFor(strategies: readonly Strategy[]): (agent: Player) => StrategyView {
  return (agent: Player): StrategyView => {
    const seat = Number.parseInt(agent.id.replace(/^ai-/, ''), 10) || 1;
    return projectStrategy(strategies[(seat - 1) % strategies.length]);
  };
}

/** 单个配置的评测结果(报告 + 聚合 + 门禁裁决)。 */
export interface ConfigOutcome {
  config: EvalConfig;
  aggregate: AggregateResult;
  gate: GateResult;
  metrics: ReportMetric[];
}

/** 跑一个配置到评测报告。同 seed 下与其它配置**唯一变量就是策略集**。 */
export async function runConfig(config: EvalConfig, games: number, seed: number): Promise<ConfigOutcome> {
  const model = new StrategyDrivenModel(config.collapsed, `${config.id}`);
  const results = await runSelfPlayBatch(model, {
    games,
    seed,
    resolveStrategy: resolverFor(config.strategies),
  });
  const { report, aggregate, gate } = evaluateSelfPlay(results, {
    suite: 'strategy-compare',
    milestone: config.id,
  });
  return { config, aggregate, gate, metrics: report.data.metrics };
}

/** 关注做 diff 的关键指标(其余指标仍全量落报告,只是不进预算门)。 */
export const TRACKED_METRICS = [
  'diversity_rate',
  'strategy_distinguishability',
  'self_repetition_rate',
  'completion_rate',
  'describe_retries_total',
] as const;

/** 「越大越好」的指标;其余(retries / self_repetition)越小越好。 */
const HIGHER_IS_BETTER = new Set(['diversity_rate', 'strategy_distinguishability', 'completion_rate']);

/** 单指标的一步 diff。 */
export interface MetricDelta {
  key: string;
  from: number;
  to: number;
  n: number;
  /** to − from(带方向的绝对增量)。 */
  delta: number;
  /** true 表示这一步在该指标上是「提升」(按 higher/lower-is-better 判定)。 */
  improved: boolean;
  /** true 表示这一步在该指标上「劣化超预算」(触发回归门)。 */
  regressed: boolean;
}

/** 相邻两配置的一步对比。 */
export interface StepDiff {
  from: string;
  to: string;
  deltas: MetricDelta[];
  /** 该步是否有任一关键指标劣化超预算。 */
  regressed: boolean;
}

/** 回归预算:关键指标允许的最大反向漂移(默认 2 个百分点;retries 允许小幅上升)。 */
export interface RegressionBudget {
  diversity_rate: number;
  strategy_distinguishability: number;
  completion_rate: number;
}

export const DEFAULT_BUDGET: RegressionBudget = {
  diversity_rate: 0.02,
  strategy_distinguishability: 0.02,
  completion_rate: 0.0, // 完成率不容许任何回归(CH-4 优雅降级的评测侧硬约束)
};

function metricOf(metrics: ReportMetric[], key: string): ReportMetric {
  return metrics.find((m) => m.key === key) ?? { key, value: 0, n: 0 };
}

/** 逐指标算一步 diff。回归门只对 budget 里登记的三项「越大越好」指标生效。 */
export function diffStep(prev: ConfigOutcome, next: ConfigOutcome, budget: RegressionBudget): StepDiff {
  const deltas: MetricDelta[] = TRACKED_METRICS.map((key) => {
    const a = metricOf(prev.metrics, key);
    const b = metricOf(next.metrics, key);
    const delta = round6(b.value - a.value);
    const higher = HIGHER_IS_BETTER.has(key);
    const improved = higher ? delta > 0 : delta < 0;
    const budgetFor = (budget as unknown as Record<string, number>)[key];
    // 只有登记预算的指标才可能触发回归:反向漂移(higher-is-better 时 delta<0)超过预算即回归。
    const regressed = budgetFor !== undefined && higher && delta < -budgetFor;
    return { key, from: a.value, to: b.value, n: b.n, delta, improved, regressed };
  });
  return {
    from: prev.config.id,
    to: next.config.id,
    deltas,
    regressed: deltas.some((d) => d.regressed),
  };
}

/** 完整对比结果:每个配置的结果 + 相邻步 diff + 总体回归裁决。 */
export interface ComparisonReport {
  games: number;
  seed: number;
  outcomes: ConfigOutcome[];
  steps: StepDiff[];
  /** 任一步触发回归预算即 true → CLI 非零退出。 */
  regressed: boolean;
}

/** 端到端:按顺序跑所有配置,产出逐步 diff 与总体裁决。配置顺序 = 迭代顺序。 */
export async function runComparison(
  configs: EvalConfig[],
  games: number,
  seed: number,
  budget: RegressionBudget = DEFAULT_BUDGET,
): Promise<ComparisonReport> {
  const outcomes: ConfigOutcome[] = [];
  for (const config of configs) {
    outcomes.push(await runConfig(config, games, seed));
  }
  const steps: StepDiff[] = [];
  for (let i = 1; i < outcomes.length; i += 1) {
    steps.push(diffStep(outcomes[i - 1], outcomes[i], budget));
  }
  return { games, seed, outcomes, steps, regressed: steps.some((s) => s.regressed) };
}

/** 默认三配置:坍缩基线 → v1 手写 → v2 语料(迭代顺序)。 */
export function defaultConfigs(): EvalConfig[] {
  return [
    { id: 'collapsed', label: '坍缩人设(CH-2 未修复基线)', strategies: SEED_STRATEGIES, collapsed: true },
    { id: 'synthetic-v1', label: '手写四人设(第一版)', strategies: SYNTHETIC_V1, collapsed: false },
    { id: 'transfer-v2', label: '语料抽取四人设(当前版)', strategies: SEED_STRATEGIES, collapsed: false },
  ];
}

/** 逐配置逐指标展开成脱敏 JSONL 行(每行一个对象);供 CLI 落盘,提到纯模块便于测试。 */
export function toLogLines(cmp: ComparisonReport): string[] {
  const lines: string[] = [];
  for (const o of cmp.outcomes) {
    for (const m of o.metrics) {
      lines.push(
        JSON.stringify({
          kind: 'metric',
          seed: cmp.seed,
          games: cmp.games,
          config: o.config.id,
          metric: m.key,
          value: m.value,
          n: m.n,
        }),
      );
    }
  }
  for (const s of cmp.steps) {
    for (const d of s.deltas) {
      lines.push(
        JSON.stringify({
          kind: 'diff',
          from: s.from,
          to: s.to,
          metric: d.key,
          delta: d.delta,
          improved: d.improved,
          regressed: d.regressed,
        }),
      );
    }
  }
  lines.push(JSON.stringify({ kind: 'verdict', regressed: cmp.regressed }));
  return lines;
}

function round6(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// —— 报告渲染(纯字符串,便于测试与落盘) ——

/** 指标中文名 + 方向标注,让报告可读。 */
const METRIC_LABELS: Record<string, string> = {
  diversity_rate: '描述多样度 ↑',
  strategy_distinguishability: '策略可区分率 ↑',
  self_repetition_rate: '自我重复率 ↓',
  completion_rate: '完局率 ↑',
  describe_retries_total: '描述重试次数 ↓',
};

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4);
}

function arrow(d: MetricDelta): string {
  if (d.delta === 0) return '＝';
  const sign = d.delta > 0 ? '+' : '';
  const mark = d.regressed ? ' ⚠回归' : d.improved ? ' ✓' : '';
  return `${sign}${fmt(d.delta)}${mark}`;
}

/**
 * 把对比结果渲染成 Markdown 分析报告(确定性纯函数)。
 * 结构:每配置一行指标快照 + 相邻步 diff 表 + 回归裁决 + 方法学脚注。
 */
export function renderComparisonMarkdown(cmp: ComparisonReport): string {
  const lines: string[] = [];
  lines.push('# 策略迭代对比分析报告(自动生成)');
  lines.push('');
  lines.push(`> 由 \`server/tools/compare-eval.ts\` 生成 · ${cmp.games} 局/配置 · seed=${cmp.seed} · fixture 确定性`);
  lines.push('> 同 seed、同随机流、同人类陪跑;**唯一变量是策略集**——故指标 diff 可归因于策略差异化本身。');
  lines.push('');

  // 快照表:配置 × 关键指标
  lines.push('## 1. 各配置指标快照');
  lines.push('');
  lines.push(`| 配置 | ${TRACKED_METRICS.map((k) => METRIC_LABELS[k] ?? k).join(' | ')} | 门禁 |`);
  lines.push(`| --- | ${TRACKED_METRICS.map(() => '---').join(' | ')} | --- |`);
  for (const o of cmp.outcomes) {
    const cells = TRACKED_METRICS.map((k) => fmt(metricOf(o.metrics, k).value));
    const gate = o.gate.passed ? '✅ 通过' : `❌ ${o.gate.failures.length} 项`;
    lines.push(`| \`${o.config.id}\`<br>${o.config.label} | ${cells.join(' | ')} | ${gate} |`);
  }
  lines.push('');

  // 逐步 diff
  lines.push('## 2. 迭代逐步 diff(后一版 − 前一版)');
  lines.push('');
  for (const step of cmp.steps) {
    lines.push(`### ${step.from} → ${step.to}${step.regressed ? ' · ⚠ 触发回归预算' : ''}`);
    lines.push('');
    lines.push('| 指标 | 前 | 后 | 增量(n) |');
    lines.push('| --- | --- | --- | --- |');
    for (const d of step.deltas) {
      lines.push(`| ${METRIC_LABELS[d.key] ?? d.key} | ${fmt(d.from)} | ${fmt(d.to)} | ${arrow(d)}（n=${d.n}） |`);
    }
    lines.push('');
  }

  // 回归裁决
  lines.push('## 3. 回归裁决');
  lines.push('');
  if (cmp.regressed) {
    lines.push('**❌ 回归**:存在关键指标劣化超出预算 → CLI 以非零退出。冠军版本应予保留,挑战者被拦下。');
  } else {
    lines.push('**✅ 无回归**:每一步的关键指标劣化都在预算内(完局率零容忍、多样度/可区分率各允许 2 个百分点漂移)。');
  }
  lines.push('');
  lines.push('## 4. 方法学与诚实边界');
  lines.push('');
  lines.push('- **信号来源**:描述由 `StrategyDrivenModel` 按 persona 取词——persona 可区分则描述天然低相似(过质量门),');
  lines.push('  persona 坍缩则描述雷同(撞 0.72 同质门→重试→穷尽→整回合原子终止)。这条链把 CH-2 直接映成指标 diff。');
  lines.push('- **确定性**:输出只由 (persona, 轴档, 轮次, 座次) 决定,无随机源/无墙钟,同 seed 逐字节可复现。');
  lines.push('- **非真机**:fixture 模型不代表真机语言质量;`diversity=1` 是词库正交的结构性上限,读作「策略差异化生效」而非「真机达到满分」。');
  lines.push('  真机墙钟延迟/成本另由 `--real` 模式单列(本报告不含时延)。');
  return lines.join('\n');
}

/**
 * v1 手写种子策略(取自 git 历史 fe89b8a:strategies.ts,现已被 v2 transfer 替换)。
 * 保留在此**仅供对比基线**——证明「v1→v2 是纯数据变更且指标可比」,不再进生产路径。
 */
export const SYNTHETIC_V1: readonly Strategy[] = [
  { id: 'cautious-observer', version: 1, role: 'any', persona: '谨慎观察', tactics: ['先给上位概念', '回避独有细节', '留有余地不抢先定性'], specificity: 0.35, novelty: 0.5, risk: 0.2, provenance: { kind: 'synthetic' } },
  { id: 'intuitive-reader', version: 1, role: 'any', persona: '直觉敏锐', tactics: ['抓整体感觉与联想', '用氛围与情绪词', '顺着场上语气接话'], specificity: 0.45, novelty: 0.7, risk: 0.45, provenance: { kind: 'synthetic' } },
  { id: 'logical-deducer', version: 1, role: 'any', persona: '逻辑派', tactics: ['结构化归类', '强调功能与用途', '对齐并比对他人措辞'], specificity: 0.55, novelty: 0.4, risk: 0.35, provenance: { kind: 'synthetic' } },
  { id: 'wildcard', version: 1, role: 'any', persona: '出其不意', tactics: ['换一个新颖角度', '制造反差', '避免与前面雷同'], specificity: 0.5, novelty: 0.85, risk: 0.6, provenance: { kind: 'synthetic' } },
];
