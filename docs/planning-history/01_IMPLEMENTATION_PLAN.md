# 01 · AI 谁是卧底 · 二次开发实施规划

> 状态：仅规划，尚未修改任何业务代码  
> 基线目录：`/Users/mayiqi/Desktop/TEC/EfficientML/Fall/who-is-spy`  
> 建议技术栈：Node.js / TypeScript（`packages/server-node`）  
> 建议范围：任务线①完整交付 + 任务线②完整交付 + 任务线③核心交付；前端仅作为时间允许时的伸展项

## 1. 目标与成功定义

本次二次开发不重写游戏，而是在保持现有 HTTP 契约、服务端权威裁决和信息隔离不变量的前提下，把当前“4 次相似的 LLM 调用”演进为可解释、可测试、可度量、可回放的 Multi-Agent 系统。

最终成功需同时满足：

1. 4 个 AI 拥有明确且可验证的差异化策略，而不只是不同名字或文案。
2. 描述按确定顺序逐个生成，后发 Agent 能看到本轮此前已经公开的描述。
3. 雷同、直接泄词或高风险描述不能进入公开状态；系统会纠偏重试，耗尽重试后安全中止本次动作。
4. 一个命令可运行可复现的批量对局，输出质量、有效性、完成率、延迟和成本指标，并可作为非 0 退出的质量门禁。
5. 模型失败能定位到具体对局、轮次、阶段、Agent 和尝试次数；日志及回放不包含 API Key、完整密词或其他 Agent 私密上下文。
6. 单个模型调用失败时不留下半轮数据；用户可安全重试，或收到明确的终止错误。
7. Node 后端的域测试、构建和语言无关契约持续全绿，真实 DeepSeek 路径至少完整运行并留下一局脱敏证据。

## 2. 基线盘点与已确认缺口

### 2.1 当前可复用能力

- React Web + Node/TypeScript + Go 双后端，Node 与 Go 对外契约一致；本次只需选一个后端实现。
- `GameEngine` 是唯一事实源，描述、投票、淘汰、同票加赛、胜负和终局揭示均在服务端处理。
- `buildAgentContext` 使用 allowlist 重建 Agent 上下文，已隔离其他玩家的 `role` 和 `word`。
- `GameModel` 已抽象出 `describe / vote / review`，并有可注入的 `FakeGameModel`。
- DeepSeek 客户端已有 JSON 结构校验、超时和基础重试。
- 已有 Vitest 域测试、HTTP 测试，以及独立的语言无关黑盒契约。
- 引擎随机源可注入，适合做固定种子与确定性回归。

### 2.2 当前核心缺口

- `AI_PROFILES` 虽声明了 `style`，但创建玩家时只保留 `name/avatar`，策略字段完全未进入 Player、AgentContext 或 prompt。
- `generateDescriptions` 使用 `Promise.all` 并发生成；每个 AI 只看到调用开始前的历史，后发者看不到同轮前序 AI 描述。
- 描述校验只有长度、JSON 形状和“是否直接包含自己的完整密词”；没有重复度、近似泄题、跨 Agent 雷同或跨轮重复检测。
- 4 个 AI 使用同一 system prompt、相同温度和相同决策结构，缺乏策略级差异。
- 模型层与决策层都各自重试，最坏可能形成嵌套调用，但没有统一 attempt 编号、错误分类或重试原因。
- 错误只映射为笼统的 502/500；缺少 `gameId/round/agentId/attempt/latency` 等关联字段。
- 对局只在内存 Map 中，Node 侧也没有同一对局的动作串行锁；重复/并发请求存在竞态风险。
- 没有批量模拟器、指标定义、基线报告、阈值门禁、故障注入和回放格式。
- 当前目录还不是 Git 仓库；提交历史和 baseline import 需要在正式实施第一步建立。

## 3. 范围取舍

### 3.1 本次承诺范围

- 任务线①：完整做，作为第一优先级。
- 任务线②：完整做，作为主要加分和版本回归依据。
- 任务线③：完成结构化 trace、错误分类、故障注入、动作原子性和脱敏回放；不引入外部 APM/数据库。
- 文档与证据：README、DECISIONS、验收命令、指标报告、故障演示和真实模型冒烟记录。

### 3.2 明确不做或延后

