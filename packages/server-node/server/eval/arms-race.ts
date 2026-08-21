import type { Player } from '../types.js';
import { projectStrategy, SEED_STRATEGIES } from '../strategies.js';
import { ArmsRaceModel, type SkillProfile } from './arms-race-model.js';
import { runSelfPlayBatch } from './self-play.js';
import { evaluateSelfPlay } from './report.js';
import type { ReportMetric } from './metrics.js';

/**
 * 阵营胜率军备竞赛(OpenSpec 04 · 题面②「学了更强策略后,平民/卧底能不能更容易赢」)
 *
 * StrategyDrivenModel 的对比钉的是**描述质量**(多样度/可区分率),回答「人设有没有差异化」;
 * 本模块钉的是**胜负**:一版比上一版,让**平民或卧底更容易赢**了吗?给出一条军备竞赛曲线——
 *   iter-0 baseline:双方都不太会玩(civSkill 低)——接近随机基线;
 *   iter-1 平民觉醒:平民学会按离群度锁定卧底 → civilian_win_rate ↑;
 *   iter-2 卧底反制:卧底学会「融入平民簇 + 转移火力」→ undercover_win_rate ↑;
 *   iter-3 平民精进:平民改用**跨轮累计**离群度,抓住不稳的融入 → civilian_win_rate 再 ↑。
 * 每一步产出 civilian/undercover 胜率的 diff,并断言**摆动方向**(civ↑ / spy↑ / civ↑)。
 *
 * 技能档位的**数据依据**:见 `data:outcomes` 挖出的 outcome-correlation-report.json——
 * werewolf train split 上「村民类比方经验胜率 ≈ 58.8%」「不同话风簇获胜占比 48%–57%」证实
 * 「阵营与话风都对胜负有可测影响」,故把技能差异映成胜率摆动是**有语料出处的设定**,而非凭空。
 *
 * 诚实边界(随报告呈现):胜率摆动来自**仿真**的「公开描述离群度→投票」耦合,非人类逐局回放;
 * werewolf(ONUW)≠谁是卧底,是迁移信号;三段摆动是**为演示军备竞赛动态而设计**的确定性机制。
 */

/** 座次 → StrategyView(与引擎 resolveStrategy 同签名);军备竞赛里策略只驱动话风,不影响胜负判定。 */
function resolveStrategy(agent: Player) {
  const seat = Number.parseInt(agent.id.replace(/^ai-/, ''), 10) || 1;
  return projectStrategy(SEED_STRATEGIES[(seat - 1) % SEED_STRATEGIES.length]);
}

/** 一次迭代的结果:胜率 + 完局率 + 原始指标。 */
export interface IterationOutcome {
  skill: SkillProfile;
  civilianWinRate: number;
  undercoverWinRate: number;
  completionRate: number;
  metrics: ReportMetric[];
}

/** 跑一档技能到胜率结果。同 seed 下与其它档**唯一变量就是技能配置**。 */
export async function runIteration(skill: SkillProfile, games: number, seed: number): Promise<IterationOutcome> {
  const results = await runSelfPlayBatch(new ArmsRaceModel(skill), { games, seed, resolveStrategy });
  const { report } = evaluateSelfPlay(results, { suite: 'arms-race', milestone: skill.id });
  const metricOf = (key: string): number => report.data.metrics.find((m) => m.key === key)?.value ?? 0;
  return {
    skill,
    civilianWinRate: metricOf('civilian_win_rate'),
    undercoverWinRate: metricOf('undercover_win_rate'),
    completionRate: metricOf('completion_rate'),
    metrics: report.data.metrics,
  };
}

/** 谁在这一步「变强」:平民胜率上升记 civilian,卧底胜率上升记 undercover。 */
export type Advantage = 'civilian' | 'undercover' | 'none';

