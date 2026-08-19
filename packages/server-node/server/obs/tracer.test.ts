import { describe, expect, it } from 'vitest';
import { type TraceEvent, envelope, parseVersioned } from '../schema.js';
import { MemoryTraceSink, POLICY_CODES, emitTrace, scanTraceArtifacts, traceHookResults } from './tracer.js';

const base: TraceEvent = {
  correlationId: 'corr-1',
  round: 1,
  boundary: 'model.describe',
  attempt: 1,
  outcome: 'accepted',
};

describe('tracer · 脱敏 trace 汇', () => {
  it('emitTrace 产出可被 parseVersioned 校验的版本化信封', () => {
    const sink = new MemoryTraceSink();
    const event = emitTrace(sink, base);
    expect(event.kind).toBe('traceEvent');
    expect(event.v).toBe(1);
    expect(() => parseVersioned('traceEvent', event)).not.toThrow();
    expect(sink.events()).toHaveLength(1);
  });

  it('policyCode 允许列:非登记短码与密词一律被拒', () => {
    const sink = new MemoryTraceSink();
    expect(() => emitTrace(sink, { ...base, outcome: 'error', policyCode: 'not-a-code' })).toThrow();
    expect(() => emitTrace(sink, { ...base, outcome: 'error', policyCode: '拿铁' })).toThrow();
    expect(sink.events()).toHaveLength(0);
  });

  it('strict schema 结构上拒绝任何未登记字段(自由文本 / CoT 无处容身)', () => {
    const sink = new MemoryTraceSink();
    expect(() => emitTrace(sink, { ...base, reasoning: '我觉得他是卧底' } as never)).toThrow();
    expect(sink.events()).toHaveLength(0);
  });

  it('scanTraceArtifacts 抓出被误塞进结构位的密词', () => {
    const dirty = envelope('traceEvent', { ...base, correlationId: '拿铁-corr' });
    expect(scanTraceArtifacts([dirty])).toContain('拿铁');
    const clean = envelope('traceEvent', base);
    expect(scanTraceArtifacts([clean])).toEqual([]);
  });

  it('traceHookResults:ok→accepted / timeout→hook_timeout / error→hook_error', () => {
    const sink = new MemoryTraceSink();
    traceHookResults(sink, {
      correlationId: 'c',
      round: 2,
      results: [
        { name: 'a', outcome: 'ok' },
        { name: 'b', outcome: 'timeout' },
        { name: 'c', outcome: 'error' },
      ],
    });
    const hooks = sink.byBoundary('hook');
    expect(hooks.map((h) => h.data.outcome)).toEqual(['accepted', 'error', 'error']);
    expect(hooks.map((h) => h.data.policyCode)).toEqual([undefined, 'hook_timeout', 'hook_error']);
  });

  it('POLICY_CODES 覆盖 9 类失败 + 质量码 + hook 码', () => {
    for (const code of [
      'timeout', 'rate_limit', 'upstream', 'malformed_json', 'schema', 'illegal_target',
      'policy', 'auth_config', 'unknown', 'exact_leak', 'too_similar', 'hook_timeout', 'hook_error',
    ]) {
      expect(POLICY_CODES).toContain(code);
    }
  });
});