- 不同时维护 Go 二次开发版本；Go 保持基线，README 明确选择 Node 的原因。
- 不先做前端大改；只有核心任务和自动化证据全绿后，才考虑增加一个只读 trace/指标视图。
- 不引入 LangChain、工作流平台、向量数据库或分布式消息系统；当前规模下会稀释关键设计。
- 不把真实模型评测放进 CI 硬门禁，避免网络、随机性和费用造成假失败；CI 使用固定 fixture/cassette，真实评测作为手工验收。
- 不在日志或 replay 中保存完整 prompt、完整密词、Authorization header 或模型原始响应全文。

## 4. 目标架构

建议把现有职责拆成以下边界：

```text
HTTP action
  -> PerGameActionGuard（同局串行、可选幂等键）
  -> GameEngine command（在工作副本上执行）
      -> AgentTurnOrchestrator（发言顺序与决策编排）
          -> StrategyRegistry（四种策略）
          -> AgentContextBuilder（最小权限上下文）
          -> GameModel（真实模型 / fixture / fault model）
          -> DescriptionPolicy（泄题与同质化门禁）
          -> TraceSink（脱敏生命周期事件）
      -> Rule Engine（合法目标、计票、淘汰、胜负）
  -> 原子提交新状态；失败则丢弃工作副本

EvalRunner
  -> seeded scenarios / fixture model / optional real model
  -> MetricCollectors
  -> console + JSON report
  -> ThresholdGate（越线时非 0 退出）

ReplayReader
  -> 读取脱敏决策事件
  -> 按时间顺序重建公开对局过程
```

关键原则：

- LLM 负责开放性决策；规则代码负责约束、校验和裁决。
- AgentContext 继续采用 allowlist 构造，不能把完整 `GameState` 交给模型层后再删字段。
- 策略差异放入一等领域对象和请求结构，不散落为若干 prompt 字符串分支。
- 模型输出先进入候选区，只有全部校验通过后才能成为公开事实。
- trace 记录“发生了什么”，replay 记录“公开决策如何演进”，二者都不等于保存私密 prompt。

## 5. 任务线①：Agent 决策与编排

### 5.1 四种显式策略

建立 `AgentStrategy`/`StrategyRegistry`，每位 AI 固定绑定一个策略 ID。策略至少包含：

| Agent | 策略目标 | 描述倾向 | 投票倾向 | 风险偏好 |
| --- | --- | --- | --- | --- |
| 阿序 | 谨慎观察 | 使用低暴露度、可验证的日常属性 | 累积两轮以上证据，降低跟票 | 低 |
| 弥生 | 直觉敏锐 | 关注感官、联想和第一印象 | 对语义违和与犹豫措辞更敏感 | 中 |
| 老墨 | 逻辑派 | 用类别、用途、边界做排除式描述 | 比较前后描述一致性并给出证据 | 中低 |
| 小满 | 出其不意 | 换角度、隐喻、反常规表达 | 主动质疑共识，避免机械多数 | 中高 |

策略对象应影响：描述指令、禁用模式、投票证据偏好、temperature（如保留）、重试纠偏语气。`identity` 中只传当前 Agent 的策略，不传其他玩家的策略内部参数。

### 5.2 顺序发言编排

- 人类仍先提交描述。
- 存活 AI 按稳定座位顺序依次行动，不并发生成描述。
- 每生成并通过一条描述，就追加到“本轮临时公开视图”；下一个 Agent 的上下文由该视图重新构造。
- 所有 AI 都完成后，再一次性把本轮描述和事件提交到正式状态。
- 若任意 Agent 最终失败，正式 `GameState` 不变化，人类描述也不提前落库，允许同一动作重试。
- 投票可继续并行，因为规则规定票在结算前不公开；若为了 trace/原子性更简单，也可串行执行，但绝不能把未公开票泄露给后续 Agent。

### 5.3 描述质量门禁

建立纯函数式 `DescriptionPolicy`，按以下顺序检查候选文本：

1. 基础格式：trim、长度、不可为空。
2. 精确泄词：规范化后不得包含任一完整密词；校验器可使用服务端秘密集合，但绝不把该集合写入 AgentContext/trace。
3. 高风险近似泄题：对空白、标点、大小写等做规范化；检测拆字、加空格和明显变形。规则保持可解释，避免引入不可控的第二个 LLM judge 作为硬门禁。
4. 同轮雷同：与已公开描述做规范化重复、字符 n-gram/Jaccard 相似度和明显公共短语检查。
5. 跨轮重复：同一 Agent 不得重复此前已用表达或高度相近的角度。