/** 相邻两迭代的一步胜率 diff。 */
export interface WinRateStep {
  from: string;
  to: string;
  civilianDelta: number;
  undercoverDelta: number;
  /** 期望这一步谁变强(设计意图)。 */
  expected: Advantage;
  /** 实际这一步谁变强(按胜率增量的符号)。 */
  actual: Advantage;
  /** 实际是否与期望一致(军备竞赛摆动方向正确)。 */
  swungAsExpected: boolean;
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

function advantageOf(civDelta: number, spyDelta: number): Advantage {
  if (civDelta > 0 && civDelta >= spyDelta) return 'civilian';
  if (spyDelta > 0) return 'undercover';
  return 'none';
}

/** 完整军备竞赛结果:每档结果 + 逐步胜率 diff + 总体是否形成预期摆动。 */
export interface ArmsRaceReport {
  games: number;
  seed: number;
  iterations: IterationOutcome[];
  steps: WinRateStep[];
  /** 每一步都按设计意图摆动(civ↑→spy↑→civ↑),且全部完局。 */
  armsRaceHolds: boolean;
}

/**
 * 端到端:按顺序跑四档技能,产出逐步胜率 diff 与摆动裁决。
 * expectations 与 skills 一一对应(第一档是基线,无 expected)。
 */
export async function runArmsRace(
  skills: SkillProfile[],
  expectations: Advantage[],
  games: number,
  seed: number,
): Promise<ArmsRaceReport> {
  const iterations: IterationOutcome[] = [];
  for (const skill of skills) iterations.push(await runIteration(skill, games, seed));

  const steps: WinRateStep[] = [];
  for (let i = 1; i < iterations.length; i += 1) {
    const prev = iterations[i - 1];
    const next = iterations[i];
    const civilianDelta = round6(next.civilianWinRate - prev.civilianWinRate);
    const undercoverDelta = round6(next.undercoverWinRate - prev.undercoverWinRate);
    const expected = expectations[i] ?? 'none';
    const actual = advantageOf(civilianDelta, undercoverDelta);
    steps.push({
      from: prev.skill.id,
      to: next.skill.id,
      civilianDelta,
      undercoverDelta,
      expected,
      actual,
      swungAsExpected: actual === expected,
    });
  }

  const allComplete = iterations.every((it) => it.completionRate === 1);
  return {
    games,
    seed,
    iterations,
    steps,
    armsRaceHolds: allComplete && steps.every((s) => s.swungAsExpected),
  };
}

/**
 * 默认四档技能(军备竞赛迭代顺序)。数值经 60–80 局 fixture 校准:step1/2/3 摆动方向稳健,
 * 全程 100% 完局。技能语义见 SkillProfile;数据依据见 outcome-correlation-report.json。
 */
export function defaultSkills(): { skills: SkillProfile[]; expectations: Advantage[] } {
  const skills: SkillProfile[] = [
    { id: 'baseline', label: '双方生疏(接近随机基线)', civSkill: 0.2, civMode: 'round', spyBlend: 0.15, spyDeflect: 0.1 },
    { id: 'civ-awake', label: '平民觉醒(按离群度锁定卧底)', civSkill: 0.85, civMode: 'round', spyBlend: 0.15, spyDeflect: 0.1 },
    { id: 'spy-counter', label: '卧底反制(融入平民簇 + 转移火力)', civSkill: 0.85, civMode: 'round', spyBlend: 0.85, spyDeflect: 0.7 },
    { id: 'civ-refined', label: '平民精进(跨轮累计离群度)', civSkill: 1.0, civMode: 'cumulative', spyBlend: 0.85, spyDeflect: 0.7 },
  ];
  const expectations: Advantage[] = ['none', 'civilian', 'undercover', 'civilian'];
  return { skills, expectations };
}

/** 逐迭代逐指标展开成脱敏 JSONL 行(每行一对象);供 CLI 落盘,提到纯模块便于测试。 */
export function toArmsRaceLogLines(report: ArmsRaceReport): string[] {
  const lines: string[] = [];
  for (const it of report.iterations) {
    lines.push(
      JSON.stringify({
        kind: 'iteration',
        seed: report.seed,
        games: report.games,
        skill: it.skill.id,
        civilianWinRate: it.civilianWinRate,
        undercoverWinRate: it.undercoverWinRate,
        completionRate: it.completionRate,
      }),
    );
  }
  for (const s of report.steps) {
    lines.push(
      JSON.stringify({
        kind: 'step',
        from: s.from,
        to: s.to,
        civilianDelta: s.civilianDelta,
        undercoverDelta: s.undercoverDelta,
        expected: s.expected,
        actual: s.actual,
        swungAsExpected: s.swungAsExpected,
      }),
    );
  }
  lines.push(JSON.stringify({ kind: 'verdict', armsRaceHolds: report.armsRaceHolds }));
  return lines;
}

// —— 报告渲染(纯字符串,便于测试与落盘) ——

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDelta(n: number): string {
  if (n === 0) return '＝';
  return `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)}pp`;
}

const ADVANTAGE_LABEL: Record<Advantage, string> = {
  civilian: '平民更强',
  undercover: '卧底更强',
  none: '无明显变化',
};

/**
 * 渲染 Markdown 分析报告(确定性纯函数)。
 * 结构:胜率快照表 + 逐步摆动 diff + 军备竞赛裁决 + 数据依据 + 方法学/诚实边界。
 */
export function renderArmsRaceMarkdown(report: ArmsRaceReport): string {
  const lines: string[] = [];
  lines.push('# 阵营胜率军备竞赛分析报告(自动生成)');
  lines.push('');
  lines.push(`> 由 \`server/tools/arms-race.ts\` 生成 · ${report.games} 局/迭代 · seed=${report.seed} · fixture 确定性`);
  lines.push('> 同 seed、同随机流、同人类陪跑;**唯一变量是技能档位**——故胜率 diff 可归因于策略技能本身。');
  lines.push('');

  lines.push('## 1. 各迭代胜率快照');
  lines.push('');
  lines.push('| 迭代 | 平民胜率 | 卧底胜率 | 完局率 |');
  lines.push('| --- | --- | --- | --- |');
  for (const it of report.iterations) {
    lines.push(
      `| \`${it.skill.id}\`<br>${it.skill.label} | ${fmtPct(it.civilianWinRate)} | ${fmtPct(it.undercoverWinRate)} | ${fmtPct(it.completionRate)} |`,
    );
  }
  lines.push('');

  lines.push('## 2. 迭代逐步摆动(后一版 − 前一版)');
  lines.push('');
  lines.push('| 迭代步 | 平民胜率Δ | 卧底胜率Δ | 期望 | 实际 | 摆动一致 |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const s of report.steps) {
    lines.push(
      `| ${s.from} → ${s.to} | ${fmtDelta(s.civilianDelta)} | ${fmtDelta(s.undercoverDelta)} | ${ADVANTAGE_LABEL[s.expected]} | ${ADVANTAGE_LABEL[s.actual]} | ${s.swungAsExpected ? '✓' : '✗'} |`,
    );
  }
  lines.push('');

  lines.push('## 3. 军备竞赛裁决');
  lines.push('');
  if (report.armsRaceHolds) {
    lines.push('**✅ 军备竞赛成立**:三步摆动均按设计意图发生——');
    lines.push('平民觉醒 → 平民更容易赢;卧底反制 → 卧底扳回;平民精进 → 平民再度占优。每一步都在 100% 完局下取得。');
    lines.push('这正是「基于 benchmark 与数据不断迭代、能看到某一方胜率被提升」的闭环证据。');
  } else {
    lines.push('**⚠ 摆动未完全成立**:至少一步的胜率变化方向与设计意图不符(见上表「摆动一致」列),或存在未完局。');
    lines.push('需回看该步技能档位标定或增大 games/换 seed 复核。');
  }
  lines.push('');

  lines.push('## 4. 技能档位的数据依据');
  lines.push('');
  lines.push('- 技能差异映成胜率摆动**有语料出处**:`npm run data:outcomes` 从 werewolf train split 的');
  lines.push('  `votingOutcome`/`endRoles` 挖出——村民类比方经验胜率 ≈ **58.8%**、不同说服话风簇的获胜占比在');
  lines.push('  **48%–57%** 区间(见 `data/normalized/outcome-correlation-report.json`)。这证实「阵营与话风都对');
  lines.push('  胜负有可测影响」,故把「更强的识别/伪装技能」映成某一方胜率上升,是有依据的设定而非凭空。');
  lines.push('');

  lines.push('## 5. 方法学与诚实边界');
  lines.push('');
  lines.push('- **胜负因果链**:描述由词决定「锚句簇」——平民同词聚簇、卧底异词离群;技术高的卧底以概率');
  lines.push('  借用平民锚句「融入」。投票时平民按公开描述的**离群度**锁定卧底(概率=civSkill),卧底则');
  lines.push('  「转移火力」投向最像平民者(概率=spyDeflect)。技能↑ → 抓/逃更准 → 淘汰谁改变 → 胜率摆动。');
  lines.push('- **只读公开信息**:投票只用 `publicDescriptions` 与自身身份算离群度,**绝不触碰他人 role/word**——');
  lines.push('  终局前隔离不变量原样保持(与生产/契约路径一致)。');
  lines.push('- **确定性**:技能门用 (voterId, 轮次, 自身词, 盐) 的 FNV 哈希取伪随机,无 Math.random/无墙钟,');
  lines.push('  同 seed 逐字节可复现。');
  lines.push('- **非人类逐局回放 / 迁移信号**:胜率摆动是**仿真**耦合的产物;werewolf(ONUW)≠谁是卧底,');
  lines.push('  是跨游戏迁移的经验依据。三段摆动是**为演示军备竞赛动态而设计**的确定性机制,读作「策略技能→');
  lines.push('  胜率」的因果演示,而非「真机达到该胜率」。真机墙钟/成本另由 `--real` 模式单列(本报告不含)。');
  return lines.join('\n');
}
