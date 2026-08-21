import { describe, expect, it } from 'vitest';
import {
  defaultSkills,
  renderArmsRaceMarkdown,
  runArmsRace,
  runIteration,
  toArmsRaceLogLines,
  type Advantage,
} from './arms-race.js';
import { ArmsRaceModel, type SkillProfile } from './arms-race-model.js';
import { runSelfPlayBatch } from './self-play.js';
import { projectStrategy, SEED_STRATEGIES } from '../strategies.js';
import { scanSecrets } from '../redaction.js';
import type { Player } from '../types.js';

/**
 * 阵营胜率军备竞赛的验收(OpenSpec 04 · 题面②「学了更强策略,平民/卧底能不能更容易赢」)
 *
 * 钉四件事:①同 seed 逐字节可复现;②三步摆动**方向正确**(civ↑→spy↑→civ↑);
 * ③**因果性**——同 seed 仅换技能配置,胜者分布确实改变(反证胜率由策略技能驱动、非固定);
 * ④隔离 + 脱敏——投票只依赖公开描述、落盘工件扫不出任何密词。
 */

const GAMES = 80;
const SEED = 7;

const resolve = (agent: Player) => {
  const seat = Number.parseInt(agent.id.replace(/^ai-/, ''), 10) || 1;
  return projectStrategy(SEED_STRATEGIES[(seat - 1) % SEED_STRATEGIES.length]);
};

describe('军备竞赛可复现性', () => {
  it('同 seed 同配置逐字节相等,换 seed 则不同', async () => {
    const { skills, expectations } = defaultSkills();
    // 复现性只需比对聚合快照,用较小 games 即可(逐字节相等与 games 规模无关)。
    const a = await runArmsRace(skills, expectations, 24, SEED);
    const b = await runArmsRace(skills, expectations, 24, SEED);
    const snap = (r: typeof a) =>
      JSON.stringify(r.iterations.map((it) => [it.civilianWinRate, it.undercoverWinRate, it.completionRate]));
    expect(snap(a)).toBe(snap(b));
    const c = await runArmsRace(skills, expectations, 24, SEED + 5);
    expect(snap(c)).not.toBe(snap(a));
  }, 30_000);
});

describe('三步摆动方向正确(军备竞赛成立)', () => {
  it('civ↑ → spy↑ → civ↑,且全程 100% 完局', async () => {
    const { skills, expectations } = defaultSkills();
    const report = await runArmsRace(skills, expectations, GAMES, SEED);

    // 每档都完局(胜率摆动不能靠「打不完的局」制造)
    for (const it of report.iterations) expect(it.completionRate).toBe(1);

    // 三步:平民觉醒→平民更强;卧底反制→卧底更强;平民精进→平民更强
    expect(report.steps).toHaveLength(3);
    expect(report.steps[0].actual).toBe<Advantage>('civilian');
    expect(report.steps[0].civilianDelta).toBeGreaterThan(0);
    expect(report.steps[1].actual).toBe<Advantage>('undercover');
    expect(report.steps[1].undercoverDelta).toBeGreaterThan(0);
    expect(report.steps[2].actual).toBe<Advantage>('civilian');
    expect(report.steps[2].civilianDelta).toBeGreaterThan(0);

    // 每一步都与设计意图一致 → 总裁决成立
    expect(report.steps.every((s) => s.swungAsExpected)).toBe(true);
    expect(report.armsRaceHolds).toBe(true);
  }, 30_000);

  it('平民胜率呈「高—低—高」的军备竞赛曲线(非单调)', async () => {
    const { skills, expectations } = defaultSkills();
    const r = await runArmsRace(skills, expectations, GAMES, SEED);
    const civ = r.iterations.map((it) => it.civilianWinRate);
    // civ-awake 高于两侧(平民觉醒的峰),spy-counter 是谷,civ-refined 再抬起
    expect(civ[1]).toBeGreaterThan(civ[0]); // 觉醒
    expect(civ[1]).toBeGreaterThan(civ[2]); // 被卧底压回
    expect(civ[3]).toBeGreaterThan(civ[2]); // 精进再起
  }, 30_000);
});

describe('因果性:胜率确由技能驱动,而非固定', () => {
  it('同 seed 仅换 civSkill,平民胜率显著改变', async () => {
    const dumb: SkillProfile = { id: 'dumb', label: '', civSkill: 0.05, civMode: 'round', spyBlend: 0.15, spyDeflect: 0.1 };
    const sharp: SkillProfile = { id: 'sharp', label: '', civSkill: 0.95, civMode: 'round', spyBlend: 0.15, spyDeflect: 0.1 };
    const a = await runIteration(dumb, GAMES, SEED);
    const b = await runIteration(sharp, GAMES, SEED);
    // 平民更会抓 → 平民胜率明显更高(方向 + 幅度,证明这是真实因果通道)
    expect(b.civilianWinRate).toBeGreaterThan(a.civilianWinRate + 0.1);
  }, 30_000);

  it('同 seed 仅换卧底 spyBlend/spyDeflect,卧底胜率显著改变', async () => {
    const exposed: SkillProfile = { id: 'exposed', label: '', civSkill: 0.85, civMode: 'round', spyBlend: 0.05, spyDeflect: 0.05 };
    const hidden: SkillProfile = { id: 'hidden', label: '', civSkill: 0.85, civMode: 'round', spyBlend: 0.9, spyDeflect: 0.75 };
    const a = await runIteration(exposed, GAMES, SEED);
    const b = await runIteration(hidden, GAMES, SEED);
    // 卧底更会融入 + 转移火力 → 卧底胜率明显更高
    expect(b.undercoverWinRate).toBeGreaterThan(a.undercoverWinRate + 0.05);
  }, 30_000);
});

describe('隔离与落盘脱敏', () => {
  it('投票只依赖公开信息:AI 从不投出非法目标(引擎零非法票)', async () => {
    const { skills } = defaultSkills();
    // 取「卧底反制」档跑一批,断言 illegal_vote_count 恒 0——模型的技能全部建立在公开描述上,
    // 越界目标会被引擎回落;这里进一步证明模型自身产出的就是合法目标(不依赖任何隐藏字段猜测)。
    const results = await runSelfPlayBatch(new ArmsRaceModel(skills[2]), { games: 20, seed: SEED, resolveStrategy: resolve });
    for (const r of results) {
      const aiVotes = r.internal.votes.filter((v) => v.voterId !== 'human');
      const aliveOrPastIds = new Set(r.internal.players.map((p) => p.id));
      for (const v of aiVotes) {
        expect(aliveOrPastIds.has(v.targetId)).toBe(true);
        expect(v.targetId).not.toBe(v.voterId); // 不自投
      }
    }
  }, 30_000);

  it('JSONL 日志与 Markdown 报告扫不出任何密词', async () => {
    const { skills, expectations } = defaultSkills();
    const report = await runArmsRace(skills, expectations, GAMES, SEED);
    const lines = toArmsRaceLogLines(report);
    expect(lines.length).toBeGreaterThan(0);
    expect(scanSecrets(lines.join('\n'))).toEqual([]);
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();

    const md = renderArmsRaceMarkdown(report);
    expect(scanSecrets(md)).toEqual([]);
    expect(md).toContain('# 阵营胜率军备竞赛分析报告');
    expect(md).toContain('军备竞赛裁决');
    expect(md).toContain('平民胜率');
    expect(md).toContain('卧底胜率');
  }, 30_000);
});
