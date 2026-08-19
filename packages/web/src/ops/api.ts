/**
 * 观测台专用 API 薄层(题面任务线③前端呈现)。
 * 刻意**不**复用 `../api.ts`:观测台只消费 dev-only 的 /api/ops/* 附加端点,
 * 与游戏客户端零耦合;生产构建不含本目录(ops.html 不在构建入口)。
 */

export type TraceBoundary = 'model.describe' | 'model.vote' | 'model.review' | 'hook';
export type TraceOutcome = 'accepted' | 'rejected' | 'error';

export interface TraceData {
  correlationId: string;
  gameId?: string;
  round: number;
  ballot?: number;
  boundary: TraceBoundary;
  playerId?: string;
  attempt: number;
  outcome: TraceOutcome;
  policyCode?: string;
  latencyMs?: number;
  candidateHash?: string;
  candidateLength?: number;
}

export interface TraceEnvelope {
  v: number;
  kind: string;
  data: TraceData;
}

export interface TraceResponse {
  total: number;
  count: number;
  scanClean: boolean;
  events: TraceEnvelope[];
}

export type FaultBoundary = 'describe' | 'vote' | 'review';
export type FailureClass =
  | 'timeout'
  | 'rate_limit'
  | 'upstream'
  | 'malformed_json'
  | 'schema'
  | 'illegal_target'
  | 'policy'
  | 'auth_config'
  | 'unknown';

export interface FaultSpec {
  boundary: FaultBoundary;
  failClass: FailureClass;
  times?: number;
  retryAfterMs?: number;
}

export interface FaultStatus {
  armed: boolean;
  spec?: FaultSpec;
  /** 剩余注入次数;null = 恒失败。 */
  remaining?: number | null;
  injected: number;
}

export interface MetricRow {
  key: string;
  value: number;
  n: number;
}

export interface EvalResponse {
  games: number;
  seed: number;
  demoFail: boolean;
  report: {
    v: number;
    kind: string;
    data: { suite: string; milestone: string; sampleSize: number; metrics: MetricRow[] };
  };
  gate: { passed: boolean; failures: Array<{ code: string; detail: string }> };
}

export interface HealthResponse {
  ok: boolean;
  model: string;
  configured: boolean;
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(body?.error ?? `HTTP ${response.status}`);
  }
  return body as T;
}

export interface TraceQuery {
  gameId?: string;
  boundary?: string;
  outcome?: string;
  correlationId?: string;
  limit?: number;
}

export function fetchTrace(query: TraceQuery): Promise<TraceResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return http<TraceResponse>(`/api/ops/trace${qs ? `?${qs}` : ''}`);
}

export function fetchFaults(): Promise<FaultStatus> {
  return http<FaultStatus>('/api/ops/faults');
}

export function armFault(spec: FaultSpec): Promise<FaultStatus> {
  return http<FaultStatus>('/api/ops/faults', { method: 'POST', body: JSON.stringify(spec) });
}

export function disarmFault(): Promise<FaultStatus> {
  return http<FaultStatus>('/api/ops/faults', { method: 'DELETE' });
}

export interface EvalInput {
  games: number;
  seed: number;
  demoFail: boolean;
}

export function runEval(input: EvalInput): Promise<EvalResponse> {
  return http<EvalResponse>('/api/ops/eval', { method: 'POST', body: JSON.stringify(input) });
}

export function fetchHealth(): Promise<HealthResponse> {
  return http<HealthResponse>('/api/health');
}
