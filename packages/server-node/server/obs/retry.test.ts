import { describe, expect, it } from 'vitest';
import { syntheticError } from './fault-injection.js';
import { DEFAULT_RETRY, recordingClock, withRetry } from './retry.js';

describe('withRetry · 有界退避(注入时钟,绝不真的等待)', () => {
  it('指数退避序列(jitter=1 满额):100 → 200 → 400', async () => {
    const clock = recordingClock(1);
    await expect(
      withRetry(async () => {
        throw syntheticError('upstream');
      }, { policy: { maxAttempts: 4, baseDelayMs: 100, maxDelayMs: 10_000 }, clock }),
    ).rejects.toThrow();
    expect(clock.delays).toEqual([100, 200, 400]); // 4 次尝试 → 3 次退避
  });

  it('抖动下界(jitter=0):退避减半', async () => {
    const clock = recordingClock(0);
    await expect(
      withRetry(async () => {
        throw syntheticError('upstream');
      }, { policy: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 10_000 }, clock }),
    ).rejects.toThrow();
    expect(clock.delays).toEqual([50]);
  });

  it('尊重 Retry-After 且受 maxDelay 封顶', async () => {
    const clock = recordingClock(1);
    await expect(
      withRetry(async () => {
        throw syntheticError('rate_limit', { retryAfterMs: 5000 });
      }, { policy: { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 2000 }, clock }),
    ).rejects.toThrow();
    expect(clock.delays).toEqual([2000]); // min(2000, 5000)
  });

  it('不可重试(auth_config)首次即抛,零等待', async () => {
    const clock = recordingClock();
    const lineage: number[] = [];
    await expect(
      withRetry(async () => {
        throw syntheticError('auth_config');
      }, { clock, onAttempt: ({ attempt, willRetry }) => lineage.push(willRetry ? attempt : -attempt) }),
    ).rejects.toThrow();
    expect(clock.delays).toEqual([]);
    expect(lineage).toEqual([-1]); // 一次尝试,willRetry=false
  });

  it('瞬时故障后成功:提前返回,只退避一次,onSuccess 报第 2 次', async () => {
    const clock = recordingClock(1);
    let calls = 0;
    let successAttempt = 0;
    const value = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) throw syntheticError('upstream');
        return 'ok';
      },
      {
        policy: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 10_000 },
        clock,
        onSuccess: (a) => {
          successAttempt = a;
        },
      },
    );
    expect(value).toBe('ok');
    expect(clock.delays).toEqual([100]);
    expect(successAttempt).toBe(2);
  });

  it('尝试世系:每次失败一条,分类逐条可见', async () => {
    const clock = recordingClock(1);
    const classes: string[] = [];
    await expect(
      withRetry(async () => {
        throw syntheticError('timeout');
      }, {
        policy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10 },
        clock,
        onAttempt: ({ classification }) => classes.push(classification.failureClass),
      }),
    ).rejects.toThrow();
    expect(classes).toEqual(['timeout', 'timeout', 'timeout']);
  });

  it('DEFAULT_RETRY 为 3 次尝试', () => {
    expect(DEFAULT_RETRY.maxAttempts).toBe(3);
  });
});
