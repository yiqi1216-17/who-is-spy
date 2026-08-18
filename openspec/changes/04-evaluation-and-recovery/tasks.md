# 04.4 · Evaluation and Recovery Tasks

> This change depends on the versioned schemas and transactional Agent boundary from change 03. Every task begins with a failing gate, replay fixture, privacy sentinel, or recorded baseline.

> **范围决定(2026-08-19 · 记入 `DECISIONS.md` §3②)**:本轮先落「效果评测」核心——
> 无头自博弈(1.2/1.3)、带分母+不确定度的可对比指标(2.2)、确定性非零门禁(2.3)**已全绿交付**
> (`server/eval/*` + `tools/evaluate.ts` + 23 条测试;命令 `npm run eval:node`)。
> 治理化子项按「以效果为目标、不引入数据治理开销」**显式延后**(与 03 一脉相承:运行系统只用
> `synthetic` 种子、不接触人类语料,故无 split/frozen-core/consent 之实):1.1 多版本清单校验、
> 2.1 frozen-core 哈希门、2.4 盲测人类偏好采样。§3/§4(可观测 trace + 故障分类/恢复)→ **04-F**,
> §5(replay + 数据记录)→ **04-G**,§6(证据系统收尾)→ **交付收尾批**。下方逐条保留原文并标注去向。
> 计:**本轮交付 4 项全绿**(1.2/1.3/2.2/2.3);3 项治理轨显式延后,余下 13 项归 04-F/04-G/收尾。

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

- [ ] 3.1 Write success/failure artifact scans with unique key, word, prompt, belief, and hidden-vote sentinels, then emit allowlisted trace events.
- [ ] 3.2 Add correlation, attempt, error, latency, usage, policy, version, and commit-state assertions for every model and hook boundary.
- [ ] 3.3 Prove accepted public actions are replayable while rejected private candidates retain only safe hash, length, code, and timing metadata.

## 4. Classify and recover failures

- [ ] 4.1 Replace nested retries with one tested taxonomy and attempt lineage covering timeout, rate limit, upstream, malformed JSON, schema, illegal target, policy, auth/configuration, and unknown failures.
- [ ] 4.2 Test bounded backoff, jitter, `Retry-After`, decision correction, and non-retryable authentication/configuration behavior without real waiting.
- [ ] 4.3 Add development-only targeted fault injection and prove production rejects fault flags and demo controls.
- [ ] 4.4 Inject every failure class at each relevant boundary and assert trace classification plus authoritative state before/after equality on terminal failure.

## 5. Replay and evolve safely

- [ ] 5.1 Add schema/version, monotonic-ID, gap, duplication, and tamper tests, then reconstruct the public decision timeline without rerunning models.
- [ ] 5.2 Add quarantined, de-identified, rights-checked failure intake and prove it can update only a future rolling challenge manifest, never frozen core.
- [ ] 5.3 Implement champion/challenger promotion and rollback manifests with hard gates, declared target gain, regression budgets, uncertainty, cost/latency limits, and retained previous champion.

## 6. Verify the evidence system

- [ ] 6.1 Run the full deterministic suite twice and prove stable reports, intended non-zero failures, privacy cleanliness, and replay integrity.
- [ ] 6.2 Run a budget-capped DeepSeek comparison, label live latency/cost separately from fixtures, and preserve only redacted reports.
- [ ] 6.3 Produce a concise B0–B3/champion scorecard with ablations, sample limitations, failures, recovery evidence, and no unsupported superiority claim.
- [ ] 6.4 Run Node tests, build, `contract:node`, strict OpenSpec validation, and independent evaluation/privacy review; record residual risks before archive.