输出统一的 violation code，例如 `SECRET_EXACT`、`SECRET_OBFUSCATED`、`DUPLICATE_EXACT`、`TOO_SIMILAR`、`REPEATED_SELF`，供重试、trace 和评测共同使用，避免三套判断逻辑漂移。

纠偏流程：

- 第一次不合格：将“违规类型 + 需换角度”的最小反馈交给同一 Agent 重试，不透露其他玩家秘密。
- 第二次仍不合格：明确中止当前动作并返回可诊断错误；不使用预设描述蒙混过关，也不推进阶段。
- 不合格候选只记录哈希、长度、违规码和延迟，不保存原文；只有通过后的公开描述可进入 replay。

阈值不能拍脑袋固定：先用 20–50 局 fixture/live 样本观察分布，再把初始阈值与理由记录到 `DECISIONS.md` 和评测基线文件。

### 5.4 任务线①验收测试

- 顺序上下文测试：第 1 个 AI 看到人类描述；第 2 个额外看到第 1 个 AI；第 4 个看到此前 3 个 AI，且顺序正确。
- 信息隔离回归：每个上下文序列化后都不含其他玩家密词、身份、未公开票或完整 GameState 字段。
- 策略绑定测试：同一固定局面下，4 个请求携带 4 个不同策略 ID 与约束；策略感知 fixture 产出可区分的描述与投票理由。
- 行为脚本：对同一场景运行四策略，输出风格、目标和证据差异表；真实模型模式可选运行以形成现场证据。
- 质量门禁测试：脚本模型先返回密词/雷同描述，再返回合规描述；断言首稿未公开、发生一次纠偏重试、仅合规稿提交。
- 重试耗尽测试：连续坏稿后动作失败，phase、descriptions、events 均与调用前一致。
- 投票隔离测试：后投票 Agent 看不到同轮任何未公开票。

## 6. 任务线②：可复现效果评测

### 6.1 评测运行模式

提供统一 CLI 和三种模型模式：

1. `fixture`：固定种子 + 固定模型响应，快速、确定、可进入 CI 硬门禁。
2. `fault`：按 Agent/动作/attempt 注入坏 JSON、超时、429、非法目标或坏描述，服务于任务线③。
3. `real`：真实 DeepSeek 批量样本，输出报告但默认不作为 CI 门禁；支持最大局数、并发度和预算上限。

建议命令入口：

- `npm run eval -- --mode fixture --games 50 --seed 20260817`
- `npm run eval -- --mode real --games 10 --seed 20260817 --max-cost <预算>`
- `npm run eval:gate`
- `npm run replay -- <trace-id>`

命令名称可在实现时微调，但 README 中必须只有一个主入口，避免验收者拼装多个脚本。

### 6.2 场景与可复现性

- 固定游戏 seed，并记录 `seed / engineVersion / modelMode / strategyVersion / evaluatorVersion`。
- 用 scripted human policy 自动完成描述和投票；所有人类输入也是 fixture 的一部分。
- 回归集覆盖：普通首轮、同票加赛、人类提前出局、卧底为人类、卧底为 AI、多轮对局、坏描述重试、单 Agent 故障。
- fixture/cassette 进入仓库时只含公开描述、公开投票与脱敏元数据，不含完整密词或私密 prompt。
- 若规则、策略或指标算法变化，显式升级版本而不是悄悄覆盖旧报告。

### 6.3 指标定义

| 类别 | 指标 | 建议计算方式 | 初始门禁方向 |
| --- | --- | --- | --- |
| 泄题 | accepted secret leak rate | 已接受描述中触发秘密检测的比例 | 必须为 0 |
| 防护 | blocked unsafe drafts | 被阻止的泄题/雷同候选数及重试成功率 | 注入用例必须全部阻止 |
| 同质化 | mean/max pairwise similarity | 同轮描述两两规范化 n-gram 相似度 | 均值和最大值不得越基线阈值 |
| 策略差异 | strategy distinguishability | 固定场景中不同策略的表达特征/投票证据差异 | 4 策略不得全部同质 |
| 投票 | valid vote rate | 合法目标票数 / 模型投票总数 | 必须为 100%（进入状态的票） |
| 完局 | completion rate | 成功到达 finished 的局数 / 总局数 | fixture 必须为 100% |
| 稳定性 | retry/failure rate | 各错误类、重试次数、最终失败率 | 固定故障场景符合预期 |
| 延迟 | p50/p95 decision latency | 按 describe/vote/review 与 Agent 分桶 | 不超过记录的回归上限 |
| 成本 | tokens/game、estimated cost/game | 读取 API usage；按可配置单价估算 | 真实模式受预算上限保护 |
| 游戏性 | role win rate/rounds | 按角色、策略统计胜率和平均轮数 | 只作观察，样本不足时不硬门禁 |

