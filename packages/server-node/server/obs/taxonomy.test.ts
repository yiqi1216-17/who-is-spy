import { describe, expect, it } from 'vitest';
import { ModelError } from '../model.js';
import { type FailureClass, classifyFailure } from './failure-taxonomy.js';
import { syntheticError } from './fault-injection.js';

const ALL: FailureClass[] = [
  'timeout',
  'rate_limit',
  'upstream',
  'malformed_json',
  'schema',
  'illegal_target',
  'policy',
  'auth_config',
  'unknown',
];

describe('故障分类学 · 9 类往返', () => {
  it.each(ALL)('syntheticError(%s) 被 classifyFailure 归回同一类', (cls) => {
    expect(classifyFailure(syntheticError(cls)).failureClass).toBe(cls);
  });

  it('auth_config / policy 不可重试;其余 7 类可重试', () => {
    for (const cls of ALL) {
      const c = classifyFailure(syntheticError(cls));
      const nonRetryable = cls === 'auth_config' || cls === 'policy';
      expect(c.retryable).toBe(!nonRetryable);
    }
  });

  it('内容类 outcome=rejected;基础设施类 outcome=error', () => {
    for (const cls of ['policy', 'illegal_target', 'schema'] as const) {
      expect(classifyFailure(syntheticError(cls)).outcome).toBe('rejected');
    }
    for (const cls of ['timeout', 'rate_limit', 'upstream', 'malformed_json', 'auth_config', 'unknown'] as const) {
      expect(classifyFailure(syntheticError(cls)).outcome).toBe('error');
    }
  });

  it('policy 类把具体质量码带进 policyCode(exact_leak)', () => {
    expect(classifyFailure(syntheticError('policy')).policyCode).toBe('exact_leak');
  });

  it('rate_limit 尊重 Retry-After(毫秒)', () => {
    const c = classifyFailure(syntheticError('rate_limit', { retryAfterMs: 5000 }));
    expect(c.failureClass).toBe('rate_limit');
    expect(c.retryAfterMs).toBe(5000);
  });

  it('解包真实 DeepSeekClient 包装:cause 链里的 5xx → upstream', () => {
    const wrapped = new ModelError('AI 服务暂时不可用，已自动重试；请稍后再试', new Error('DeepSeek 503: upstream boom'));
    expect(classifyFailure(wrapped).failureClass).toBe('upstream');
  });

  it('429 藏在 cause.message → rate_limit', () => {
    const wrapped = new ModelError('AI 服务暂时不可用', new Error('DeepSeek 429: Too Many Requests'));
    expect(classifyFailure(wrapped).failureClass).toBe('rate_limit');
  });

  it('未配置密钥 → auth_config(不可重试,快速失败)', () => {
    const err = new ModelError('未配置 DEEPSEEK_API_KEY，请复制 .env.example 为 .env 后填写密钥');
    const c = classifyFailure(err);
    expect(c.failureClass).toBe('auth_config');
    expect(c.retryable).toBe(false);
  });

  it('空 / 未知错误 → unknown 且可重试(兜底不吞)', () => {
    expect(classifyFailure(new Error('something weird happened')).failureClass).toBe('unknown');
    expect(classifyFailure(null).failureClass).toBe('unknown');
    expect(classifyFailure(undefined).failureClass).toBe('unknown');
  });
});
