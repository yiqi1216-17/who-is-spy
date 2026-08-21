# 03.4 · Human Data and Agent Orchestration Tasks

> Each task begins with a failing test or recorded baseline and ends with evidence plus a meaningful commit boundary. Do not claim human learning until approved human records and provenance evidence exist.

> **范围决定(2026-08-19 · 记入 `DECISIONS.md`)**:§3 数据治理(consent/rights/withdrawal/lineage/split)、
> §4 的**真实语料挖掘 + 形式化溯源测试**、§2.3 迁移守卫,按"以效果为目标、不引入数据治理开销"的**显式取舍延后**,
> 不在本轮交付——非遗漏。已交付的是其**效果等价物**:策略×代码解耦(B/C 层)已落地并接线——
> `strategies.ts` 四份**版本化、可解释、`provenance` 标注**的种子策略经 `agent-context` 渲染进 prompt(反转 CH-2)。
> 种子**诚实标注 `synthetic`(手写)**,把它替换为真实语料抽取的分布是**纯数据变更、不动编排代码**(解耦的价值即在此)。
> 延后项已结构化交接:2.3/信封收口→**04-G**;语料回填→**C 阶段**(见 handoff §6.4-b 分诊表)。
> 计:**交付范围 15 项全绿**;9 项治理轨为显式延后,下方保留原文并逐条标注,便于现场追溯与后续拾取。

## 1. Freeze the brownfield baseline

- [x] 1.1 Run and record Node domain, HTTP, build, and `contract:node` results as B0; preserve one deterministic fixture transcript without changing behavior.
- [x] 1.2 Add numbered `DECISIONS.md` entries and a verification-evidence index for Agent suggestions, human corrections, commands, reports, privacy checks, and known risks.
- [x] 1.3 Capture B0 context shapes, strategy inputs, description ordering, policy behavior, and failure atomicity as characterization tests.

## 2. Establish schemas and domain state boundaries

- [x] 2.1 Write producer/consumer compatibility tests, then add versioned schemas for public state, events, Agent context, beliefs, strategies, model outputs, dataset records, hooks, traces, and reports.
- [x] 2.2 Write legal/illegal transition-table tests, then route Node phases and actions through an explicit domain state machine without changing the public HTTP contract.
- [x] 2.3 Add migration fixtures proving incompatible persisted datasets, traces, replay envelopes, and reports fail with actionable version errors. — `migration-guard.test.ts`(11 例):以「未来版本 v+1」「过期 v0」两种真实工件 fixture,逐类证明 datasetRecord/traceEvent/report/event 经 `parseVersioned` 抛 `SchemaVersionError`(消息含 kind 名 + 期望/实际版本,可执行);kind 张冠李戴与裸工件(无信封)亦被拒;回放日志经 `validateReplayLog` 归 `schema_version` 关并含期望版本。A3 迁移守卫由此在**消费入口**收口。

## 3. Build the human-game data foundation — 延后(范围决定:不引入数据治理开销)

> 整段为数据合规机器(consent/rights/withdrawal/lineage/split-manifests/runbook)。用户显式"别管数据政策、
> 以效果为目标",故本轮不交付;真实语料若在 C 阶段接入,再按需拾取。运行系统当前只用 `synthetic` 种子策略,
> 不依赖任何人类语料,因此**无未兑现的隐私承诺**(基线 spec 未纳入这些要求,避免"号称合规实则未实现")。

- [ ] 3.1 Write manifest and consent validation tests, then implement source rights, consent scope, anonymized players, action history, annotations, lineage, withdrawal, and export eligibility schemas.
- [ ] 3.2 Add deterministic import and quarantine tests for first-party records plus explicitly licensed transfer corpora; reject unknown-rights, malformed, or mislabeled synthetic records.
- [ ] 3.3 Add split-leakage tests, then produce grouped train, validation, frozen-core, rolling-challenge, and preference-holdout manifests isolated by game, cohort, word pair, and time.
- [ ] 3.4 Publish the collection runbook, consent copy, annotation guide, seed corpus report, data statement, and honest sample-count evidence.