注意：fixture 延迟不能代表真实 API 性能，报告必须明确区分 deterministic latency 与 live latency；成本未知时显示 `N/A`，不能伪造为 0。

### 6.4 报告与门禁

- 终端输出一张摘要表，同时生成机器可读 JSON。
- 固定回归报告包含场景数、样本数、版本、阈值、实际值、pass/fail 和失败原因。
- 阈值配置进入版本库，任何门禁变更需在 `DECISIONS.md` 说明依据。
- `eval:gate` 只使用 fixture，任何硬指标越线即非 0 退出。
- 真实模式支持 `--max-cost`、`--max-concurrency` 和超限停止，防止演示失控。

## 7. 任务线③：可观测性与故障恢复

### 7.1 结构化 trace

每个决策生命周期至少记录：

- `timestamp / traceId / requestId / gameId`
- `round / ballot / phase / action`
- `agentId / strategyId / decisionId`
- `attempt / outcome / violationCode / errorClass`
- `model / latencyMs / promptTokens / completionTokens / estimatedCost`
- `retryable / fallback / committed`
- 公开输出可记录正文；被拒绝的私密候选只记录哈希与长度。

禁止记录：

- API Key、Authorization header、`.env` 内容。
- 任一完整密词，即使终局已公开。
- 完整 AgentContext、完整 prompt、模型请求体或含私密推理的原始响应。
- 其他 Agent 的 role/word 或未公开票。

增加脱敏测试：构造带唯一哨兵值的 Key/密词，执行成功和失败路径后扫描 trace/replay，断言哨兵均不存在。

### 7.2 错误分类与重试策略

统一错误 taxonomy：

- `TIMEOUT`
- `RATE_LIMITED`
- `UPSTREAM_5XX`
- `BAD_JSON`
- `SCHEMA_INVALID`
- `INVALID_TARGET`
- `DESCRIPTION_POLICY_REJECTED`
- `NOT_CONFIGURED`
- `UNKNOWN`

重试原则：

- 网络超时、429、部分 5xx 可重试，并尊重 `Retry-After`；使用有限次数的指数退避加 jitter。
- 401/403、未配置、明确业务错误不盲目重试。
- 格式/策略违规由决策层做纠偏重试；transport 层不重复业务校验。
- 只保留一个清晰的 attempt 序列，消除当前嵌套重试造成的计数歧义。

### 7.3 原子性与并发保护

- 为每个 game 建立动作串行 guard，防止双击或并发 HTTP 请求同时推进同一状态。
- 每次描述/投票/自动观战命令在 GameState 工作副本上执行。
- 模型决策、规则校验全部成功后再原子替换正式状态；任一步失败则正式状态不变。
- review 继续允许安全的本地降级，但降级事件必须写入 trace；降级文案只出现在终局，且不进入 Agent 决策。
- 可选支持 `Idempotency-Key`，相同 key 返回同一结果；若时间不足，至少保证同局互斥和失败不半提交。

### 7.4 故障注入与演示

实现只在 test/dev 启用的 FaultInjectingModel，可精确指定：

- 某 Agent 第 N 次描述超时。
- 某次响应为坏 JSON。
- 上游返回 429/500。
- 某 Agent 返回非法投票目标。
- 某描述重复或包含密词。
- review 失败触发终局降级。

每个故障演示都要验证三件事：错误定位字段完整、敏感信息未泄露、正式游戏状态符合“安全继续或明确中止且未半提交”。

### 7.5 脱敏回放

- replay 以公开事件和决策元数据重建时间线：轮次开始、发言顺序、合规重试、投票、淘汰、终局。
- 不依赖保存密词；seed 用于复现发牌，公开描述/票型用于复盘决策。
- 对真实模型，只承诺“重放当时发生的公开决策”，不承诺重新调用模型得到字面一致输出。
- 对 fixture 模式，可依靠 seed + cassette 做完全确定性回归。

## 8. 文件级实施建议

可能修改：

