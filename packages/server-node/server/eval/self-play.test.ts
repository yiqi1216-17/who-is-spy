import { describe, expect, it } from 'vitest';
import { FakeGameModel } from '../test-utils.js';
import type { AgentContext } from '../types.js';
import { mulberry32, runSelfPlayBatch } from './self-play.js';

/**
 * 无头自博弈 harness(OpenSpec 04 · Task 1.2 / 1.3)
 *
 * 断言四条:① 批量能无交互跑到终局;② 同 seed 同批**逐字节可复现**(稳定投影相等);
 * ③ 共享随机流让局与局各异(覆盖不同角色/终局);④ 注入必然泄题的模型 → 质量穷尽 →
 * 引擎原子终止 → harness 记为「未完成」并带回 policyCode(为 completion 门禁供给失败信号)。
 */

/** 抽取跨运行稳定的投影(剔除 randomUUID 的 id 与 Date.now 的 createdAt)。 */
function stableProjection(results: Awaited<ReturnType<typeof runSelfPlayBatch>>) {
  return results.map((r) => ({
    completed: r.completed,
    winner: r.internal.winner,
    round: r.internal.round,
    calls: r.calls,
    descriptions: r.internal.descriptions.map((d) => ({
      playerId: d.playerId,
      text: d.text,
      round: d.round,
    })),
    voteTargets: r.internal.votes.map((v) => `${v.voterId}->${v.targetId}@${v.round}.${v.ballot}`),
  }));
}

describe('mulberry32 · 确定性伪随机', () => {
  it('同种子同序列;不同种子不同序列', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(7);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    const seqC = [c(), c(), c(), c()];
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
    for (const x of [...seqA, ...seqC]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('自博弈批量 · 无交互跑到终局', () => {
  it('每局都收束到 finished、winner 非空、completed=true', async () => {
    const results = await runSelfPlayBatch(new FakeGameModel(), { games: 6, seed: 1 });
    expect(results).toHaveLength(6);
    for (const r of results) {
      expect(r.completed).toBe(true);
      expect(r.internal.phase).toBe('finished');
      expect(r.internal.winner === 'civilian' || r.internal.winner === 'undercover').toBe(true);
      // 每局至少一次描述与投票调用;假模型无重试 → describe 调用数 == AI 描述条数。
      const aiDescs = r.internal.descriptions.filter((d) => d.playerId !== 'human').length;
      expect(r.calls.describeCalls).toBe(aiDescs);
      expect(r.calls.describeCalls).toBeGreaterThan(0);
      expect(r.calls.voteCalls).toBeGreaterThan(0);
    }
  });
});

describe('自博弈批量 · 逐字节可复现(Task 1.2)', () => {
  it('同 seed 同批,两次运行的稳定投影完全相等', async () => {
    const first = await runSelfPlayBatch(new FakeGameModel(), { games: 6, seed: 1 });
    const second = await runSelfPlayBatch(new FakeGameModel(), { games: 6, seed: 1 });
    expect(stableProjection(first)).toEqual(stableProjection(second));
  });

  it('不同 seed 产生不同的对局序列', async () => {
    const s1 = await runSelfPlayBatch(new FakeGameModel(), { games: 6, seed: 1 });
    const s2 = await runSelfPlayBatch(new FakeGameModel(), { games: 6, seed: 999 });
    expect(stableProjection(s1)).not.toEqual(stableProjection(s2));
  });
});

describe('自博弈批量 · 共享随机流带来对局多样性(Task 1.3)', () => {
  it('一批内卧底落位不止一种(覆盖不同角色分布)', async () => {
    const results = await runSelfPlayBatch(new FakeGameModel(), { games: 8, seed: 1 });
    const undercoverSeats = new Set(
      results.map((r) => r.internal.players.find((p) => p.role === 'undercover')?.id),
    );
    expect(undercoverSeats.size).toBeGreaterThanOrEqual(2);
  });
});

describe('自博弈批量 · 注入泄题模型 → 原子终止(CH-4 的评测侧闭环)', () => {
  /** 描述恒吐自身密词:必被质量门判 exact_leak,重试耗尽后整回合原子终止。 */
  class LeakyModel extends FakeGameModel {
    async describe(context: AgentContext): Promise<string> {
      return context.identity.word;
    }
  }

  it('每局记为未完成,并带回 policyCode(exact_leak),而非静默通过', async () => {
    const results = await runSelfPlayBatch(new LeakyModel(), { games: 3, seed: 1 });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.completed).toBe(false);
      expect(r.abortCode).toBe('exact_leak');
      // 原子终止:committed 状态未推进到 voting/finished(草稿被丢弃)。
      expect(r.internal.phase).toBe('describing');
    }
  });
});
