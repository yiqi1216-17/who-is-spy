import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type EvalResponse,
  type FailureClass,
  type FaultBoundary,
  type FaultStatus,
  type HealthResponse,
  type MetricRow,
  type TraceData,
  type TraceResponse,
  armFault,
  disarmFault,
  fetchFaults,
  fetchHealth,
  fetchTrace,
  runEval,
} from './api';

/**
 * 观测台(题面任务线③的前端呈现:评测面板 / trace 视图 / 故障注入开关)
 *
 * 横屏控制台布局:左栏 = 故障注入开关(作用于**真实模型链**);右栏 = 决策追踪 / 评测面板两页。
 * 只消费 dev-only /api/ops/*;所有数据都是结构性脱敏的版本化 trace 信封与聚合指标,
 * 无 role/word/prompt/信念/自由文本可显示——想泄也没有字段可放(strict schema)。
 */
export function OpsConsole() {
  const [tab, setTab] = useState<'trace' | 'eval'>('trace');
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    fetchHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  return (
    <div className="ops-root">
      <header className="ops-header">
        <div className="ops-title">
          <span className="ops-mark">◉</span> 谁是卧底 · 观测台
          <span className="ops-devtag">DEV ONLY</span>
        </div>
        <nav className="ops-tabs" aria-label="面板切换">
          <button type="button" className={tab === 'trace' ? 'on' : ''} onClick={() => setTab('trace')}>
            决策追踪
          </button>
          <button type="button" className={tab === 'eval' ? 'on' : ''} onClick={() => setTab('eval')}>
            评测面板
          </button>
        </nav>
        <div className="ops-health">
          {health ? (
            <>
              <span className={`ops-dot ${health.configured ? 'ok' : 'warn'}`} />
              模型 {health.model} · {health.configured ? '已配置' : '未配置(fake 路径)'}
            </>
          ) : (
            <>
              <span className="ops-dot err" /> 后端未连接(:8787)
            </>
          )}
          <a className="ops-back" href="/">
            ← 回到牌桌
          </a>
        </div>
      </header>

      <div className="ops-body">
        <aside className="ops-side">
          <FaultPanel />
          <section className="ops-card ops-note">
            <h3>怎么演示降级</h3>
            <ol>
              <li>左侧注入一个故障(如 describe · upstream · 1 次);</li>
              <li>去「牌桌」玩一局,或跑一桌上帝局;</li>
              <li>回「决策追踪」:同一世系里看到 error → accepted 的重试恢复;</li>
              <li>换恒失败 auth_config:命令快速失败,对局状态整回合原子回滚。</li>
            </ol>
            <p className="ops-dim">
              生产禁用:本页不进生产构建;生产服务端不挂 /api/ops/*、模型链上无故障面、arm 自校环境。
            </p>
          </section>
        </aside>

        <main className="ops-main">{tab === 'trace' ? <TracePanel /> : <EvalPanel />}</main>
      </div>
    </div>
  );
}

// ============================== 故障注入开关 ==============================

const BOUNDARY_LABELS: Record<FaultBoundary, string> = {
  describe: '描述 describe',
  vote: '投票 vote',
  review: '复盘 review',
};

const FAILURE_LABELS: Record<FailureClass, string> = {
  timeout: '超时 timeout',
  rate_limit: '限流 429 rate_limit',
  upstream: '上游 5xx upstream',
  malformed_json: '坏 JSON malformed_json',
  schema: '结构不合法 schema',
  illegal_target: '非法目标 illegal_target',
  policy: '策略拒绝 policy',
  auth_config: '鉴权缺失 auth_config(不可重试)',
  unknown: '未知 unknown',
};

function FaultPanel() {
  const [status, setStatus] = useState<FaultStatus | null>(null);
  const [boundary, setBoundary] = useState<FaultBoundary>('describe');
  const [failClass, setFailClass] = useState<FailureClass>('upstream');
  const [persistent, setPersistent] = useState(false);
  const [times, setTimes] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    fetchFaults().then(setStatus).catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const act = async (fn: () => Promise<FaultStatus>) => {
    setBusy(true);
    setError(null);
    try {
      setStatus(await fn());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ops-card">
      <h3>故障注入开关</h3>
      {status?.armed && status.spec ? (
        <p className="ops-pill armed">
          已注入 {BOUNDARY_LABELS[status.spec.boundary]} · {FAILURE_LABELS[status.spec.failClass]} ·{' '}
          {status.remaining === null ? '恒失败' : `剩 ${status.remaining} 次`} · 已触发 {status.injected} 次
        </p>
      ) : (
        <p className="ops-pill idle">未注入{status ? ` · 上次共触发 ${status.injected} 次` : ''}</p>
      )}

      <label className="ops-field">
        <span>边界</span>
        <select value={boundary} onChange={(e) => setBoundary(e.target.value as FaultBoundary)}>
          {(Object.keys(BOUNDARY_LABELS) as FaultBoundary[]).map((key) => (
            <option key={key} value={key}>
              {BOUNDARY_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      <label className="ops-field">
        <span>故障类</span>
        <select value={failClass} onChange={(e) => setFailClass(e.target.value as FailureClass)}>
          {(Object.keys(FAILURE_LABELS) as FailureClass[]).map((key) => (
            <option key={key} value={key}>
              {FAILURE_LABELS[key]}
            </option>
          ))}
        </select>
      </label>

      <label className="ops-check">
        <input type="checkbox" checked={persistent} onChange={(e) => setPersistent(e.target.checked)} />
        恒失败(演示原子回滚)
      </label>

      {!persistent && (
        <label className="ops-field">
          <span>失败次数</span>
          <input
            type="number"
            min={1}
            max={999}
            value={times}
            onChange={(e) => setTimes(Math.max(1, Math.min(999, Number(e.target.value) || 1)))}
          />
        </label>
      )}

      <div className="ops-actions">
        <button
          type="button"
          className="danger"
          disabled={busy}
          onClick={() =>
            act(() => armFault({ boundary, failClass, ...(persistent ? {} : { times }) }))
          }
        >
          注入故障
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => act(disarmFault)}>
          解除
        </button>
      </div>
      {error && <p className="ops-error">{error}</p>}
    </section>
  );
}

// ============================== 决策追踪 ==============================

function TracePanel() {
  const [gameId, setGameId] = useState('');
  const [boundary, setBoundary] = useState('');
  const [outcome, setOutcome] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [data, setData] = useState<TraceResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchTrace({ gameId, boundary, outcome, limit: 300 })
      .then((res) => {
        setData(res);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [gameId, boundary, outcome]);

  useEffect(() => {
    load();
    if (!autoRefresh) return;
    const timer = window.setInterval(load, 2500);
    return () => window.clearInterval(timer);
  }, [load, autoRefresh]);

  const rows = useMemo(() => (data ? data.events.map((e) => e.data) : []), [data]);
  const stats = useMemo(
    () => ({
      errors: rows.filter((r) => r.outcome === 'error').length,
      rejected: rows.filter((r) => r.outcome === 'rejected').length,
      lineages: new Set(rows.map((r) => r.correlationId)).size,
    }),
    [rows],
  );

  return (
    <section className="ops-panel">
      <div className="ops-toolbar">
        <input
          placeholder="按 gameId 过滤(哪一局)"
          value={gameId}
          onChange={(e) => setGameId(e.target.value.trim())}
        />
        <select value={boundary} onChange={(e) => setBoundary(e.target.value)}>
          <option value="">全部边界</option>
          <option value="model.describe">model.describe</option>
          <option value="model.vote">model.vote</option>
          <option value="model.review">model.review</option>
          <option value="hook">hook</option>
        </select>
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">全部结局</option>
          <option value="accepted">accepted</option>
          <option value="rejected">rejected</option>
          <option value="error">error</option>
        </select>
        <label className="ops-check inline">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          自动刷新
        </label>
        <button type="button" className="ghost" onClick={load}>
          刷新
        </button>
        <span className="ops-stats">
          {data ? `${data.count}/${data.total} 条` : '—'} · 世系 {stats.lineages} ·
          <em className="err">error {stats.errors}</em> · <em className="warn">rejected {stats.rejected}</em>
          {data?.scanClean && <em className="ok"> · 哨兵已扫,无机密</em>}
        </span>
      </div>

      {error && <p className="ops-error">{error}</p>}

      <div className="ops-tablewrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>#</th>
              <th>局</th>
              <th>世系</th>
              <th>边界</th>
              <th>座位</th>
              <th>轮·票</th>
              <th>尝试</th>
              <th>结局</th>
              <th>短码</th>
              <th>延迟</th>
              <th>候选指纹</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="ops-empty">
                  暂无 trace——去玩一局(或左侧注入故障后玩一局),这里会实时出现决策世系。
                </td>
              </tr>
            )}
            {rows.map((row, index) => (
              <TraceRow
                key={`${row.correlationId}-${row.attempt}-${index}`}
                row={row}
                index={index}
                newLineage={index === 0 || rows[index - 1].correlationId !== row.correlationId}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="ops-dim ops-foot">
        每条 trace 是 strict schema 的版本化信封:局 / 轮·票 / 座位 / 尝试 / 结局 / 短码五维定位,
        被拒候选只余不可逆指纹(hash·长度)——结构上没有密词、prompt、信念或自由文本的容身之处。
      </p>
    </section>
  );
}

function TraceRow({ row, index, newLineage }: { row: TraceData; index: number; newLineage: boolean }) {
  return (
    <tr className={`${newLineage ? 'lineage-head' : ''} out-${row.outcome}`}>
      <td className="dim">{index + 1}</td>
      <td className="mono" title={row.gameId ?? ''}>
        {row.gameId ? row.gameId.slice(0, 8) : '—'}
      </td>
      <td className={`mono ${newLineage ? '' : 'dim'}`}>{row.correlationId}</td>
      <td>{row.boundary}</td>
      <td>{row.playerId ?? '—'}</td>
      <td>
        R{row.round}
        {row.ballot !== undefined ? `·B${row.ballot}` : ''}
      </td>
      <td className="mono">{row.attempt}</td>
      <td>
        <span className={`ops-badge ${row.outcome}`}>{row.outcome}</span>
      </td>
      <td className="mono">{row.policyCode ?? '—'}</td>
      <td className="mono">{row.latencyMs !== undefined ? `${row.latencyMs.toFixed(0)}ms` : '—'}</td>
      <td className="mono dim">
        {row.candidateHash ? `${row.candidateHash}·${row.candidateLength ?? '?'}字` : '—'}
      </td>
    </tr>
  );
}

// ============================== 评测面板 ==============================

interface MetricSpec {
  key: string;
  label: string;
  kind: 'pct' | 'num' | 'count';
  ciKey?: string;
  hint?: string;
}

const METRIC_GROUPS: Array<{ title: string; items: MetricSpec[] }> = [
  {
    title: '安全不变量(应恒 0)',
    items: [
      { key: 'leak_count', label: '泄题条数', kind: 'count' },
      { key: 'illegal_vote_count', label: '非法投票', kind: 'count' },
    ],
  },
  {
    title: '完成度',
    items: [
      { key: 'completion_rate', label: '完成率', kind: 'pct', ciKey: 'completion_rate_ci95' },
      { key: 'mean_rounds', label: '平均轮数', kind: 'num' },
    ],
  },
  {
    title: '差异化(反转 CH-2 的可测证据)',
    items: [
      { key: 'diversity_rate', label: '多样度', kind: 'pct' },
      {
        key: 'strategy_distinguishability',
        label: '策略可区分率',
        kind: 'pct',
        ciKey: 'strategy_distinguishability_ci95',
      },
      { key: 'self_repetition_rate', label: '自我重复率(越低越好)', kind: 'pct' },
    ],
  },
  {
    title: '信念校准(离线特征,永不回流)',
    items: [
      { key: 'belief_hit_rate', label: '最高怀疑命中率', kind: 'pct', ciKey: 'belief_hit_rate_ci95' },
      { key: 'mean_suspicion_gap', label: '平均怀疑差', kind: 'num' },
    ],
  },
  {
    title: '角色结果 / 用量',
    items: [
      { key: 'undercover_win_rate', label: '卧底胜率', kind: 'pct' },
      { key: 'civilian_win_rate', label: '平民胜率', kind: 'pct' },
      { key: 'model_calls_total', label: '模型调用总数', kind: 'count' },
      { key: 'describe_retries_total', label: '描述重试', kind: 'count' },
    ],
  },
];

function EvalPanel() {
  const [games, setGames] = useState(8);
  const [seed, setSeed] = useState(1);
  const [demoFail, setDemoFail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<EvalResponse[]>([]);
  const [selected, setSelected] = useState(0);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await runEval({ games, seed, demoFail });
      setRuns((prev) => [result, ...prev].slice(0, 8));
      setSelected(0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const current = runs[selected];

  return (
    <section className="ops-panel">
      <div className="ops-toolbar">
        <label className="ops-field inline">
          <span>局数</span>
          <select value={games} onChange={(e) => setGames(Number(e.target.value))}>
            {[2, 4, 8, 16, 32].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-field inline">
          <span>seed</span>
          <input
            type="number"
            value={seed}
            onChange={(e) => setSeed(Math.trunc(Number(e.target.value) || 0))}
          />
        </label>
        <label className="ops-check inline">
          <input type="checkbox" checked={demoFail} onChange={(e) => setDemoFail(e.target.checked)} />
          泄题演示(门禁应红)
        </label>
        <button type="button" className="primary" disabled={busy} onClick={run}>
          {busy ? '评测中…' : '跑一批评测'}
        </button>
        <span className="ops-stats">fixture 确定性 · 同 seed 逐字节可复现 · 独立引擎不碰线上对局</span>
      </div>

      {error && <p className="ops-error">{error}</p>}

      {runs.length > 0 && (
        <div className="ops-runs">
          {runs.map((r, i) => (
            <button
              key={`${r.report.data.suite}-${r.seed}-${r.games}-${i}`}
              type="button"
              className={`ops-run ${i === selected ? 'on' : ''} ${r.gate.passed ? 'pass' : 'fail'}`}
              onClick={() => setSelected(i)}
            >
              {r.gate.passed ? '✅' : '❌'} {r.games} 局 · seed {r.seed}
              {r.demoFail ? ' · 泄题演示' : ''}
            </button>
          ))}
        </div>
      )}

      {current ? <EvalDetail result={current} /> : <p className="ops-empty-lg">还没有评测记录——点「跑一批评测」,几秒内出记分卡。</p>}
    </section>
  );
}

function EvalDetail({ result }: { result: EvalResponse }) {
  const metrics = result.report.data.metrics;
  const find = (key: string): MetricRow | undefined => metrics.find((m) => m.key === key);

  return (
    <div className="ops-scorecard">
      <div className={`ops-gate ${result.gate.passed ? 'pass' : 'fail'}`}>
        {result.gate.passed ? (
          <>✅ 门禁通过 —— 泄题 / 非法动作 / 未完成 / 隐私哨兵 / 阈值 五类门均未触发</>
        ) : (
          <>
            ❌ 门禁失败({result.gate.failures.length} 项)—— CLI 等价命令将以非零退出
            <ul>
              {result.gate.failures.map((f) => (
                <li key={f.code + f.detail}>
                  <code>[{f.code}]</code> {f.detail}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="ops-dim">
        套件 {result.report.data.suite} · 里程碑 {result.report.data.milestone} · 样本{' '}
        {result.report.data.sampleSize} 局
      </p>

      <div className="ops-metricgrid">
        {METRIC_GROUPS.map((group) => (
          <div key={group.title} className="ops-metricgroup">
            <h4>{group.title}</h4>
            <table>
              <tbody>
                {group.items.map((spec) => {
                  const row = find(spec.key);
                  if (!row) return null;
                  const ci = spec.ciKey ? find(spec.ciKey) : undefined;
                  return (
                    <tr key={spec.key}>
                      <td>{spec.label}</td>
                      <td className="mono val">
                        {formatMetric(row.value, spec.kind)}
                        {ci ? <span className="dim"> ±{formatMetric(ci.value, 'pct')}</span> : null}
                      </td>
                      <td className="mono dim">n={row.n}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatMetric(value: number, kind: MetricSpec['kind']): string {
  if (kind === 'pct') return `${(value * 100).toFixed(1)}%`;
  if (kind === 'count') return String(Math.round(value));
  return value.toFixed(value >= 10 ? 1 : 3);
}
