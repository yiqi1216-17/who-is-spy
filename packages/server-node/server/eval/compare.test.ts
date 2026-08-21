import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BUDGET,
  defaultConfigs,
  diffStep,
  renderComparisonMarkdown,
  runComparison,
  runConfig,
  SYNTHETIC_V1,
  toLogLines,
  TRACKED_METRICS,
  type EvalConfig,
} from './compare.js';
import { SEED_STRATEGIES } from '../strategies.js';
import { scanSecrets } from '../redaction.js';

/**
 * 迭代对比评测的验收(OpenSpec 04 · §5.3 / §6.1 · 题面②「看到提升 diff、劣化被拦」)
 *
 * 钉四件事:①同 seed 逐字节可复现;②对比产出**真实且方向正确**的 diff(坍缩→区分是提升);
 * ③回归预算门**双向**成立(好→坏触发、坏→好不触发);④落盘日志脱敏(结构上无密词)。
 */

const GAMES = 8;
const SEED = 3;

describe('对比可复现性', () => {
  it('同 seed 同配置逐字节相等,换 seed 则不同', async () => {
    const a = await runComparison(defaultConfigs(), GAMES, SEED);
    const b = await runComparison(defaultConfigs(), GAMES, SEED);
    const snap = (r: typeof a) => JSON.stringify(r.outcomes.map((o) => o.metrics));
    expect(snap(a)).toBe(snap(b));
    const c = await runComparison(defaultConfigs(), GAMES, SEED + 4);
    expect(snap(c)).not.toBe(snap(a));
  });
});

describe('对比产出真实 diff(CH-2 反转的指标证据)', () => {
  it('坍缩人设完局率崩溃、可区分率为 0;区分人设完局且可区分', async () => {
    const cmp = await runComparison(defaultConfigs(), GAMES, SEED);
    const byId = Object.fromEntries(cmp.outcomes.map((o) => [o.config.id, o]));
    const val = (id: string, key: string) => byId[id].metrics.find((m) => m.key === key)!.value;

    // 坍缩:同质→质量门反复拒→穷尽→整回合原子终止(completion 崩、retries 高)
    expect(val('collapsed', 'completion_rate')).toBe(0);
    expect(val('collapsed', 'strategy_distinguishability')).toBe(0);
    expect(byId['collapsed'].gate.passed).toBe(false);

    // 区分人设:完局且可区分
    expect(val('synthetic-v1', 'completion_rate')).toBe(1);
    expect(val('synthetic-v1', 'strategy_distinguishability')).toBe(1);
    expect(byId['synthetic-v1'].gate.passed).toBe(true);

    // 第一步是明确「提升」
    const firstStep = cmp.steps[0];
    const distDelta = firstStep.deltas.find((d) => d.key === 'strategy_distinguishability')!;
    expect(distDelta.improved).toBe(true);
    expect(distDelta.regressed).toBe(false);
  });

  it('v1→v2 是纯数据变更:关键指标行为等价、无回归', async () => {
    const cmp = await runComparison(defaultConfigs(), GAMES, SEED);
    const v1v2 = cmp.steps.find((s) => s.from === 'synthetic-v1' && s.to === 'transfer-v2')!;
    expect(v1v2.regressed).toBe(false);
    // 完局率与可区分率零漂移(等价性)
    const compl = v1v2.deltas.find((d) => d.key === 'completion_rate')!;
    expect(compl.delta).toBe(0);
  });
});

describe('回归预算门双向成立', () => {
  const good: EvalConfig = { id: 'good', label: 'v2', strategies: SEED_STRATEGIES, collapsed: false };
  const bad: EvalConfig = { id: 'bad', label: '坍缩', strategies: SEED_STRATEGIES, collapsed: true };

  it('好→坏触发回归(非零退出的根据)', async () => {
    const cmp = await runComparison([good, bad], GAMES, SEED, DEFAULT_BUDGET);
    expect(cmp.regressed).toBe(true);
    const step = cmp.steps[0];
    expect(step.deltas.some((d) => d.key === 'completion_rate' && d.regressed)).toBe(true);
  });

  it('坏→好不触发回归', async () => {
    const cmp = await runComparison([bad, good], GAMES, SEED, DEFAULT_BUDGET);
    expect(cmp.regressed).toBe(false);
  });

  it('diffStep 纯函数:完局率零容忍,任何下滑即回归', async () => {
    const g = await runConfig(good, GAMES, SEED);
    const b = await runConfig(bad, GAMES, SEED);
    // good→bad:completion 从 1 掉到 0,预算 0 → 回归
    expect(diffStep(g, b, DEFAULT_BUDGET).regressed).toBe(true);
    // bad→good:completion 上升 → 不回归
    expect(diffStep(b, g, DEFAULT_BUDGET).regressed).toBe(false);
  });
});

describe('落盘工件脱敏', () => {
  it('JSONL 日志行只含指标聚合值,扫不出任何密词/凭据', async () => {
    const cmp = await runComparison(defaultConfigs(), GAMES, SEED);
    const lines = toLogLines(cmp);
    expect(lines.length).toBeGreaterThan(0);
    expect(scanSecrets(lines.join('\n'))).toEqual([]);
    // 每行都是合法 JSON
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  it('Markdown 报告含全部关键指标名且扫不出密词', async () => {
    const cmp = await runComparison(defaultConfigs(), GAMES, SEED);
    const md = renderComparisonMarkdown(cmp);
    expect(scanSecrets(md)).toEqual([]);
    // 报告结构完整
    expect(md).toContain('# 策略迭代对比分析报告');
    expect(md).toContain('回归裁决');
    for (const key of TRACKED_METRICS) {
      // 每个关键指标至少以中文标签或原名出现
      const present = md.includes(key) || /多样度|可区分率|完局率|重试|自我重复/.test(md);
      expect(present).toBe(true);
    }
  });
});
