# 过程与决策记录(候选人填写)

> 这份文档用来记录你「怎么用 Coding Agent、做了哪些判断」,是评分的重要依据之一。
> 请边做边写,不要事后补。下面的空模板保留,按你的实际情况填。

## 0. 我选择的技术栈

- [x] Node(`packages/server-node`)
- [ ] Go(`packages/server-go`)

选择理由:二次开发的策略层、评测适配器、trace、CLI 与运行时 schema 可统一在一套 TypeScript 生态里,
类型贯通前后端;Go 侧保留为不变的外部契约对照(同一份语言无关契约 `contract/` 双向校验)。

## 1. 我完成了哪些任务线

- [ ] 任务线① Agent 决策与编排(让四个 AI 有各自策略、会利用逐步公开的信息、说话不泄题)—— 必做
- [ ] 任务线② 效果评测(用一个命令批量跑多局,输出可对比的质量指标)
- [ ] 任务线③ 可观测性与故障恢复(出问题时能看清、能复现、能优雅降级)
- [ ] 选做加分:前端体验优化 / 后端工程优化(见任务书第 3 节)

> 任务线④是现场当场揭晓的题目,带回家不用准备,这里也不用写。

未完成的部分及原因:

## 2. Coding Agent 使用记录

- 我用的工具(Cursor / Claude Code / TraeCode 等):Claude Code(Opus)。全程 OpenSpec 规格驱动:
  先冻结基线 → 特征化测试钉住现状 → 再落接缝,避免"匆匆跑通后返工"。
- 哪些改动主要是 Agent 生成的(涉及哪些文件 / 大致范围):
  - `docs/evidence/B0-baseline.md`(基线三绿证据 + 三处基线问题定位)。
  - `packages/server-node/server/b0-characterization.test.ts`(5 条特征化测试)。
  - 锁文件内网镜像 host → 公共 npm 源(仅改 `resolved` host,版本与 integrity 不变)。
- 我人工审查和改动了哪些地方:
  - 逐条核对特征化断言与真实基线行为一致(如 `Promise.all` 并行导致后发看不到同轮先发)。
  - 把提交切成有意义的边界(基线导入 / 锁文件修复 / 证据 / 特征化测试),便于现场投屏讲 git log。
- **Agent 有一处给错了或给得不够好,我是怎么发现并纠正的**:
  - Agent 初次倾向"过度规划"并主张砍掉 OpenSpec 03 的人类数据线;我按题目"以效果为最终目标"
    否决了该判断,改为"真实语料 + LLM 自博弈 + 已发表评测方法学"的务实路线,不引入治理开销。
  - Agent 初次的泄题检查沿用基线的字面子串判断;我要求接缝阶段升级为
    近义 / 同质 / 自我重复的 QualityPolicy(见 §3 与 OpenSpec 03 §5.5)。

## 3. 关键设计取舍

> 每条尽量写清:遇到什么问题 → 我怎么做的 → 放弃了哪个方案 → 为什么。

- ① 怎么让后发言的 AI 看到本轮前面已公开的描述,同时又保证它看不到别人的身份和词:
  把描述生成从 `Promise.all` 并行改为**确定性座次串行**(`game.players` 座次 ai-1..ai-4)。
  每个后发 Agent 生成前,用 `{...game, descriptions: [...已公开, ...本轮已产出]}` 构造上下文,
  再经 `buildAgentContext` 的**允许列投影**取信息——所以它能看到人类 + 更早座次 AI 的公开描述,
  却拿不到任何他人的 role/word(投影只吐 playerId/name/text/round)。放弃了"并行 + 事后排序"方案:
  并行下每个 Agent 都只见开局快照,信息利用无从谈起。见 `orchestration.test.ts`(座次、可见性、隔离三断言)。