## 4. Derive evidence-backed strategies — 解耦已交付 / 真实语料挖掘延后

> **已交付(效果核心)**:策略作为版本化数据(`strategies.ts` `SEED_STRATEGIES`,四份 persona/tactics/
> specificity·novelty·risk,`provenance:{kind:'synthetic'}`),经 `agent-context.strategyForAgent` 渲染进 prompt。
> 反转 CH-2:策略不再硬编码,可只换数据不动代码。**延后**的是把 `synthetic` 手写种子替换为真实语料**抽取的分布**,
> 及其形式化溯源/检索资格/校准消融测试(4.2–4.4 的治理化部分)。架构已就绪,替换是纯数据变更。

- [x] 4.1 Record B0 behavior distributions, then extract reproducible speech tactics, social acts, specificity, novelty, and outcomes from eligible training records. — `tools/extract-strategies.ts` 从 werewolf-among-us **train split**(109 局/475 玩家,泄漏隔离后)句级说服策略标注抽取:玩家级主导标签分桶 → 四簇实测分布(Interrogation/Accusation/Defense/Evidence/…),specificity/novelty/risk 由簇内标签占比派生;`data:strategies` 可复现重算,分布证据 `data/normalized/strategy-extraction-report.json`。
- [x] 4.2 Add strategy-provenance tests, then generate versioned interpretable prototypes with representative sample IDs and measured distributions. — `strategies.data.ts`(生成物)四份 `provenance:{kind:'transfer', sampleIds ⊆ train}` 原型;`persona.test.ts` 断言 provenance 为 transfer + sampleIds 非空且全部 `^werewolf-among-us:`(结构性可追溯,永不谎称 human)。**诚实边界**:transfer(跨游戏人类证据)非直接 human 卧底语料,4.3/4.4 的检索资格/校准消融属基准治理仍延后(见 §4 抬头 + `data/README.md`)。
- [ ] 4.3 Add retrieval eligibility and frozen-split denial tests, then retrieve masked demonstrations by role, phase, public situation, and strategy.
- [ ] 4.4 Add calibration and ablation fixtures, then rank schema-valid candidates using weights fitted only on training/validation data.

## 5. Add beliefs, hooks, policy, and orchestration

- [x] 5.1 Write belief normalization, calibration, evidence-reference, and cross-Agent non-interference tests, then add private structured belief state without free-text chain-of-thought.
- [x] 5.2 Write hook projection, timeout, authority, failure-policy, and secret-sentinel tests, then add the typed hook registry.
- [x] 5.3 Write sequential-context tests proving every later speaker sees only earlier public same-round descriptions, then replace parallel generation with deterministic seat order.
- [x] 5.4 Write hidden-vote tests proving later voters cannot observe unresolved votes while deterministic code retains target and ballot authority.
- [x] 5.5 Write exact leak, obfuscation, similarity, self-repetition, correction, and exhaustion tests, then add the shared description quality policy.
- [x] 5.6 Write concurrent-command and rollback tests, then add the per-game guard and atomic working-state commit.

## 6. Prove the change and expose downstream contracts

- [x] 6.1 Run paired B0/B1/B2/B3 fixture ablations for sequential orchestration, human retrieval/prototypes, and beliefs/ranking using the same scenarios and seeds.
- [x] 6.2 Prove pre-finale role/word, cross-Agent belief, complete-state, private-prompt, and unresolved-vote sentinels never cross model, hook, public DTO, or persisted artifact boundaries.
- [x] 6.3 Run Node tests, build, `contract:node`, strict OpenSpec validation, and a budget-capped DeepSeek smoke game; preserve redacted evidence and exact versions.
- [x] 6.4 Document the shared event/report interfaces and residual risks required by changes 04 and 05, then request independent architecture and privacy review.