- `packages/server-node/server/types.ts`：策略、决策、trace/usage 类型。
- `packages/server-node/server/agent-context.ts`：加入当前策略的最小上下文，保持 allowlist。
- `packages/server-node/server/game-engine.ts`：工作副本提交、同局 guard 对接、编排器调用。
- `packages/server-node/server/model.ts`：统一调用结果、usage、错误分类和单层重试。
- `packages/server-node/server/app.ts`：request/trace ID、错误响应关联 ID、可选幂等头。
- `packages/server-node/server/index.ts`：model/trace/eval 相关依赖装配。
- `packages/server-node/server/test-utils.ts`：strategy-aware fixture、scripted/fault model。

建议新增：

- `server/agent-strategies.ts`
- `server/agent-orchestrator.ts`
- `server/description-policy.ts`
- `server/observability/trace.ts`
- `server/observability/redaction.ts`
- `server/recovery/action-guard.ts`
- `server/eval/runner.ts`
- `server/eval/metrics.ts`
- `server/eval/scenarios.ts`
- 对应的 `.test.ts` 文件与固定 fixtures
- `.github/workflows/ci.yml`
- 脱敏的 `evidence/` 示例报告（或 README 中的小型关键输出）

文档更新：

- `README.md`：启动方式、选栈说明、核心架构、信息隔离、评测、trace/replay、故障注入、真实模型验收、已知问题。
- `DECISIONS.md`：边做边记录 Coding Agent 使用、人工纠正、阈值依据和未完成项。
- 如架构决策较多，可增加轻量 ADR，但不替代 `DECISIONS.md`。

文件名和目录可在实现时按复杂度合并，重点是边界清楚，不为“看起来模块多”而拆文件。

## 9. 分阶段执行与提交计划

### 阶段 0：建立可比较基线（约 0.5 小时）

- 初始化 Git，第一笔提交仅导入原始 baseline。
- 记录 Node/npm 版本；运行 Node build、domain tests、contract，并保存结果。
- 用 FakeModel 和真实模型各跑一局或至少完成真实健康检查，记录现状问题样本。
- 提交：`chore: import runnable baseline and record verification`

### 阶段 1：刻画测试与策略建模（约 1 小时）

- 先补失败测试：顺序上下文、style 未生效、坏描述进入状态、失败原子性。
- 引入 StrategyRegistry 和最小类型，不改 HTTP DTO。
- 提交：`test: characterize agent orchestration and isolation gaps`
- 提交：`feat: model explicit agent strategies`

### 阶段 2：顺序编排与质量门禁（约 2 小时）

- 实现逐个发言的临时公开视图。
- 实现 DescriptionPolicy、违规码和纠偏重试。
- 保证整个人类描述动作原子提交。
- 跑域测试与 contract。
- 提交：`feat: orchestrate sequential context-aware agent turns`
- 提交：`feat: gate leaking and homogeneous descriptions`

### 阶段 3：trace、故障恢复与状态保护（约 1.5–2 小时）

- 增加 request/decision trace、错误 taxonomy、脱敏器。
- 整理为单层可观察重试；加入 per-game guard 和工作副本提交。
- 加 FaultInjectingModel 与故障测试。
- 提交：`feat: add redacted decision traces and fault injection`
- 提交：`fix: make game actions atomic and concurrency-safe`

### 阶段 4：批量评测与门禁（约 2 小时）

- 实现 seeded runner、场景集、指标聚合、JSON/终端报告。
- 固定 fixture 基线与非 0 质量门禁。
- 运行真实小样本，校准同质化阈值和成本配置。
- 提交：`feat: add reproducible multi-agent evaluation gate`

### 阶段 5：交付收口（约 1 小时）

- 完成 README 和 DECISIONS，放入脱敏验证证据。
- 增加 GitHub Actions：build + tests + contract:node + eval:gate。
- 从干净 clone 按 README 全量验收。
- 只有剩余时间充足时才做前端 trace/指标只读展示。
- 提交：`docs: document architecture validation and known limits`
- 提交：`ci: enforce contract tests and evaluation gate`

总预算约 8–9.5 小时；若只剩 6 小时，优先保留阶段 0–2、评测最小闭环、结构化 trace 与故障注入，放弃前端和幂等键。

## 10. 验收矩阵