- ① 怎么让四个角色(谨慎 / 直觉 / 逻辑 / 出其不意)在同样局面下说出不一样的话:
  给每个座次绑定一份**版本化、可解释的策略原型**(`strategies.ts` 的 `SEED_STRATEGIES`:persona +
  tactics + specificity/novelty/risk 三个 0–1 连续量 + provenance)。策略是**结构化数据**而非硬编码 prompt——
  经 `projectStrategy` 投影成只含行为面的 `StrategyView`(剥掉 id/version/provenance/sampleIds 等溯源元数据),
  再由 `model.ts` 的 `render(strategy, context)` 把人设与三档连续量渲染进 system prompt。放弃了"把风格文案写死进
  prompt 模板"的旧法(基线 CH-2:style 字段对行为零影响、四 AI 同质):数据化后策略可被检索 / 排序 / 迭代,
  且**投影严格剥离溯源字段**——策略永不进公开 DTO,也不把 sample 出处泄给模型。见 `persona.test.ts`
  (四人设可区分且等于四风格、投影无元数据、种子过版本化 strategy schema 三断言)。
- ① 怎么判断一条描述"太雷同或快泄题了",判定之后怎么处理(重试还是降级):
  抽出一个**纯函数、确定性、模型无关**的质量策略 `evaluateDescription`(`quality-policy.ts`),四类判定:
  ① 直接泄题(原文含密词)② 伪装泄题(去掉空格/标点/间隔符后仍能拼出密词,如「拿 铁」「拿·铁」)
  ③ 同轮同质(与本轮先发描述的**字符二元组 Jaccard** ≥ 0.72)④ 自我重复(与自己更早轮次 Jaccard ≥ 0.8)。
  阈值这样定:同质门要拦"四个 AI 说同一句"却不能误伤"仅换人名/措辞"的正常差异——实测四个假名换字的
  Jaccard≈0.63,故取 0.72 留余量;自我重复更严(0.8)因为同词玩家跨轮本就会复访主题,只拦近乎逐字的重复。
  处理策略是**先纠正后降级**:引擎在生成边界对每个 AI 做有界重试(`MAX_DESCRIBE_ATTEMPTS=3`,correction),
  仍不合规则抛 `QualityExhaustedError` 让**整回合原子终止**(exhaustion)——绝不落半成品,与 CH-4 原子性同源,
  也给可观测/恢复层(04)留了一个明确的失败信号(policyCode)。放弃了"截断/替换成安全占位串"的降级:
  那会把一条劣质描述伪装成正常发言,污染后续投票与评测。见 `quality-policy.test.ts` / `quality-gate.test.ts`。
  策略是**纯函数**,所以同一份可直接被评测线复用、可确定性回放,且判定不接触任何私有身份。
- ① 怎么让 AI 有"记忆/推理"却不落自由文本 CoT、也不互相偷看:
  给每个 AI 一份**私有结构化信念**(`beliefs.ts` 的 `Belief`:`suspicions[{playerId,score}]` +
  `selfExposure` + `evidenceRefs[{playerId,round}]`),完全**没有自由文本字段**——所以天然通过 belief 的
  strict schema,密词/身份/推理独白无处容身。信念由 `observeRound` **纯函数**从公开描述推导:一条描述与
  本轮其余描述的字符 bigram 平均相似度越低越"离群",离群度→怀疑度按 **EMA(α=0.5)** 平滑更新,单调有界在
  [0,1](复用质量门的 `similarity`,同一把尺子)。每条怀疑只挂 `(playerId, round)` 公开引用背书,不搬运原文。
  跨 Agent 非干扰靠**签名**保证:`observeRound(prev, {round, selfId, descriptions})` 只吃"自己上一份信念 +
  本轮公开描述",结构上拿不到任何他人信念;引擎把信念存在 `beliefs: Map<gameId, Map<agentId, Belief>>`,
  **独立于 GameState**,故不随 `structuredClone` 草稿流动、`toPublic` 不序列化、`buildAgentContext` 不投影——
  信念永不进公开 DTO / 他人上下文 / 存盘。放弃了"让模型自己写一段思考再解析"的做法:自由文本既会夹带密词、
  又不可确定性回放、还无法在评测里当结构化特征用。见 `beliefs.test.ts`(归一化/校准/证据/非干扰)与
  `beliefs-engine.test.ts`(信念不进公开 DTO、不进任一 Agent 上下文)。
