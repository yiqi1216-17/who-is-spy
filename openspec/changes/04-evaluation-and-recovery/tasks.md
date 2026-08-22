# 04.4 · Evaluation and Recovery Tasks

> This change depends on the versioned schemas and transactional Agent boundary from change 03. Every task begins with a failing gate, replay fixture, privacy sentinel, or recorded baseline.

> **范围决定(2026-08-19 · 记入 `DECISIONS.md` §3②)**:本轮先落「效果评测」核心——
> 无头自博弈(1.2/1.3)、带分母+不确定度的可对比指标(2.2)、确定性非零门禁(2.3)**已全绿交付**
> (`server/eval/*` + `tools/evaluate.ts` + 23 条测试;命令 `npm run eval:node`)。
> 治理化子项按「以效果为目标、不引入数据治理开销」**显式延后**(与 03 一脉相承:运行系统只用
> `synthetic` 种子、不接触人类语料,故无 split/frozen-core/consent 之实):1.1 多版本清单校验、
> 2.1 frozen-core 哈希门、2.4 盲测人类偏好采样。§3/§4(可观测 trace + 故障分类/恢复)→ **04-F 已交付**,
> §5.1(事件式回放 + 数据记录)→ **04-G 已交付**,§5.2/5.3(治理/晋级)+ §6(证据系统收尾)→ **交付收尾批**。下方逐条保留原文并标注去向。
> 计:**评测轨交付 4 项全绿**(1.2/1.3/2.2/2.3);**04-F 可观测/恢复轨 6 项全绿**(3.1/3.2/4.1/4.2/4.3/4.4);
> **04-G 回放轨 2 项全绿**(3.3 两侧补齐 + 5.1 事件式回放/数据记录);5 项治理/晋级轨显式延后;余下(§6 证据收尾)归交付收尾批。

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
- [x] 3.3 Prove accepted public actions are replayable while rejected private candidates retain only safe hash, length, code, and timing metadata. — **两侧俱证(04-F 被拒侧 + 04-G accepted 侧)**。被拒私有候选侧(04-F):只留 `candidateHash`(FNV-1a→8-hex,不可逆)+ `candidateLength`(码点数)+ `policyCode`(code)+ `latencyMs`(timing),原文即弃;`obs/engine-trace.test.ts` 证「候选=密词本身」时 `scanTraceArtifacts` 仍为空。accepted 公开动作侧(04-G · §5.1):`replay/*` 从有序事件重建描述/票型/出局/高光锚点,`replay.test.ts` 证「重建期间模型调用数恒为 0」「重建描述与本局公开描述逐条一致」「日志扫不出密词」;被拒候选**从不进事件流**,故日志天然只含可复放的公开动作 —— 两者结构互补:accepted 全文可复放、rejected 仅留指纹。

## 4. Classify and recover failures

> **04-F 已交付(2026-08-19)**:4.1–4.4 全绿。传输重试(`obs/retry.ts` 唯一 `withRetry`,注入时钟)与决策纠偏(引擎质量环)是**两条独立世系、同汇可辨**,取代嵌套重试。

- [x] 4.1 Replace nested retries with one tested taxonomy and attempt lineage covering timeout, rate limit, upstream, malformed JSON, schema, illegal target, policy, auth/configuration, and unknown failures. — `obs/failure-taxonomy.ts` 9 类纯函数分类学(往返稳定,含解包 `ModelError.cause` 链与状态码/Retry-After 抽取)+ `obs/retry.ts` 唯一 `withRetry` 尝试世系。证:`obs/taxonomy.test.ts`(9 类往返 + 可重试性 + cause 链 503→upstream/429→rate_limit/未配置→auth_config)、`obs/retry.test.ts`(逐尝试分类可见)。
- [x] 4.2 Test bounded backoff, jitter, `Retry-After`, decision correction, and non-retryable authentication/configuration behavior without real waiting. — `obs/retry.test.ts`:指数退避 [100,200,400]、抖动上界(满额)/下界(减半)、`Retry-After` 受 `maxDelay` 封顶、auth_config **不可重试零等待**;`recordingClock` 注入 → **绝不真的等待**。决策纠偏:引擎质量环重描(`obs/engine-trace.test.ts` 同 correlationId 贯穿 3 次纠偏世系)。
- [x] 4.3 Add development-only targeted fault injection and prove production rejects fault flags and demo controls. — `obs/fault-injection.ts` `FaultInjectingModel`(按 boundary / failClass / times 定向注入;每类合成错误往返过 `classifyFailure`;**构造即校 `NODE_ENV`,production 抛错**)。证:`obs/recovery.test.ts` §4.3(生产环境构造抛错,含 try/finally 复原)。
- [x] 4.4 Inject every failure class at each relevant boundary and assert trace classification plus authoritative state before/after equality on terminal failure. — `obs/recovery.test.ts` §4.4:`it.each` 9 类注入 describe 边界 → 断言 trace 末条 policyCode + outcome + 世系长度(可重试打满 maxAttempts、不可重试快速失败);终局失败(auth_config 恒失败)经引擎 `withGame` 原子草稿 → `structuredClone` 逐字节 **before == after**(CH-4 优雅降级)。vote / review 边界打点另见同文件「三边界各自打点」用例。