| 要求 | 自动化证据 | 现场证据 |
| --- | --- | --- |
| 后发 Agent 看到同轮前序描述 | orchestrator context capture test | 展示一轮 trace 的发言顺序与 context 摘要 |
| 四角色行为可区分 | 同场景 strategy fixture + 报告 | 真实模型同场景输出对比 |
| 雷同/泄题被阻止 | scripted bad-first test | 注入坏描述，展示 reject → retry → commit |
| 信息隔离 | sentinel serialization + HTTP contract | 展示脱敏 trace，不展示私密 prompt |
| 批量评测 | `eval:gate` 非 0 门禁测试 | 一条命令输出指标表 |
| 固定回归 | seed + fixture/cassette | 改 seed/场景并重跑 |
| 精确故障定位 | fault tests 断言 trace 字段 | 注入 timeout/429/bad JSON |
| 无半状态 | 失败前后 GameState 深比较 | 故障后 GET 状态仍可重试 |
| 回放 | replay snapshot test | 回放一局公开决策时间线 |
| 基线不破坏 | build + Vitest + `contract:node` | 现场运行 contract |
| 真实模型可用 | 手工 smoke 记录（不进 CI） | DeepSeek 完整一局 |
| 可演进与过程清晰 | CI + git log + DECISIONS | 讲解关键提交与一次人工纠错 |

## 11. 最终验收命令顺序

正式实现完成后，从仓库根目录按以下顺序验证：

1. 安装依赖并确认 Node 版本符合 README。
2. `npm run build`
3. `npm run test:node`
4. `npm run contract:node`
5. `npm run eval:gate`
6. 运行 fixture 批量对局并保存脱敏报告。
7. 逐个运行 timeout、坏 JSON、429、坏描述和非法投票故障场景。
8. 对 trace/replay 做 Key 与密词哨兵扫描。
9. 配置真实 DeepSeek，运行一局完整对局和一组小规模 live eval。
10. 从干净 clone 按 README 重跑核心路径，确认没有依赖本机未提交文件。

## 12. README 最终必须回答的问题

- 为什么选择 Node 而不是 Go？
- 如何安装、启动 Web/Server、使用 FakeModel 和真实 DeepSeek？
- 4 个 Agent 的策略差异具体是什么，如何进入上下文和模型调用？
- 后发 Agent 如何看到同轮公开描述，而投票为什么仍不可互见？
- 哪些信息能进入 AgentContext，哪些永远不能进入？
- 描述门禁如何判定泄题与雷同，阈值从何而来？
- 如何一条命令跑 N 局、看报告、触发质量门禁？
- 如何制造故障、定位失败、确认没有半状态？
- trace/replay 保存了什么，如何证明没有 Key/完整密词？
- Coding Agent 做了什么，哪些部分经过人工审查和修正？
- 如何验收真实模型，而不是只证明 FakeModel 可用？
- 已知问题、费用风险、内存状态丢失和评测样本量限制是什么？

## 13. 主要风险与应对

- **顺序发言增加延迟**：描述阶段由 4 路并发变为串行。先接受正确性换延迟，并在 live eval 量化 p95；未来可研究两阶段并发，但本次不牺牲“后发可见”。
- **启发式相似度误杀**：先记录 rejected 指标并用样本校准；违规码可解释，阈值配置化，保留单元测试语料。
- **真实模型波动**：固定 fixture 负责 CI，live eval 只做趋势和现场验证，报告明确样本量。
- **trace 泄密**：默认不记请求/原始响应，使用哨兵扫描测试；公开描述是唯一允许记录的模型正文。
- **成本统计不准**：优先读取 API `usage`；模型单价配置化并注明时间/来源，无法确认时报告 token 而非虚构金额。
- **过度工程**：不引入外部平台或数据库；所有抽象都必须对应一个验收信号或故障边界。
- **状态仍为内存**：本次通过原子提交和同局 guard 保证进程内正确性；进程重启持久化列为已知问题，而不是临时加入重型数据库。
- **基线没有 Git 历史**：第一提交原样导入，后续按能力切片，保证可投屏解释真实迭代过程。

## 14. 推荐最终交付口径

最终演示建议按“问题—设计—证据”组织，而不是按文件逐个介绍：

1. 先展示基线四 Agent 同质、同轮上下文缺失。
2. 展示 StrategyRegistry 与顺序编排如何解决问题，同时运行信息隔离测试。
3. 注入一条泄题/雷同描述，展示门禁、纠偏重试和原子提交。
4. 一条命令跑批量评测，展示门禁与版本比较。
5. 注入超时或坏 JSON，展示精确 trace、无半状态和脱敏 replay。
6. 跑 `contract:node` 与真实 DeepSeek 完整对局收尾。

这样能直接对应产品完整性、Multi-Agent 设计、信息边界、系统稳健性，以及对 Agent 生成代码的理解与验证五个评价重点。
