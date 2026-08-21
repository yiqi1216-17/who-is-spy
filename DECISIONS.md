# 过程与决策记录(候选人填写)

> 这份文档用来记录你「怎么用 Coding Agent、做了哪些判断」,是评分的重要依据之一。
> 请边做边写,不要事后补。下面的空模板保留,按你的实际情况填。

## 0. 我选择的技术栈

- [x] Node(`packages/server-node`)
- [ ] Go(`packages/server-go`)

选择理由:二次开发的策略层、评测适配器、trace、CLI 与运行时 schema 可统一在一套 TypeScript 生态里,
类型贯通前后端;Go 侧保留为不变的外部契约对照(同一份语言无关契约 `contract/` 双向校验)。

## 1. 我完成了哪些任务线

- [x] 任务线① Agent 决策与编排(让四个 AI 有各自策略、会利用逐步公开的信息、说话不泄题)—— 必做
  - 三病全反转(CH-1 顺序 / CH-2 人设 / CH-3 质量),CH-4 原子性作为不变量保持。证据见 §3 与 `docs/evidence/03-6-proof.md`。
- [x] 任务线② 效果评测(用一个命令批量跑多局,输出可对比的质量指标)
  - `npm run eval:node -- --games N --seed S`:确定性自博弈,输出带分母+置信半宽的全套指标,五类门任一命中非零退出。
    证据见 §4 与 `docs/evidence/04-E-eval-scorecard.md`。
- [x] 任务线③ 可观测性与故障恢复(出问题时能看清、能复现、能优雅降级)
  - 脱敏 trace(九类故障分类学 + 决策纠偏 + hook 世系,同汇一把环形 sink)+ 事件式回放(四关校验、不重跑模型)+
    dev-only 故障注入开关,并落到同端口 `/ops.html` 观测台(生产四重闸禁用)。证据见 §3 ③④⑤、§4。
- [x] 选做加分:前端体验优化 / 后端工程优化(见任务书第 3 节)
  - 前端:竖屏 9:16 剧场(五席立绘 + 首人称完整对局 + 上帝/玩家双模式 + 高光 + 反馈手记),生产禁用的开发态场景驱动。
  - 后端:版本化 schema 底座 + 域状态机 + 每局命令链/原子提交 + typed hook 注册表 + 私有结构化信念。

> 任务线④是现场当场揭晓的题目,带回家不用准备,这里也不用写。

未完成的部分及原因(诚实标注):
- **真实人类语料挖掘 + 数据合规机器**(03 §3/§4 的 consent/rights/split-manifest/lineage)未做——运行系统只用 `synthetic`
  种子策略,不接触人类语料,故没有未兑现的隐私承诺;已交付效果等价物(策略×代码解耦,替换为语料分布是纯数据变更)。
- **竖屏像素级截图/录屏矩阵**(05 §4.4)未做——本机无浏览器驱动(playwright 缓存空、联网超时);可自动化的安全区/输入可达性/
  动效/重连连续性已用确定性断言(`viewport.test.ts` 17 例)全绿,像素证据留现场真机演示时补。
