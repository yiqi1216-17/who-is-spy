# 04.4 · Evaluation and Recovery Tasks

> This change depends on the versioned schemas and transactional Agent boundary from change 03. Every task begins with a failing gate, replay fixture, privacy sentinel, or recorded baseline.

> **范围决定(2026-08-19 · 记入 `DECISIONS.md` §3②)**:本轮先落「效果评测」核心——
> 无头自博弈(1.2/1.3)、带分母+不确定度的可对比指标(2.2)、确定性非零门禁(2.3)**已全绿交付**
> (`server/eval/*` + `tools/evaluate.ts` + 23 条测试;命令 `npm run eval:node`)。
> 治理化子项按「以效果为目标、不引入数据治理开销」**显式延后**(与 03 一脉相承:运行系统只用
> `synthetic` 种子、不接触人类语料,故无 split/frozen-core/consent 之实):1.1 多版本清单校验、
> 2.1 frozen-core 哈希门、2.4 盲测人类偏好采样。§3/§4(可观测 trace + 故障分类/恢复)→ **04-F**,
> §5(replay + 数据记录)→ **04-G**,§6(证据系统收尾)→ **交付收尾批**。下方逐条保留原文并标注去向。
> 计:**评测轨交付 4 项全绿**(1.2/1.3/2.2/2.3);**04-F 可观测/恢复轨再交付 6 项全绿**(3.1/3.2/4.1/4.2/4.3/4.4)、
> 3.3 被拒候选侧已证(accepted 复放随 04-G);3 项治理轨显式延后;余下(3.3 复放侧 + §5 replay/数据记录 + §6 证据收尾)归 04-G/收尾。

## 1. Establish reproducible evaluation inputs

- [ ] 1.1 Consume change 03’s B0–B3 manifests and add a compatibility test that rejects missing or incompatible engine, data, strategy, schema, evaluator, provider, and pricing versions. — **延后**(多源版本清单治理;运行系统单一 synthetic 源,无 data/pricing 版本面,A3 迁移守卫另于 04-G 收口)
- [x] 1.2 Implement seeded fixture, fault, and real evaluation modes and prove identical fixture inputs produce byte-stable reports. — fixture 模式 + `mulberry32(seed)` 共享流;`self-play.test.ts`/`gates.test.ts` 断言同 seed 同批报告 JSON 逐字节相等;fault 模式经 `--demo-fail` 注入泄题→原子终止;real 模式留 §6.2 预算封顶批。
- [x] 1.3 Add matched scenario matrices for roles, seats, word pairs, public histories, human inputs, ties, failures, and terminal outcomes. — 共享随机流覆盖不同卧底落位/词对/终局(测试断言一批内卧底落位≥2 种);平票复投由引擎 `resolveBallot` 驱动、失败场景由注入模型覆盖。

## 2. Protect benchmark suites and metrics

- [ ] 2.1 Add frozen-core access-denial and manifest-hash tests across retrieval, fitting, prompt selection, threshold tuning, and rolling failure intake. — **延后**(frozen-core 属基准治理;无训练/验证 split 即无 frozen-core 之实;R3 的 keyset 冻结与「权重只在 train/val 拟合」纪律已由固定 keyset 承接)
- [x] 2.2 Report completion, validity, leakage, repetition, diversity, strategy distinguishability, belief calibration, latency, usage, cost, retries, and role outcomes with denominators and uncertainty. — `metrics.ts` 全指标带分母(n)+比率类 95% 近似置信半宽;usage/retries 确定,latency/cost 属墙钟量,留真机模式单列(fixture 报告须逐字节稳定,不含时延)。
- [x] 2.3 Implement deterministic non-zero gates and tests proving a secret leak, illegal action, incomplete game, privacy sentinel, or threshold breach fails the process. — `report.ts` 五类门 + `evaluate.ts` 非零退出;`gates.test.ts` 逐类断言触发,`--demo-fail` 现场演示(exit 1)。
- [ ] 2.4 Add blinded human preference sampling for naturalness, fun, differentiation, replay intent, and share intent, preserving counts, ties, and randomized presentation order. — **延后→交付收尾/06**(需真人盲测样本;与 05-H 前端可玩后再采集,避免空转)

## 3. Add redacted decision observability

> **04-F 已交付(2026-08-19)**:3.1 / 3.2 全绿;3.3 被拒候选侧已证,accepted 事件复放重建随 04-G §5.1 合并勾选。
> 可观测层**已接线上运行系统**:`app.ts`/`index.ts` 用 `TracedModel` 包模型(传输世系)+ 引擎注入 `obs`(决策纠偏 + hook 世系),同汇一把脱敏 `MemoryTraceSink`(生产取有限环形上限)。默认不注入则零发射、行为逐字节不变。