## 5. Replay and evolve safely

> **04-G 已交付(2026-08-19)**:5.1 全绿(`replay/{log,replay,dataset}.ts` + `replay/replay.test.ts` 20 条 + `app.ts` 只读回放端点)。
> 事件式回放接线上运行系统:引擎 `getReplayLog`/`reconstructReplay`(只读派生,不改核心)+ `GET /api/games/:id/replay`(公开安全,不含 role/word)。
> 数据记录导出 `exportDataset` 假名化(p0..p4)、无密词位、来源三分离,**服务端专用**(含终局 role 标签,不经 HTTP)。
> 5.2/5.3 属**基准治理/晋级策略**(quarantine intake + champion/challenger),按「以效果为目标、不引入数据治理开销」**显式延后→交付收尾/06**。

- [x] 5.1 Add schema/version, monotonic-ID, gap, duplication, and tamper tests, then reconstruct the public decision timeline without rerunning models. — `replay/log.ts` 位置序号(单调 ID)+ FNV-1a 链式校验和(丢弃引擎 randomUUID → 逐字节稳定);`replay/replay.ts` 完整性四关(schema/version 迁移守卫、缺口、重复、篡改含截断/追加)+ `reconstructTimeline`(**签名无模型** → 结构上不可能重跑)。证:`replay/replay.test.ts`(20 条,含「同 seed 两局 records 逐字节相等」「模型调用恒 0」「重建描述逐条一致」「四关各自触发并定位 seq」)。
- [ ] 5.2 Add quarantined, de-identified, rights-checked failure intake and prove it can update only a future rolling challenge manifest, never frozen core. — **延后→交付收尾/06**(隔离入库 + 权利校验属数据治理;运行系统只用 synthetic 种子,无 frozen-core/rolling 之实;`exportDataset` 已交付假名化 + 来源分离的效果等价物)
- [x] 5.3 Implement champion/challenger promotion and rollback manifests with hard gates, declared target gain, regression budgets, uncertainty, cost/latency limits, and retained previous champion. — **核心交付**:`eval/compare.ts` + `tools/compare-eval.ts`(`npm run compare:node`)对多配置(collapsed→synthetic-v1→transfer-v2,迭代顺序)在**同 seed 同随机流**下逐步 diff,施加**回归预算硬门**(完局率零容忍、多样度/可区分率各 2 个百分点)→ 挑战者劣化超预算即 `regressed=true` → CLI **非零退出**(冠军得以保留、挑战者被拦)。`compare.test.ts` 8 例证:可复现、真实 diff 方向、回归门**双向**成立、落盘脱敏。引擎经**可注入 `resolveStrategy`**(默认不变、contract 28/0)实现零改动对比。**诚实边界**:多版本 champion **manifest 持久化**与真机 cost/latency 上限属治理面,留 06;当前落地的是其效果核心——「可量化 diff + 回归预算 + 非零退出」。证据 `docs/evidence/04-strategy-compare.md`。

## 6. Verify the evidence system

- [x] 6.1 Run the full deterministic suite twice and prove stable reports, intended non-zero failures, privacy cleanliness, and replay integrity. — 逐字节稳定:`eval:node --games 12 --seed 1 --json` 连跑两遍报告全等;`compare.test.ts` 亦断言同 seed 对比逐字节相等。有意非零失败:`eval:node --demo-fail` → exit 1(泄题→质量穷尽→完成率门);`compare` 逆序配置触发回归门 → exit 1。隐私洁净:`compare` 落盘前 `scanSecrets` 双保险,`compare.test.ts` 断言 JSONL/Markdown 扫不出密词。回放完整性:`replay.test.ts` 20 例(四关各自触发定位 seq)+ 新 `migration-guard.test.ts` 版本守卫。全量 `test:node` **304 通过 / 1 跳过**(无 key 的真机 smoke 跳过)。
- [ ] 6.2 Run a budget-capped DeepSeek comparison, label live latency/cost separately from fixtures, and preserve only redacted reports.
- [ ] 6.3 Produce a concise B0–B3/champion scorecard with ablations, sample limitations, failures, recovery evidence, and no unsupported superiority claim.
- [ ] 6.4 Run Node tests, build, `contract:node`, strict OpenSpec validation, and independent evaluation/privacy review; record residual risks before archive.