- 【范围 · 诚实边界】哪些**刻意没做**、为什么:按"以效果为目标、不引入数据治理开销"的显式取舍,OpenSpec 03 的
  §3 数据治理(consent/rights/withdrawal/lineage/split-manifests)、§4 的**真实语料挖掘 + 形式化溯源测试**、
  §2.3 迁移守卫**本轮不交付**。理由:① 题目核心是 CH-1..4 四病与全栈二次开发,数据合规是我为"学习真实人类语料"
  提出的延伸,非题目要求;② 运行系统当前只用 `synthetic` 手写种子策略,不接触任何人类语料,故**没有一条未兑现的
  隐私/合规承诺**——我特意**不把这些治理 spec 折进基线**,避免"号称合规实则未实现"的现场雷。已交付的是其**效果等价物**:
  策略×代码解耦(B/C 层)——种子策略是版本化数据,替换为语料抽取分布是**纯数据变更、不动编排代码**。延后项结构化交接:
  迁移守卫→04-G;语料回填→C 阶段(见 `openspec/changes/03-.../tasks.md` 顶部范围决定 + `docs/evidence/03-handoff-04-05.md` §6.4-b)。
  放弃了两条歧路:一是**假装做完**(勾满 checkbox)——现场 `openspec` 一翻即穿;二是**真去搭合规机器**——那正是题目提醒的
  过度工程,会吞掉本该投给编排/评测/前端的预算。
- ② 每个质量指标是怎么算的,阈值为什么定这个数(评测线 `server/eval/*`,命令 `npm run eval:node`):
  先解决"人类在环无法批量跑"的前提——引擎按题设把人类硬编码 seat0,我**不改核心规则**,而在 harness 里
  用**确定性安全脚本**陪跑人类座位(轮换句对 24 个候选密词都不含子串、恒过字面泄题门;投首个合法存活 AI),
  4 个 AI 座位由模型驱动;指标只在 AI 座位上算。复现性靠**共享 `mulberry32(seed)` 随机流**:一条流跨多局
  顺序推进 → 局与局各异(覆盖不同卧底落位/词对/终局),但同 seed 同批**逐字节可复现**(测试断言两次运行报告
  JSON 全等)。指标口径(全部**带分母 n**,比率类附 95% 近似置信半宽):**泄题**=AI 描述含自身密词条数(结构上
  应恒 0,跨 N 局做回归);**非法票**=目标非真实存活/自投条数(同应恒 0,引擎已在 `generateVotes` 重裁);
  **多样度**=同轮跨 AI 描述对的平均 (1−字符 bigram 相似度);**策略可区分率**=同轮跨 AI 描述对中相似度 <0.72
  的占比——**复用质量门同一把尺**(0.72 的由来见上一条:四假名换字实测≈0.63,取 0.72 留余量),故"可区分"
  与"不判同质"共用一致判据;**自我重复率**=同一 AI 相邻两轮自述相似度(越低越好);**信念校准**=平民 AI
  最高怀疑命中真卧底的比率 + 平均怀疑差(对真卧底 − 对他人),**卧底自身不入分母**(不猎捕自己);
  **重试**=describe 调用数 − 落地描述数(质量门有界重试的可观测代理);usage 确定,**latency/cost 属墙钟量、
  留真机模式单列**(fixture 报告要逐字节稳,不含时延)。门禁阈值取"当前 fixture 稳过、又非平凡"的档位
  (完成率下限 =1;可区分率下限 =0.5;多样度下限 =0.05;校准命中默认不设硬门——假模型不代表真机),
  五类门(泄题/非法/未完成/隐私哨兵/阈值)任一命中即 **process 非零退出**;`--demo-fail` 注入必然泄题的模型,
  触发质量穷尽→整回合原子终止→完成率门捕获(exit 1),现场演示"门禁真的会红"。keyset 冻结以防指标操纵(R3)。