- **05 第 6.3 真人盲测**(clarity/fun/replay/share 意图)未做——需真人样本,留现场 playtest;其余 6.x 门禁类已全绿。

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
- ④ 出问题后怎么"复现"一局又不重跑模型、不泄密、还能验出被人动过手脚(change 04-G 回放层):
  做成**事件式回放**(design.md 决策 8):引擎的 `game.events` 里**只有已接受的公开动作**(被拒候选只在 04-F trace 留 hash/length,
  从不进事件流),所以回放天然只复放"能公开复放的东西"。`replay/log.ts` 把有序事件折成日志,每条带**位置序号 `seq`**(0,1,2,…)作
  单调 ID + **FNV-1a 链式校验和**(`checksum[i]=hash(checksum[i-1]#canonical[i])`);关键是**丢弃引擎内部的 `randomUUID` 事件 id 与时钟**,
  只留语义字段——故同一局内容 → **逐字节相同的日志**(`replay.test.ts` 断言同 seed 两局 `records` 全等),与 04-E 可复现口径一脉。
  回放校验四关(`replay/replay.ts` 的 `validateReplayLog`):① schema/version(过登记的 `event` strict schema + 版本信封 = 迁移守卫)
  ② 缺口 / 乱序(`seq≠位置`)③ 重复(`seq` 已见)④ 篡改(链式校验和失配,含截断 / 追加)——每种都**定位到具体 `seq`**。重建函数
  `reconstructTimeline(log)` **签名里根本没有模型参数**,故"不重跑模型"不是靠自觉而是**结构上不可能**;`replay.test.ts` 用 `CountingModel`
  额外证"反复重建期间模型调用数恒为 0",并证重建出的描述与本局公开描述**逐条一致**(accepted 可复放,补齐 §3.3 的 accepted 侧)。
  数据记录导出 `replay/dataset.ts` 走登记的 `datasetRecord` strict 信封,三条隐私纪律:**假名化**(真实姓名 / 席位 id 全丢,只留座次
  派生 `p0..p4`)、**无密词位**(schema 结构上没有 word 字段 → 密词永不落盘)、**来源三分离**(`human`/`transfer`/`synthetic` 显式传入、
  不自动混写)。放弃了两条歧路:一是**存完整状态快照 + 重跑模型来"回放"**——那既不确定(墙钟 / 采样)、又要把私有身份 / 密词一并存盘,
  正是隐私雷区;二是**把随机 `randomUUID` 事件 id 也写进日志**——那样同一局两次导出就不逐字节相等,回放的"可核对"意义就没了。生产接线:
  引擎 `getReplayLog`/`reconstructReplay`(只读派生,不改核心)+ `GET /api/games/:id/replay`(公开安全端点,`app.test.ts` 证不含 role/word、
  扫不出密词);`exportDataset` 含终局 role 标签,**服务端专用、不设 HTTP 出口**,避免终局前泄身份。见 `replay/replay.test.ts`(20 条)/ `app.test.ts`。