## 7. Faction win-rate arms race

> **本轮交付(2026-08-21)**:回答题面②真正问的问题——不是「描述有没有差异化」(那是 §5.3 compare 钉的描述质量),而是「学到更强策略后,**平民/卧底哪一方更容易赢**」。给出一条 civ↑→spy↑→civ↑ 的军备竞赛曲线,并把技能档位标定在**可追溯的语料胜负信号**上。
> 关键工程:整条线经引擎**可注入 `resolveStrategy`**(§5.3 同一缝)实现,投票由技能驱动但只读公开信息——**零契约变更(contract 28/0)、终局前隔离不变量原样保持**。

- [x] 7.1 Mine faction win/loss correlation from raw human transfer data to ground the skill tiers (no fabricated numbers). — `corpus/mine-outcomes.ts` 从 raw werewolf 的 `votingOutcome`/`endRoles`(extract-strategies 丢弃的那一半)挖出:村民类比方经验胜率 **58.8%**、四说服话风簇获胜占比 **48%–57%**——证实「阵营与话风都对胜负有可测影响」。ONUW 简化处决判定 + 玩家级话风→阵营→胜负 join,**只统计 train split**(泄漏隔离)。`npm run data:outcomes` → `data/normalized/outcome-correlation-report.json`(仅聚合占比+样本数,无逐局泄漏)。证:`corpus/mine-outcomes.test.ts`(9)——判定纯函数六向 + 端到端确定性 + train 过滤 + 胜/败方 winRate 方向。
- [x] 7.2 Drive votes by skill on public information alone so faction win-rate becomes a function of strategy. — `eval/arms-race-model.ts` `ArmsRaceModel`:描述由词决定「锚句簇」(平民同词聚簇、卧底异词离群);平民按公开描述**离群度**锁定卧底(概率=civSkill,可选跨轮累计),卧底以 spyBlend 借用平民锚句「融入」、以 spyDeflect「转移火力」投向最像平民者。**只读 `publicDescriptions` + 自身身份**,绝不触碰他人 role/word;技能门用 FNV 哈希取伪随机,无 Math.random/无墙钟 → 逐字节可复现。证:`arms-race.test.ts` 因果性 2 例(仅换 civSkill/spyBlend 胜率显著改变)+ 隔离例(AI 零非法票、不自投)。
- [x] 7.3 Report per-step civilian/undercover win-rate deltas with a swing-direction verdict, deterministic and complete. — `eval/arms-race.ts`:四档技能 `baseline→civ-awake→spy-counter→civ-refined`,逐步胜率 diff + 摆动方向断言(期望 vs 实际)+ Markdown/JSONL 渲染;`tools/arms-race.ts`(`npm run arms-race:node`,`--games/--seed/--log/--report/--json`)摆动不成立或有未完局即 **exit 1**;落盘前 `scanSecrets` 双保险。实测(seed=7,80 局):平民胜率 **65%→83.8%→62.5%→80%**,三步摆动 civ↑→spy↑→civ↑ 全部成立、**100% 完局**。证据 `docs/evidence/04-arms-race.md`(+`.jsonl`);验收 `arms-race.test.ts`(7)——复现/方向/非单调曲线/因果/隔离脱敏。
- [x] 7.4 Emit a complete per-game, per-round trace so the win-rate is auditable ("how was it played out"), not just aggregate numbers. — `eval/arms-race-trace.ts` `extractGameTrace`/`renderGameTraceText`:每局落**描述→离群度→投票(带 `✓抓对`)→出局顺序→终局**全过程;`toArmsRaceTraceLines` + `tools/arms-race.ts --trace <path>` 落逐局逐轮脱敏 JSONL(四档全量,seed=7 共 **320 局**),`--sample N` 把每档「卧底被抓/逃脱」各一例打到 stdout。**三层日志均落 `docs/evidence/`**:①`--log` 聚合胜率 JSONL、②`--trace` 逐局逐轮 JSONL、③`--json-out` 完整报告 JSON(前两层嵌套成一棵树 + 原始 metrics,单文件全量存档)。Markdown 报告新增「§5 逐局复盘样本」内嵌两局机制示意。**脱敏**:秘密词一律不落,只以 `wordTag`(FNV 8-hex 假名)呈现——同词同 tag 即可分辨阵营而不泄词;role 终局后揭示(与生产终局同口径),`scanSecrets` 恒空。证:`arms-race.test.ts` trace 组(4)——结构完整/卧底第一轮多数最离群/JSONL 逐字节可复现+脱敏/可读复盘含抓对标记。