- ③ 一条日志 / trace 里记了哪些字段,怎么保证不把密词和 Key 写进去(change 04-F 可观测层):
  一条 trace 是一个**版本化 `traceEvent` 信封**(`{v,kind,data}`),`data` 的 schema 是 `.strict()` 的,字段**闭集**共 11 个:
  `correlationId`(关联一次调用的尝试世系)、`round`/`ballot?`(定位到第几轮 / 第几张选票)、`boundary`
  (`model.describe`/`model.vote`/`model.review`/`hook` 之一)、`playerId?`(定位到哪个 AI)、`attempt`(第几次尝试)、
  `outcome`(`accepted`/`rejected`/`error`)、`policyCode?`、`latencyMs?`,以及被拒候选侧的 `candidateHash?`/`candidateLength?`。
  **不写密词 / Key 靠三道结构性闸,而非事后 grep 兜底**:① strict schema **没有任何自由文本位**——想塞 `reasoning`/`word`/`prompt`/
  `belief` 这类字段,`parseVersioned` 直接抛(`schema.test.ts` 用 `['word','prompt','belief','apiKey']` 钉死拒绝);
  ② 唯一的字符串位 `policyCode` 再过**允许列**(`obs/tracer.ts` 的 `POLICY_CODES`:9 类故障 + 5 类质量码 + 2 类 hook + 恢复标记),
  非登记短码即抛——杜绝把自由文本(乃至密词)伪装成"错误信息"塞进来;③ 被拒候选**绝不落原文**,只留
  `candidateHash`(FNV-1a → 8 位十六进制,不可逆)+ `candidateLength`(码点数),供"重试是否真换了候选 / 长度是否异常"复盘。
  **杀手级证明**:`obs/engine-trace.test.ts` 让模型每次都吐**密词本身**当描述,3 次被拒后 `scanTraceArtifacts` 扫全部 trace 序列化
  **仍为空**——候选就是密词,trace 里却一个密词字面量都扫不出。Key 侧同尺:`redaction.ts` 单一哨兵集含全部密词 + 凭据前缀
  `sk-`/`ark-`,是质量门 / 评测门 / trace 扫描**共用的一把尺**(单一事实源,不会各扫各的漏)。
  **两条世系、同汇可辨**(design.md 决策 6):传输重试(`TracedModel` 包模型,`corr-N`,每次 `model.*` 调用一条尝试世系,
  失败经 `classifyFailure` 归 9 类)与决策纠偏(引擎质量环在 `describe` 边界重描,`eng-N`,拒稿落 `policyCode`+指纹)是
  **两套独立 correlationId**,却写入**同一个 `MemoryTraceSink`**——所以复盘时既能分辨"是网络重试还是质量重描",又能在一条时间线里连读。
  放弃了两条歧路:一是**把 usage(token)塞进逐条 trace**——token 是不稳定量,会破坏 fixture 逐字节稳定性,故按 design §5
  留在**指标层**(04-E `eval/metrics.ts`)带分母聚合;二是**先记原文再运行时脱敏**——脱敏一旦漏一条就是永久泄露,改为
  **结构上就装不下原文**(strict schema + 指纹替换),从根上取消了"忘了脱敏"的可能。生产接线见 `app.ts`:`TracedModel` 包模型
  + 引擎注入 `obs`,同汇一把**有限环形上限(2000)**的 sink(防长跑无界增长);**默认不注入则零发射、行为逐字节不变**
  (150+ 存量测试不受影响,`obs/engine-trace.test.ts` 专测"不传 obs → sink 恒空"的向后兼容)。见 `obs/engine-trace.test.ts` /
  `obs/tracer.test.ts` / `obs/recovery.test.ts` / `schema.test.ts`。