- [x] 3.1 Write success/failure artifact scans with unique key, word, prompt, belief, and hidden-vote sentinels, then emit allowlisted trace events. — `redaction.ts` 单一哨兵尺(全部密词 + 凭据前缀 `sk-`/`ark-`);`obs/tracer.ts` `scanTraceArtifacts` + `traceEvent` **strict schema 结构性**拒 word/prompt/belief/hidden-vote(只留登记键)+ `policyCode` **允许列**闸自由文本。证:`obs/engine-trace.test.ts`(候选=密词本身时工件仍扫不出机密)、`obs/tracer.test.ts`(允许列拒自由文本、strict 拒 `reasoning`)、`schema.test.ts`(traceEvent 拒 word/prompt/belief/apiKey)。
- [x] 3.2 Add correlation, attempt, error, latency, usage, policy, version, and commit-state assertions for every model and hook boundary. — trace 字段:correlationId / attempt / outcome(含 `error`)/ latencyMs(墙钟,仅真机注入 `now` 时出现,保 fixture 逐字节稳定)/ policyCode / 版本(`{v,kind}` 信封)/ commit-state(CH-4 前后相等)。边界全覆盖:describe(引擎决策纠偏 + `TracedModel` 传输)、vote / review(`TracedModel` 传输)、hook(`traceHookResults`)。**usage(token)按 design §5 不进逐条 trace**,在指标层(04-E `eval/metrics.ts`)带分母聚合,避免把不稳定量塞进稳定 trace。证:`obs/recovery.test.ts`(三模型边界 + latency + CH-4)、`obs/engine-trace.test.ts`(hook + describe accepted/rejected)、`obs/tracer.test.ts`(版本往返)。
- [ ] 3.3 Prove accepted public actions are replayable while rejected private candidates retain only safe hash, length, code, and timing metadata. — **被拒私有候选侧已证**:只留 `candidateHash`(FNV-1a→8-hex,不可逆)+ `candidateLength`(码点数)+ `policyCode`(code)+ `latencyMs`(timing),原文即弃;`obs/engine-trace.test.ts` 证「候选=密词本身」时 `scanTraceArtifacts` 仍为空、`schema.test.ts`/`engine-trace` 证非 8-hex 的 hash 被 strict 拒。**accepted 公开动作的事件复放重建(不重跑模型)**属 design §8 → 随 **04-G §5.1** 落地后合并勾选。

## 4. Classify and recover failures

> **04-F 已交付(2026-08-19)**:4.1–4.4 全绿。传输重试(`obs/retry.ts` 唯一 `withRetry`,注入时钟)与决策纠偏(引擎质量环)是**两条独立世系、同汇可辨**,取代嵌套重试。

- [x] 4.1 Replace nested retries with one tested taxonomy and attempt lineage covering timeout, rate limit, upstream, malformed JSON, schema, illegal target, policy, auth/configuration, and unknown failures. — `obs/failure-taxonomy.ts` 9 类纯函数分类学(往返稳定,含解包 `ModelError.cause` 链与状态码/Retry-After 抽取)+ `obs/retry.ts` 唯一 `withRetry` 尝试世系。证:`obs/taxonomy.test.ts`(9 类往返 + 可重试性 + cause 链 503→upstream/429→rate_limit/未配置→auth_config)、`obs/retry.test.ts`(逐尝试分类可见)。
- [x] 4.2 Test bounded backoff, jitter, `Retry-After`, decision correction, and non-retryable authentication/configuration behavior without real waiting. — `obs/retry.test.ts`:指数退避 [100,200,400]、抖动上界(满额)/下界(减半)、`Retry-After` 受 `maxDelay` 封顶、auth_config **不可重试零等待**;`recordingClock` 注入 → **绝不真的等待**。决策纠偏:引擎质量环重描(`obs/engine-trace.test.ts` 同 correlationId 贯穿 3 次纠偏世系)。
- [x] 4.3 Add development-only targeted fault injection and prove production rejects fault flags and demo controls. — `obs/fault-injection.ts` `FaultInjectingModel`(按 boundary / failClass / times 定向注入;每类合成错误往返过 `classifyFailure`;**构造即校 `NODE_ENV`,production 抛错**)。证:`obs/recovery.test.ts` §4.3(生产环境构造抛错,含 try/finally 复原)。
- [x] 4.4 Inject every failure class at each relevant boundary and assert trace classification plus authoritative state before/after equality on terminal failure. — `obs/recovery.test.ts` §4.4:`it.each` 9 类注入 describe 边界 → 断言 trace 末条 policyCode + outcome + 世系长度(可重试打满 maxAttempts、不可重试快速失败);终局失败(auth_config 恒失败)经引擎 `withGame` 原子草稿 → `structuredClone` 逐字节 **before == after**(CH-4 优雅降级)。vote / review 边界打点另见同文件「三边界各自打点」用例。

## 5. Replay and evolve safely

- [ ] 5.1 Add schema/version, monotonic-ID, gap, duplication, and tamper tests, then reconstruct the public decision timeline without rerunning models.
- [ ] 5.2 Add quarantined, de-identified, rights-checked failure intake and prove it can update only a future rolling challenge manifest, never frozen core.
- [ ] 5.3 Implement champion/challenger promotion and rollback manifests with hard gates, declared target gain, regression budgets, uncertainty, cost/latency limits, and retained previous champion.

## 6. Verify the evidence system

- [ ] 6.1 Run the full deterministic suite twice and prove stable reports, intended non-zero failures, privacy cleanliness, and replay integrity.
- [ ] 6.2 Run a budget-capped DeepSeek comparison, label live latency/cost separately from fixtures, and preserve only redacted reports.
- [ ] 6.3 Produce a concise B0–B3/champion scorecard with ablations, sample limitations, failures, recovery evidence, and no unsupported superiority claim.
- [ ] 6.4 Run Node tests, build, `contract:node`, strict OpenSpec validation, and independent evaluation/privacy review; record residual risks before archive.