- ⑥ 投票理由 `vote.reason` 的公开/私有边界(一处**保持基线并如实标注残余风险**的取舍):
  一条投票(`Vote`)= `voterId` / `targetId` / `reason` / `round` / `ballot`,经 `toPublic` **无条件全量公开**
  (`game-engine.ts::toPublic` 的 `votes: game.votes`,终局前即可见)。**公开本身是基线契约行为**,也是推理体验的
  地基——投票可视化、终局票局回放、评测的票因分析都消费它;把它私密化会砍掉"公开票型可复盘"这条产品线。
  **但要如实标注一处不对称**:描述侧有**双重结构闸**(`model.ts` 适配器对含密词描述直接抛错重试 + 引擎
  `evaluateDescription` 质量门四判定、有界重试、穷尽即原子终止),而 `reason` 只有 prompt 语义约束
  ("给出简短**公开**理由",`model.ts::vote`)+ zod 长度闸(2–80 字),**没有**字面/伪装泄题判定——模型生成
  reason 时上下文里确有自己的 role/word,理论上存在"把密词藏进投票理由"的**残余泄题面**。为什么本轮**不**给它
  套质量门:① 语义方向不同——reason 陈述"为什么怀疑**别人**",正常输出不触及自己的词,风险是低频尾部而非
  描述那种"每句都在词的引力场里";② 契约与行为保守——reason 公开是冻结契约的一部分,加拦截改变既有行为面,
  收益/风险比不如描述门;③ 已有下游监控——评测线的泄题指标扫的是**全部公开文本**(含 reason),真机批量跑若
  出现 reason 泄题会被记分卡暴露,不至于无声。**若现场要求收紧**:正确落点是把 `evaluateDescription` 的
  exact/obfuscated 两类判定(不含同质判定,同质对 reason 无意义)在 `generateVotes` 采纳 `result.reason` 前
  复用一遍——纯函数已就位,接线是十行级改动;这也是我对"下一步最想修什么"的答案之一。
  另:真正的私有推理通道是 `private_reasoning_summary`(≤120 字,`schema.ts`),它不进 `toPublic`、不进他人
  上下文、不进事件流——"动机"有独立私有链路,不需要靠藏 `vote.reason` 来承担。
  **同端口独立入口 `http://localhost:5173/ops.html`(横屏控制台),而不是新起一个端口、也不融进游戏页**。
  三选一的取舍:新端口要多一份 vite 配置 + 代理 + 一个现场可能挂的进程,收益为零;融进游戏页会把开发工具
  混进玩家动线、还得在竖屏牌桌里塞横屏表格。独立 `.html` 入口两头占优:dev 下 vite 按文件系统直接服务、
  复用同一个 `/api` 代理;**生产构建的入口集里没有它**(rollup 默认只打 `index.html`),故观测台**结构上不进
  生产 bundle**(实证:`vite build` 后 dist 仅单 chunk,`grep -rl 观测台 dist/` EXIT=1)。生产禁用共**四重闸**,
  每重可独立测试:① 生产服务端不挂 `/api/ops/*`(404);② 生产模型链上根本不装 `FaultSwitch`(TracedModel
  直包真实模型,无故障面);③ `arm()`/`registerOpsRoutes` 自校 `NODE_ENV` 即抛;④ 前端入口不在构建集 +
  `import.meta.env.DEV` 兜底。**trace 的「哪一局」维度**顺手补齐:题面验收要"哪一局/哪一轮/哪个 AI/第几次
  重试/什么错误"五维,原 traceEvent 缺 gameId——但 `AgentContext.game` 是允许列投影**刻意不含局号**、
  `GameModel` 接口受契约冻结不能加参,故用 Node 标准 `AsyncLocalStorage`:引擎在 `withGame` 命令体与上帝局
  解算点 `run({gameId})`,`emitTrace` **单一收口点**读取注入(跨 await 自动继承),三类发射方(传输/纠偏/hook)
  一处补齐,接口与投影零改动。放弃的歧路:把 gameId 塞进 AgentContext(污染允许列投影,模型 prompt 无端多见
  一个字段)或改模型签名(破坏冻结契约)。运行时故障开关 `FaultSwitch` 与测试用 `FaultInjectingModel` 语义
  对齐(复用 `syntheticError` 保证 `classifyFailure` 往返)但**可运行时装/卸**,且禁用态逐字节透传(contract
  28/0 持续全绿为证);`/api/ops/trace` 输出前再过一遍 `scanTraceArtifacts` 隐私哨兵,命中即拒绝输出——
  结构性脱敏(strict schema)+ 运行期自证双保险。评测端点在**独立引擎**上跑确定性自博弈(同 seed 逐字节
  可复现),结构上不触碰线上任何真实对局。

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
- 事件式回放 + 数据记录(change 04-G 回放层):`replay/replay.test.ts`(20 条)证四关各自触发并**定位到具体 `seq`**
  (缺口 / 重复 / 篡改含截断 / 非法 type / 版本不符)、同 seed 两局 `records` **逐字节相等**、反复重建期间**模型调用数恒 0**、
  重建描述与本局公开描述**逐条一致**、日志与 `datasetRecord` 导出**扫不出任何密词**、导出物假名化(`p0..p4`)且结构无 `word` 键;
  `app.test.ts` 证 `GET /api/games/:id/replay` 只读端点**不含 role/word、扫不出密词、未知局 404**。测试计随 04-G 升至
  **`npm run test:node` 178 通过 / 0 跳过**(28 文件);`build`(`tsc --noEmit`)/ `contract:node` 28-0 / `openspec validate 04 --strict` 全绿。
- 用真实模型完整跑一局的记录:`docs/evidence/03-6-real-game.md`(脚本 `server/tools/play-real-game.ts`,
  真机 3 轮到终局,23/80 次调用)。看点:四人设话风可辨、后发接住先发、平票触发第 2 张选票、
  秘密词全程脱敏为 ▢▢;本局卧底(出其不意人设 小满)以诗意误导取胜。
- 观测台(任务线③前端呈现,`/ops.html`):`ops.test.ts` 6 例——trace 按 gameId 过滤且五维齐、
  瞬时 upstream(times=1)重试世系 `[1,'error']→[2,'accepted']` 且对局照常完成、恒失败 auth_config
  **HTTP 侧整回合原子回滚**(describe 500 后 `GET /api/games/:id` 与失败前逐字节一致,解除后同局恢复推进)、
  评测端点同 seed 报告逐字节相等 + `demoFail` 门禁红、生产三重闸(路由 404 / 链上 faultSwitch 为 null /
  `arm` 即抛)。测试计升至 `npm run test:node` **280 通过 / 0 跳过**;`contract:node` **28/0** 持续全绿;
  web `tsc` EXIT 0 + `vite build` 后 **dist 无观测台工件**(仅 index 单 chunk,内容 grep EXIT=1)。
  dev 冒烟:`GET /api/ops/faults` → `{"armed":false,...}`、`POST /api/ops/eval`(2 局)在线返回记分卡、
  `http://localhost:5173/ops.html` 200。