## 4. 验证证据

> 贴命令 + 关键输出(注意别带上密钥或完整密词)。

- 契约(所选栈):`npm run contract:node` → **28 通过 / 0 失败**(FakeModel 路径)。见 `docs/evidence/B0-baseline.md`。
- 域测试 / 构建结果:`npm run test:node` → **106 通过 / 0 跳过**(含真机 DeepSeek smoke + 投票隐私/授权双回归
  + 04-E 评测线 23 条);`npm run build` → server(`tsc --noEmit`)**通过**。B0→04-E 全程三绿。
- §6 变更证明:配对消融表(顺序 0→3 / 人设 1→4 / 信念校准 0→>0)+ 哨兵×边界矩阵(5 哨兵 × 4 边界全拦截)。
  见 `docs/evidence/03-6-proof.md`,证据测试 `ablation.test.ts`(3)/ `sentinel-sweep.test.ts`(7)。
- 真机链路:预算封顶 DeepSeek smoke(`smoke.deepseek.test.ts`,MAX_MODEL_CALLS=24)已在真实
  `api.deepseek.com` 通过——真机描述不泄密词、终局前不揭示他人身份;实际返回模型 `deepseek-v4-flash`。
- 批量评测脚本的输出(指标表):`npm run eval:node -- --games 12 --seed 1` → 记分卡(12 局 fixture,门禁全绿):
  泄题 0/111 · 非法票 0/111 · 完成率 100% · 多样度 99.6% · 策略可区分率 100% · 自我重复 0.5% ·
  校准命中 35.9%±15.1% · 卧底/平民胜率 50%/50% · 模型调用 234。门禁演示:`-- --demo-fail` → **exit 1**
  (incomplete_game + 阈值门触发)。逐字节稳定性由 `gates.test.ts` 断言。详见 `docs/evidence/04-E-eval-scorecard.md`。
- 故障注入 + 定位到具体一局 / 某一轮 / 某个 AI / 第几次尝试的示例(change 04-F 可观测层):
  `obs/recovery.test.ts` 用 `FaultInjectingModel` 把**9 类故障各自**注入 `model.describe` 边界(`it.each`),断言 trace 末条
  `policyCode` 落对应短码(503→`upstream` / 429→`rate_limit` / 未配置→`auth_config` …)、`outcome`、及尝试世系长度
  (可重试打满 `maxAttempts`、不可重试零等待快速失败);时钟经 `recordingClock` 注入 → **断言退避序列却绝不真的等待**。
  决策纠偏侧 `obs/engine-trace.test.ts`:模型恒吐密词 → 同一 `correlationId` 贯穿 `attempt:[1,2,3]` 三次纠偏、`policyCode='exact_leak'`
  ——即一条 trace 能定位到"哪一轮 / 哪个 AI(`playerId`)/ 第几次尝试 / 因何被拒",且**终局失败经引擎 `withGame` 原子草稿 →
  权威状态逐字节 before == after**(CH-4 优雅降级)。生产接线后同一把 sink 在真实 `createApp` 里跑,非测试脚手架。
  测试计:`npm run test:node` → **157 通过 / 0 跳过**(27 文件,含 `obs/*` 51 条);`npm run build`(`tsc --noEmit`)通过;
  `npm run contract:node` → **28 通过 / 0 失败**;`npx openspec validate 04-evaluation-and-recovery --strict` → valid。
- 用真实模型完整跑一局的记录:`docs/evidence/03-6-real-game.md`(脚本 `server/tools/play-real-game.ts`,
  真机 3 轮到终局,23/80 次调用)。看点:四人设话风可辨、后发接住先发、平票触发第 2 张选票、
  秘密词全程脱敏为 ▢▢;本局卧底(出其不意人设 小满)以诗意误导取胜。
