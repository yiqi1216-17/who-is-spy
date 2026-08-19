import { scanSecrets } from '../redaction.js';
import { type Versioned, envelope } from '../schema.js';
import { type AggregateResult, type GameMetrics, aggregate, extractGameMetrics } from './metrics.js';
import type { SelfPlayResult } from './self-play.js';

/**
 * 评测报告 + 确定性非零门禁(OpenSpec 04 · Task 2.2 / 2.3)
 *
 * 报告走冻结的 `report` 版本化信封({suite,milestone,sampleSize,metrics});门禁在
 * 「泄题 / 非法动作 / 未完成对局 / 隐私哨兵 / 阈值突破」任一命中时判定 process 应以非零退出。
 * 门禁是**纯函数**:同一批自博弈结果恒得同一裁决,便于 CI 复现与现场演示。
 */

/** 阈值门:低于下限即判失败。默认让当前 fixture 稳过,可经 CLI 收紧以现场演示门禁触发。 */
export interface GateThresholds {
  minCompletionRate: number;
  minDiversityRate: number;
  minStrategyDistinguishability: number;
  minBeliefHitRate: number;
}

export const DEFAULT_THRESHOLDS: GateThresholds = {
  minCompletionRate: 1, // 任何未完成对局(含质量穷尽原子终止)都应让门禁失败
  minDiversityRate: 0.05, // 同轮跨 AI 至少有可测的措辞差异
  minStrategyDistinguishability: 0.5, // 过半的同轮 AI 描述对должны可区分
  minBeliefHitRate: 0, // 校准命中默认不设硬门(fixture 假模型不代表真机),留 CLI 收紧
};

export interface GateFailure {
  code: string;
  detail: string;
}

export interface GateResult {
  passed: boolean;
  failures: GateFailure[];
}

/**
 * 对报告工件做隐私哨兵扫描:序列化后不得出现任何机密字面量(密词 + 凭据)。
 * 哨兵词表由 `../redaction.ts` 单一事实源提供(与可观测 trace 共用同一把尺)。
 * 报告结构上只有数值指标与 suite/milestone 串,故本扫描应恒过——作为**结构安全的证明**而非补丁。
 */
export function scanReportSentinels(report: Versioned<'report'>): GateFailure[] {
  return scanSecrets(JSON.stringify(report)).map((sentinel) => ({
    code: 'privacy_sentinel',
    detail: `报告工件含机密字面量「${sentinel}」`,
  }));
}

/** 逐局结果 → 冻结信封报告。 */
export function buildReport(
  suite: string,
  milestone: string,
  perGame: GameMetrics[],
): Versioned<'report'> {
  const agg = aggregate(perGame);
  return envelope('report', {
    suite,
    milestone,
    sampleSize: agg.games,
    metrics: agg.metrics,
  });
}

/**
 * 确定性门禁:五类失败任一命中即 `passed=false`,CLI 据此非零退出。
 * - 泄题 / 非法票:结构上应恒 0(引擎前置守卫);此处作跨 N 局的回归断言。
 * - 未完成:completion_rate < 下限(默认 1)——质量穷尽/不收敛都会被捕获(CH-4 的评测侧闭环)。
 * - 隐私哨兵:报告工件出现任何机密字面量。
 * - 阈值突破:diversity / distinguishability / belief-hit 低于下限。
 */
export function evaluateGates(
  agg: AggregateResult,
  report: Versioned<'report'>,
  thresholds: GateThresholds = DEFAULT_THRESHOLDS,
): GateResult {
  const failures: GateFailure[] = [];
  const { gateInputs } = agg;

  if (gateInputs.totalLeaks > 0) {
    failures.push({ code: 'secret_leak', detail: `AI 描述泄题 ${gateInputs.totalLeaks} 处` });
  }
  if (gateInputs.totalIllegalVotes > 0) {
    failures.push({
      code: 'illegal_action',
      detail: `非法投票 ${gateInputs.totalIllegalVotes} 处`,
    });
  }
  if (gateInputs.completionRate < thresholds.minCompletionRate) {
    failures.push({
      code: 'incomplete_game',
      detail: `完成率 ${gateInputs.completionRate} < 下限 ${thresholds.minCompletionRate}`,
    });
  }
  if (gateInputs.diversityRate < thresholds.minDiversityRate) {
    failures.push({
      code: 'threshold_diversity',
      detail: `多样度 ${gateInputs.diversityRate} < 下限 ${thresholds.minDiversityRate}`,
    });
  }
  const distinguish = metricValue(report, 'strategy_distinguishability');
  if (distinguish < thresholds.minStrategyDistinguishability) {
    failures.push({
      code: 'threshold_distinguishability',
      detail: `可区分率 ${distinguish} < 下限 ${thresholds.minStrategyDistinguishability}`,
    });
  }
  if (gateInputs.beliefHitRate < thresholds.minBeliefHitRate) {
    failures.push({
      code: 'threshold_belief_hit',
      detail: `校准命中率 ${gateInputs.beliefHitRate} < 下限 ${thresholds.minBeliefHitRate}`,
    });
  }
  failures.push(...scanReportSentinels(report));

  return { passed: failures.length === 0, failures };
}

function metricValue(report: Versioned<'report'>, key: string): number {
  return report.data.metrics.find((m) => m.key === key)?.value ?? 0;
}

/** 端到端:逐局结果 → {报告, 聚合, 门禁裁决}。CLI 与测试共用同一路径。 */
export function evaluateSelfPlay(
  results: SelfPlayResult[],
  options: { suite: string; milestone: string; thresholds?: GateThresholds },
): { report: Versioned<'report'>; aggregate: AggregateResult; gate: GateResult; perGame: GameMetrics[] } {
  const perGame = results.map(extractGameMetrics);
  const agg = aggregate(perGame);
  const report = buildReport(options.suite, options.milestone, perGame);
  const gate = evaluateGates(agg, report, options.thresholds ?? DEFAULT_THRESHOLDS);
  return { report, aggregate: agg, gate, perGame };
}