- 前端体验线(change 05-H,竖屏剧场)收口计:web `npx vitest run` → **8 文件 89 通过 / 0 跳过**
  (表现层状态机 13 · 导演编排 12 · 上帝导演 11 · SSE 流 17 · 高光 9 · 反馈 6 · 场景库 13 · 视口契约 17);
  web `tsc --noEmit` EXIT 0;`vite build` 单 chunk(生产无场景驱动/观测台工件,独占串 grep `leaked=0`)。
  开发态场景驱动 `?scene=` 十场景(role-reveal/speech/vote/tie/elimination/failure/reconnect/finale/highlight/replay)
  全部用生产 schema 构造,生产禁用三层保险(结构不 import api / 构建 DCE / 运行时抛错)。
  证据 `docs/evidence/05-4-scene-driver.md`;`openspec validate 05 --strict` ✓。
- 全局门禁末次复核(2026-08-19 交付收口):`npm run build` EXIT 0(web + server 双 tsc)·
  `npm run test:node` **280 通过 / 0 跳过(39 文件)** · `npm run contract:node` **28 通过 / 0 失败**。
- 语料地基线(03 §3/§4,2026-08-21):四来源权利定性(werewolf-among-us=可迁移 / spygame=仅方法 GPL /
  ctwei-spy=无许可隔离 / ck-arena=合成 Apache)→ `data/normalize.ts` 严格信封 `datasetRecord` → `data/splits.ts`
  按组(词对 / 视频 cohort)FNV-1a 播种泄漏隔离 70/10/10/10 → `data/extract-strategies.ts` 产出带 transfer 溯源的
  `TRANSFER_STRATEGIES` v2,**只换数据不动编排代码**(种子策略 synthetic→transfer 为纯数据变更)。脚本
  `npm run data:import / data:splits / data:strategies`。
- 迭代对比评测(04 §5.3 champion/challenger · §6.1 消融,题面②「看到提升 diff、劣化被拦」):
  `npm run compare:node` 在**同 seed、同随机流、同人类陪跑、唯一变量=策略集**下,跑三配置 `collapsed →
  synthetic-v1 → transfer-v2` 并产出逐步 metric diff + 回归预算门。经 `resolveStrategy` 注入缝把策略解析注入引擎
  (**零契约变更**,`contract:node` 仍 28/0),`StrategyDrivenModel` 按 persona 取词——可区分则描述低相似(过 0.72
  质量门),坍缩则雷同(撞门→重试→穷尽→整回合原子终止)。实测:坍缩(完局 0 / 可区分 0,门禁 ❌3)→ v1
  (完局 1 / 可区分 1 ✅)是明确提升;v1→v2(完局 1 / 可区分 1,漂移 0)是纯数据等价。回归预算门双向验证:
  好→坏 `regressed=true` → **CLI exit 1**、坏→好不触发(完局率零容忍)。证据 `docs/evidence/04-strategy-compare.md`
  (自动生成分析报告)+ 同名 `.jsonl`(逐配置逐指标脱敏日志,落盘前 `scanSecrets` 双保险)。验收 `eval/compare.test.ts`(8)。
- 持久化工件迁移守卫(03 §2.3):`migration-guard.test.ts`(11)对四类落盘工件
  (`datasetRecord/traceEvent/report/event`)钉未来版本(v+1)/过期版本(v0)→ `parseVersioned` 抛 `SchemaVersionError`
  (含 kind + `v${SCHEMA_VERSION}` + 实际版本)、kind 错标、裸工件(无信封);回放日志 FUTURE 版本 → `validateReplayLog`
  抛 code `schema_version`。
- 全局门禁本轮复核(2026-08-21 openspec/changes 收尾):`npm run build` EXIT 0(web + server 双 tsc)·
  `npm run test:node` **304 通过 / 1 跳过(42 文件;跳过=无密钥的 DeepSeek 真机 smoke)** ·
  `npm run contract:node` **28 通过 / 0 失败** · `npx openspec validate 03 --strict` / `04 --strict` 均 valid。
