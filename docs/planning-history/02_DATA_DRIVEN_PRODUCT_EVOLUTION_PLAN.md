# 02 · 数据驱动的 Multi-Agent 产品与持续进化规划

> 状态：规划阶段，未修改业务代码  
> 适用项目：`/Users/mayiqi/Desktop/TEC/EfficientML/Fall/who-is-spy`  
> 与 `01_IMPLEMENTATION_PLAN.md` 的关系：本文是增量修订；两者冲突时，以本文为准  
> 总投入预算：24 小时  
> 核心方向：真人数据驱动 Agent、Hook + 状态机 + Schema、9:16 产品体验、可持续进化 Benchmark、精彩瞬间与双视角产品

## 1. 新的项目定位

本项目不再以“完成三个工程任务”为终点，而要做成一个可持续学习的社交推理产品原型：

> 从真实人类“谁是卧底”对局中学习表达、伪装、怀疑和投票模式；让 4 个 AI 形成独立、可观察、可进化的策略；用竖屏戏剧化体验把语言碰撞转化为用户愿意反复游玩和分享的内容。

最终演示不应只证明系统能跑通，而应证明：

1. Agent 的策略来源于真人行为数据，不是开发者随意编写的四段人设 Prompt。
2. 每个 Agent 有自己的私有状态、策略原型、证据与记忆，并受严格的信息边界保护。
3. 决策管线由显式状态机推进，关键扩展点通过类型化 Hook 接入，所有输入输出由 Schema 校验。
4. 新版本与原始 baseline 在同一真人基准上进行配对比较，结果可量化、可复现。
5. Benchmark 分为冻结核心集与滚动挑战集，支持 champion/challenger 持续进化，同时防止刷榜式过拟合。
6. 前端是完整的 9:16 社交推理产品体验，而不是后端状态的表单展示。
7. 系统能识别并呈现“精彩瞬间”，让每局不仅有胜负，还有可回忆、可分享的故事。
8. 同时提供人类玩家第一视角和 AI 对局观看模式，终局后解锁上帝视角复盘。

## 2. 数据调研结论

### 2.1 已确认的公开资源

| 资源 | 与本项目的关系 | 是否真人数据 | 计划用途 | 许可注意 |
| --- | --- | --- | --- | --- |
| [SpyGame](https://github.com/Skytliang/SpyGame) | 与“谁是卧底”规则高度一致，支持轮流描述、投票与 benchmark | 主要是 LLM 对局，不是核心真人训练集 | 参考评测维度、发言顺序与模型对局组织 | GPL-3.0；不复制其代码到本项目，避免许可污染 |
| [Werewolf Among Us](https://huggingface.co/datasets/bolinlai/Werewolf-Among-Us) | 真人社交推理语言、说服行为、票型 | 是；199 局、26,647 条 utterance 标注 | 学习质疑、证据、指控、防御、行动号召等通用策略；构建迁移 benchmark | Hugging Face 数据卡标注 Apache-2.0；使用时保留引用与许可证 |
| [WereBench](https://huggingface.co/datasets/n0nam4/WereBench) | 中文真人狼人杀策略判断与说服场景 | 是；698 条中文题目，含真实场景材料 | 中文策略 taxonomy、角色推断与反事实评测参考 | 当前数据卡未清晰显示许可证；未确认前只研究 schema，不把原始数据提交仓库 |
| [LLMafia](https://huggingface.co/datasets/niveck/LLMafia) | 人类与 LLM 混合 Mafia 完整对局 | 混合；21 局、2,558 条消息 | 研究人机混合对局、消息节奏和投票行为 | MIT；仍需保留来源与引用 |

相关研究给出的两个重要启示：

- `Werewolf Among Us` 将真人发言标注为身份声明、质询、证据、指控、防御和行动号召等说服策略，说明“风格差异”可以被建模为可标注的行为，而不只是人设形容词。
- 该研究发现适量对话上下文有助于策略识别，但上下文过长可能造成干扰。因此 AgentContext 不应无界增长，而应同时保留完整公开事实和经过 schema 化的近期证据窗口。

### 2.2 关键判断

当前没有找到一份许可清晰、规模足够、严格匹配本项目规则的中文真人“谁是卧底”公开语料。

因此不能声称“下载一个现成数据集就完成真人学习”。本项目必须采用两层数据体系：

1. **直接数据层**：自行采集严格匹配当前 5 人规则的真人“谁是卧底”对局，作为核心训练、验证与隐藏测试数据。
2. **迁移数据层**：使用有明确许可的人类狼人杀/Mafia 语料，学习质询、证据、指控、防御、联盟变化等跨游戏通用策略。

未经确认授权的综艺节目、直播、B 站视频或论坛对局不能直接抓取、转写并提交到仓库。可将其作为人工研究材料，但不得混入可发布数据集。

## 3. 第一方真人“谁是卧底”数据集

### 3.1 采集目标

24 小时版本不追求虚假的大规模数据，而追求一套真实、可追踪、可继续扩充的数据资产。

建议目标：

- 最低可交付：15 局完整真人对局。
- 推荐目标：30–50 局。
- 每局 5 名人类玩家，沿用当前词组、描述、投票、同票和终局规则。
- 每局保留逐轮描述、票型、公开理由、淘汰和胜负。
- 每局结束增加 30 秒问卷：最精彩发言、最可疑发言、最好笑/最意外时刻、是否愿意再玩。

如果无法在开发期内组织参与者，必须诚实标记该依赖：可以先完成采集器、schema 和外部迁移数据适配，但不能把合成数据冒充真人数据。

### 3.2 采集协议

每名参与者在开始前确认：

- 数据用于课程项目、模型评测和可能的产品研究。
- 玩家身份匿名化，不保存真实姓名、联系方式、语音声纹或设备信息。
- 文本可能作为脱敏样本随仓库发布；若不允许公开，则只用于本地训练/评测。
- 允许随时撤回，撤回后通过 consent ID 定位并删除对应数据。

采集工具必须生成 `consent_scope`，区分：

- `private_eval_only`
- `research_shareable`
- `commercial_training_allowed`

未经明确商业授权的数据不能被写成“可用于付费产品训练”。

### 3.3 数据 Schema

建立版本化的 `HumanGameRecordSchema`，至少包含：

```text
dataset_version
source_type                  # first_party / licensed_transfer
source_reference
license_or_consent_scope
consent_id
game_id
word_pair_id                 # 不直接暴露原始密词时可使用稳定 ID
player_id                    # 匿名 seat ID
seat
role
round
ballot
public_history_before_action
private_word                 # 仅受控训练数据，绝不进入公开 trace
utterance
vote_target
vote_reason
alive_before_action
game_result
timestamps
annotations
```

`annotations` 使用结构化标签：

- `speech_strategy`：感官描述、用途、类别、关系、类比、边界、反常识、回避、伪装、跟随、反共识。
- `social_act`：质询、证据、指控、防御、澄清、行动号召、联盟、转移目标。
- `specificity`：0–3。
- `leak_risk`：0–3。
- `novelty`：相对同轮既有发言的 0–3。
- `evidence_quality`：投票理由是否引用公开事实。
- `deception_success`：卧底描述是否成功融入。
- `moment_tags`：反转、自救、神预判、回旋镖、默契、爆笑比喻、关键一票。
- `human_rating`：自然度、趣味性、愿意继续玩、愿意分享。

### 3.4 数据质量控制

- 两名标注者独立标注重点样本；分歧样本仲裁。
- 记录标注指南版本和标注者匿名 ID。
- 抽样计算一致率，不把单人主观标签伪装成客观真值。
- 去除个人信息、辱骂和不适合展示的文本。
- 保留原始层、清洗层、标注层之间的数据 lineage。
- 任何自动标注必须带 `annotator_type=model` 和模型版本，不能混入人工标签而不注明。

### 3.5 防止数据泄漏的切分

禁止简单按 utterance 随机切分，因为同一局、同一词组会同时进入训练和测试。

采用三重隔离：

1. `game-group split`：同一局及同一批参与者不得跨 train/test。
2. `word-pair split`：隐藏测试包含训练期未出现的词组。
3. `temporal split`：后采集的一批对局作为滚动挑战集。

最终至少形成：

- `train`
- `validation`
- `core_test_frozen`
- `challenge_rolling`
- `human_preference_holdout`

## 4. AI 如何从真人数据学习

### 4.1 不采用“换四段 Prompt”作为核心方案

Prompt 仍然是模型调用接口的一部分，但策略来源必须是数据。采用以下数据驱动链路：

```text
真人对局
  -> 清洗与标注
  -> 行为策略聚类/原型提取
  -> 每个 Agent 绑定不同的人类策略分布
  -> 按当前局面检索真人示例
  -> 生成多个候选动作
  -> 人类分布校准的 scorer/ranker 选出动作
  -> DescriptionPolicy 安全门禁
  -> 更新该 Agent 的私有 belief state
```

### 4.2 人类策略原型

初始四个 Agent 的策略不再由开发者凭空定义，而由真人样本中高频且效果不同的行为簇生成。

候选原型示例：

- **低暴露观察者**：短描述、低 specificity、延迟形成强结论。
- **感官联想者**：高感官词和类比，较早产生直觉型怀疑。
- **证据分析者**：引用前序发言、比较一致性、投票理由证据密度高。
- **反共识扰动者**：高 novelty、低跟票率、主动寻找多数意见中的漏洞。

是否采用这四类，必须由数据分布和人工可解释性共同决定。如果真人数据形成不同簇，应更新 Agent 定义，而不是强行把数据塞进预设人设。

每个策略版本保存：

- 来源数据版本。
- 聚类/筛选方式。
- 代表样本 ID。
- 行为统计分布。
- 适用阶段。
- 已知失败模式。

### 4.3 检索增强式模仿

每次决策根据以下条件从真人训练集检索少量 demonstration：

- 当前身份阵营。
- 当前轮次和存活人数。
- 该 Agent 的策略原型。
- 已公开描述的行为标签。
- 是否被怀疑、是否处于同票或生死票。
- 候选样本必须来自训练集，不能来自冻结测试集。

示例中的原始密词需掩码或使用不同词组，避免把答案模式直接带入当前局面。检索结果通过 schema 限制为“公开发言 + 策略标签 + 结果”，不传入其他玩家秘密。

### 4.4 候选生成与人类分布校准

为了避免单次模型输出决定一切，每次描述可生成 2–3 个候选，由数据驱动 scorer 选择：

- 与该策略真人样本分布的距离。
- 与同轮公开发言的差异度。
- specificity/leak risk。
- 跨轮重复度。
- 自然度和长度分布。
- 是否符合当前私有 belief 和战术目标。

scorer 初版可以是可解释的统计模型或加权规则，权重来自真人训练/验证集，不应手调到测试集最好看。未来可替换为学习排序模型，而不改游戏引擎。

### 4.5 每个 Agent 的私有 Belief State

每个 Agent 独立维护结构化状态：

- 对其他存活玩家的怀疑概率。
- 支撑判断的公开 description/event ID。
- 上一轮与当前轮的概率变化。
- 自己已经使用的描述策略。
- 当前风险预算与战术阶段。

约束：

- 不保存自由文本思维链。
- 只能从该 Agent 的合法上下文更新。
- 不得读取其他 Agent belief。
- 不进入 PublicGameState。
- trace 只记录摘要和概率变化，不记录密词或完整私密输入。
- 使用概率输出时评测 Brier score/校准误差，不能只展示“猜对了”。

## 5. Hook、状态机与 Schema

### 5.1 服务端领域状态机

显式建模游戏状态：

```text
creating
  -> role_reveal
  -> describing
      -> collecting_human_description
      -> generating_agent_turns
      -> validating_descriptions
      -> committing_descriptions
  -> voting
      -> collecting_human_vote
      -> generating_agent_votes
      -> resolving_ballot
      -> revote | eliminating
  -> describing | finished
  -> reviewing
  -> finished
```

同时为每个模型决策建立子状态机：

```text
pending -> retrieving_examples -> generating -> validating
        -> accepted -> committed
        -> rejected -> retrying -> generating
        -> failed
```

状态迁移必须由确定性代码控制，模型只提交候选动作。

### 5.2 前端呈现状态机

前端动画不能依赖零散 boolean。建立 presentation machine：

```text
home
 -> matchmaking
 -> role_reveal
 -> round_intro
 -> agent_speaking
 -> human_describing
 -> voting_intro
 -> human_voting
 -> vote_reveal
 -> elimination
 -> next_round | finale
 -> highlights
 -> omniscient_replay
```

网络状态作为并行子状态：`online / reconnecting / stale / failed`。动画结束不能直接推进服务端规则，只能通知 UI 已完成呈现。

### 5.3 类型化 Hook

Hook 用于扩展评测、trace、精彩瞬间、动画事件和未来策略，而不是让插件任意修改 GameState。

建议 Hook：

- `beforeAgentContextBuild`
- `afterAgentContextBuild`
- `beforeExampleRetrieval`
- `afterExampleRetrieval`
- `beforeModelDecision`
- `afterModelDecision`
- `afterSchemaValidation`
- `afterDescriptionPolicy`
- `beforeStateCommit`
- `afterStateCommit`
- `onDecisionFailure`
- `onGameEventPublished`
- `onBeliefUpdated`
- `onHighlightCandidate`
- `onGameFinished`

每个 Hook 声明：

- 输入 Schema。
- 隐私级别：public / current-agent-private / server-secret。
- 是否允许修改结果。
- 超时预算。
- 失败策略：ignore / retry / abort。
- trace 字段白名单。

默认 Hook 只读；能修改候选动作的 Hook 仅限质量门禁和策略 ranker。任何 Hook 都不能绕过规则引擎直接淘汰玩家或决定胜负。

### 5.4 共享 Schema

前后端和 CLI 共享版本化 schema，建议建立轻量 `packages/shared`：

- `GameEventEnvelopeSchema`
- `PublicGameStateSchema`
- `AgentContextSchema`
- `AgentStrategySchema`
- `AgentBeliefSchema`
- `ModelDescriptionOutputSchema`
- `ModelVoteOutputSchema`
- `HumanGameRecordSchema`
- `DatasetManifestSchema`
- `EvalReportSchema`
- `TraceEventSchema`
- `HighlightMomentSchema`
- `DemoCommandSchema`

所有持久化数据包含 `schemaVersion`。读取旧数据时通过显式 migration 处理，不能静默忽略未知字段。

## 6. 可持续进化的 Benchmark

### 6.1 Baseline 梯度

不要只保留“改前/改后”两个版本。建立可解释的能力梯度：

- `B0`：原始项目，同一 Prompt、并发描述、无真人示例。
- `B1`：顺序编排，但仍无数据学习。
- `B2`：真人示例检索 + 基础策略原型。
- `B3`：真人检索 + 私有 belief + 候选 ranker。
- `B4`：当前 champion。
- `C-next`：待挑战的新策略或新模型。

每个版本在完全相同的 seed、词组、身份、座位顺序和人类输入上配对运行。

### 6.2 Benchmark 分层

1. **Contract Gate**：HTTP、裁决、信息隔离，不允许回退。
2. **Core Frozen**：固定真人场景、从不进入训练，衡量版本回归。
3. **Transfer**：狼人杀/Mafia 的质询、证据、欺骗与说服场景。
4. **Adversarial**：泄词、拆字、复述、跟票、循环怀疑、坏 JSON、超时。
5. **Unseen Words**：训练未出现的词对，检查是否只记住词组。
6. **Human Preference**：真人盲选两版输出，判断更自然、更有趣、更像不同的人。
7. **Product Playtest**：完整真人试玩，统计完成、重开、分享和愿付费信号。

### 6.3 指标

安全与正确性：

- accepted leak rate。
- description policy block precision/recall。
- valid vote rate。
- completion rate。
- information non-interference。
- failed-action atomicity。

Agent 能力：

- 后发 Agent 对前序公开信息的引用率。
- 策略可辨识度。
- 描述 novelty 与 pairwise similarity。
- 怀疑概率 Brier score 与 calibration error。
- 投票与 belief 的一致率。
- 卧底融入率与平民识别率。
- 角色/座位公平性。

真人对齐：

- 真人策略分布距离。
- 盲测 human-likeness preference。
- 投票理由证据密度。
- 过度解释率、模板化率和无效空话率。

产品与乐趣：

- highlight moments/game。
- “愿意再玩一局”比例。
- 单局完成率。
- rematch rate。
- 分享精彩瞬间率。
- 对 Agent 的角色记忆率和偏好。
- 愿付费意向及可接受价格区间（只作为探索信号）。

工程指标：

- p50/p95 决策和整轮延迟。
- tokens/game 与 cost/game。
- retry rate。
- 各错误类型数量。
- trace/replay 脱敏扫描结果。

### 6.4 Champion/Challenger 进化机制

新版本只有同时满足以下条件才能成为 champion：

1. 所有 contract 与隐私硬门禁通过。
2. Core Frozen 无关键回退。
3. 至少一个主要能力指标显著优于当前 champion。
4. 成本和 p95 延迟没有突破预算上限。
5. Human Preference 不劣于 champion，并达到预设最小样本量。

线上或试玩中发现的新失败样本先进入 `quarantine`：

- 去标识化。
- 人工确认是否为真实失败。
- 归类并添加到下一版 rolling challenge。
- 当前模型可针对其改进，但该样本不能立刻进入 frozen test。
- 定期冻结一批新挑战集，升级 evaluatorVersion。

这样形成：

```text
真人对局/线上失败
 -> quarantine
 -> 标注与归因
 -> challenge set
 -> challenger 改进
 -> paired evaluation
 -> champion promotion
 -> 新真人对局
```

## 7. 9:16 竖屏产品体验

### 7.1 产品视觉原则

- 以 390×844 或相近 9:16 viewport 为设计基准，桌面端居中呈现手机舞台。
- 保留现有水墨/纸张气质，但提升为“东方悬疑桌游剧场”，避免通用聊天机器人界面。
- 画面中心永远表达当前戏剧焦点：谁在说话、谁被怀疑、票投向哪里、谁被淘汰。
- UI 中的模型、trace、token 等工程信息不进入普通玩家视图。
- 所有动画支持 `prefers-reduced-motion`，重要信息不能只靠颜色或动画表达。

### 7.2 页面结构

竖屏固定三层：

1. **顶部局势栏**：轮次、阶段、存活人数、倒计时、模式。
2. **中央角色舞台**：五个座位、主发言角色、表情、怀疑关系与票线动画。
3. **底部行动抽屉**：描述输入、投票、继续、查看公开记录。

公开历史不是长聊天列表，而是按轮次组织的“证词卡”：

- 发言角色。
- 一句话描述。
- 是否被他人引用/质疑。
- 当前轮高光标记。

### 7.3 Agent 形象设计

四个 Agent 需要稳定的角色圣经，而不只是圆形头像：

| Agent | 视觉关键词 | 主色 | 动作语言 | 数据驱动人格表现 |
| --- | --- | --- | --- | --- |
| 阿序 | 折扇、细框镜、克制 | 靛青 | 观察、停顿、轻点桌面 | 低暴露观察型 |
| 弥生 | 流苏、灵动眼神、感官符号 | 绛红 | 快速抬眼、捕捉异常 | 感官联想型 |
| 老墨 | 墨迹、卷轴、棋子 | 墨黑/金 | 排列证据、连线推理 | 证据分析型 |
| 小满 | 不对称饰品、纸鹤、跳色 | 青绿/橙 | 突然转身、打破队形 | 反共识扰动型 |

角色形象应由后续专门的视觉资产任务生成，确保统一画风、透明背景、站立/发言/怀疑/淘汰四套状态。不可直接使用调研截图或受版权保护的游戏素材。

### 7.4 完整游玩流程

1. 首页：选择第一视角/AI 剧场、词包和难度。
2. 入局：五个角色依次入座，模型健康检查在幕后完成。
3. 私密揭词：仅人类第一视角看到自己的身份和词；长按揭示，松手隐藏。
4. 轮次开场：镜头扫过存活角色，公布发言顺序。
5. 描述：AI 逐个发言；字幕、微表情和公开证词卡同步出现。
6. 人类行动：描述输入提供长度/泄词提示，但不替用户生成答案。
7. 投票：角色头像进入投票阵列，选择后锁定。
8. 开票：票线逐条飞向目标，最后一票前短暂停顿制造悬念。
9. 淘汰：执行死亡/退场特效，身份仍不提前公开。
10. 下一轮：座位留空、关系和历史延续。
11. 终局：翻牌、阵营揭示、胜负动画。
12. 精彩瞬间：3–5 张可回看的戏剧卡。
13. 上帝视角复盘：展示每个 Agent 怀疑曲线、关键证据和转折。

### 7.5 淘汰与死亡特效

淘汰动画分阶段执行：

```text
vote_lock
 -> silence
 -> accusation_focus
 -> vote_lines_converge
 -> verdict_stamp
 -> character_exit
 -> empty_seat
 -> next_state
```

视觉方案建议“墨迹封印 + 纸偶碎裂/化灰”，与现有东方纸张视觉一致，避免血腥表达：

- 全场降噪、背景变暗。
- 被投角色放大，其他头像虚化。
- 票线汇聚，朱砂“出局”印章落下。
- 角色纸片从边缘墨化、碎裂或化为灰白剪影。
- 座位留下姓名牌和本轮票数。
- 终局前不显示其真实身份。

需要普通、同票加赛、卧底终局、平民误杀四种节奏变体。

### 7.6 命令行驱动动画

建立 dev-only `demo-cli`，通过与正式事件相同的 `GameEventEnvelopeSchema` 驱动前端：

```text
npm run demo:scene -- role-reveal
npm run demo:scene -- agent-speak ai-2
npm run demo:scene -- vote-reveal ai-3
npm run demo:scene -- eliminate ai-3
npm run demo:scene -- finale civilian
npm run demo:game -- fixtures/demo-game.json
```

原则：

- CLI 只能在 development/test 启用。
- CLI 注入的是“展示事件”或 fixture game，不得在 production 直接篡改服务端权威状态。
- 正式游戏中的动画仍由真实领域事件触发。
- CLI 与真实服务端复用同一 schema，确保演示效果不是另一套假逻辑。
- 可逐帧暂停、快进和重放，方便调试死亡特效与现场展示。

## 8. 精彩瞬间系统

### 8.1 为什么必须做

“谁是卧底”的长期价值不只是输赢，而是：

- 一句话突然让全场改票。
- 卧底用模糊但巧妙的描述混过一轮。
- 某人坚定怀疑正确目标，却被全员忽略。
- 前一轮的普通发言在终局成为回旋镖。
- 一个意外比喻既好笑又不泄题。

这些片段决定用户是否记住角色、愿意再开一局、愿意分享。

### 8.2 Moment Detector

通过 Hook 消费公开事件与脱敏 belief delta，生成候选精彩瞬间：

- `consensus_flip`：多数怀疑目标发生显著切换。
- `successful_self_save`：被集中怀疑者成功转移票型并存活。
- `spy_blend_in`：卧底低怀疑度通过一轮。
- `lone_correct_read`：唯一正确判断者未被采纳。
- `decisive_vote`：最后一票改变淘汰结果。
- `callback`：后续判断引用早期发言并得到验证。
- `unexpected_metaphor`：高 novelty 且真人趣味评分高。
- `policy_save`：系统成功拦下泄题并生成更好的替代描述，仅进入开发者复盘。

精彩瞬间选择使用确定性信号初筛，终局模型只负责基于原始事件生成短标题，不能虚构没有发生的剧情。

### 8.3 高光卡

每局终局生成 3–5 张竖屏卡：

- 标题。
- 涉及角色。
- 原始公开发言引用。
- 前后票型或怀疑变化。
- 为什么重要。
- `spoiler` 标记。
- 可回跳到 replay 时间点。

分享卡默认不显示完整密词和其他敏感信息；用户主动开启 spoiler 后才展示终局真相。

## 9. 第一视角与上帝视角产品决策

结论：两个都做，但职责不同。

### 9.1 人类玩家第一视角：主产品

这是默认入口，也是最有付费潜力的模式：

- 1 名人类 + 4 个 AI。
- 人类只知道自己的身份、词和公开历史。
- 不能查看 Agent belief、其他词或后台 trace。
- 角色通过长期稳定行为形成陪伴感和对手感。
- 支持词包、难度、角色组合和赛季挑战。

第一视角提供“我参与了这场推理”的主体性，是留存核心。

### 9.2 AI 剧场/公开观战：内容模式

- 5 个 AI 自动对局，观众实时只看公共信息。
- 可预测谁是卧底、押注最可疑玩家或选择支持角色，但不影响裁决。
- 适合低操作观看、直播、短视频和分享。
- 终局后生成精彩瞬间与角色表现评分。

### 9.3 上帝视角：终局复盘与研究工具

- 默认只在终局后解锁。
- 展示真实身份、每个 Agent 私有怀疑曲线、证据引用与策略变化。
- 不展示自由文本思维链、完整私密 prompt 或 API 原始请求。
- 开发模式可额外显示 trace、成本和错误；普通用户不看工程信息。

最合理的产品漏斗：

```text
第一视角参与 / AI 剧场观看
 -> 终局揭晓
 -> 精彩瞬间
 -> 上帝视角复盘
 -> 再来一局 / 换词包 / 分享
```

## 10. 可付费产品假设

本次不需要实现支付，但需要验证用户为什么愿意付费。

可能的价值点：

- 高质量主题词包：影视、职场、校园、情侣、地域文化、专业领域。
- Agent 角色包：不同视觉、声音、行为策略和关系设定。
- 私人房间：自定义词组、局数和难度。
- AI 剧场赛季：角色积分、连续剧情、冠军榜。
- 高级复盘：个人判断校准、关键失误、风格画像。
- 创作者模式：一键生成竖屏精彩片段和带字幕高光卡。
- 语音模式：后续将真人或 Agent TTS 加入角色演出。

24 小时版本只验证三个问题：

1. 用户是否愿意完整玩完并立即重开。
2. 用户是否记得并偏爱某个 Agent。
3. 用户是否愿意分享某个精彩瞬间。

## 11. 24 小时执行顺序

### 0–2 小时：基线冻结与数据准备

- 初始化 Git 与 baseline commit。
- 跑通 build、Node tests、contract 和真实模型冒烟。
- 保存 B0 对局与指标。
- 建立数据许可/consent 清单和 DatasetManifestSchema。

### 2–5 小时：真人数据最小闭环

- 完成真人对局采集格式、导入器和匿名化器。
- 导入许可明确的迁移样本。
- 采集首批直接真人“谁是卧底”局，或明确记录参与者依赖。
- 建立标注指南与小规模双人标注。

### 5–10 小时：数据驱动 Agent 核心

- 策略原型、真人示例检索、候选生成/ranker。
- 私有 belief state。
- 顺序发言编排。
- 描述泄题/雷同门禁。
- non-interference 与原子性测试。

### 10–14 小时：状态机、Hook 与 Schema

- 服务端决策状态机。
- 前端 presentation machine。
- 类型化 Hook registry。
- shared schema 与事件流。
- trace、故障注入和 replay 对接 Hook。

### 14–19 小时：竖屏产品与角色演出

- 9:16 主舞台、证词卡、投票和终局。
- 四个 Agent 视觉状态接入。
- 淘汰动画和同票变体。
- dev-only demo CLI 与事件流。
- reduced-motion 与小屏验证。

### 19–21 小时：Benchmark 与持续进化

- B0–B3 配对运行。
- Core Frozen、Adversarial、Unseen Words 和 Human Preference 报告。
- champion/challenger gate。
- 成本与延迟预算。

### 21–22.5 小时：精彩瞬间与双视角

- Moment Detector。
- 高光卡与回跳 replay。
- 第一视角、公开观战、终局上帝视角权限切换。

### 22.5–24 小时：验收、文档与现场演示

- 全量 CI、contract、benchmark、故障与隐私扫描。
- README、DECISIONS、数据卡和已知问题。
- 从干净 clone 重跑。
- 演练一键 demo 和真实模型完整对局。

若真人参与者组织时间无法与开发并行，直接真人数据采集必须尽早启动，不能留到最后两小时。

## 12. 最终证据包

仓库最终应包含：

- 数据卡：来源、许可、consent、统计、偏差、切分、限制。
- 只含可发布样本的小型第一方数据集；受限数据不提交。
- `B0 vs B1 vs B2 vs B3` 配对评测表。
- 真人偏好盲测结果与原始匿名票。
- non-interference 测试。
- 故障前后状态一致性测试。
- trace/replay 敏感哨兵扫描。
- 命令行驱动的角色发言、投票、淘汰、终局演示。
- 竖屏首页、第一视角、投票、死亡特效、精彩瞬间、上帝视角截图或录屏。
- 真实 DeepSeek 完整一局证据。
- 清晰的 git log 和真实的 Coding Agent 人工纠错记录。

## 13. 主要风险与控制

- **真人数据数量不足**：优先保证直接规则匹配、许可、schema 和切分正确；绝不以合成数据冒充真人样本。
- **迁移数据规则不同**：只迁移质询、证据、欺骗和说服 taxonomy，不直接把狼人杀角色逻辑塞入“谁是卧底”。
- **Prompt 仍占主导**：用数据检索、策略原型、候选 ranker 和 B0/B2 消融证明数据组件的实际贡献。
- **Benchmark 被训练污染**：冻结测试集、词组隔离、参与者隔离、版本化 manifest。
- **Agent 人格变成刻板模板**：策略是概率分布而非固定口头禅，持续监控模板化率。
- **顺序生成延迟高**：量化整轮 p95；动画和发言节奏掩盖合理等待，但不伪造完成结果。
- **前端特效破坏状态一致性**：动画消费领域事件，不能反向决定游戏规则。
- **CLI 形成后门**：严格限制 dev/test，production 构建禁用。
- **上帝视角泄密**：实时观战仍只看公开事实，私密信息仅终局后授权展示。
- **精彩瞬间被模型编造**：确定性事件检测选片，模型只写标题，并引用公开原文。
- **数据商业权利不清**：按 consent_scope 过滤；许可未知的数据不进入商业训练或仓库。
- **24 小时范围过大**：数据驱动 Agent、第一视角主流程、评测证据优先；语音、支付、多人联网和完整赛季系统留作后续。

## 14. 对 `01_IMPLEMENTATION_PLAN.md` 的明确修订

以下内容被本文替换或提升：

1. 四种 Agent 策略不再主要由人工 Prompt 定义，改为真人数据策略原型 + 检索 + ranker。
2. 新增第一方真人数据集、许可/consent、数据 lineage 和严格切分。
3. 新增每个 Agent 的结构化私有 belief state。
4. 评测必须从 B0 baseline 开始，形成 B0–B3 消融和 champion/challenger，而不是只跑最终版本。
5. 任务线③通过类型化 Hook 接入，而不是 trace/recovery 与引擎紧耦合。
6. 前端从伸展项提升为正式交付，采用 9:16 产品舞台和命令行事件驱动的死亡特效。
7. 新增精彩瞬间系统、第一视角、AI 剧场和终局上帝视角。
8. 产品验收新增重开、角色偏好和分享意愿，不再只看功能完成率。

## 15. 最终项目主张

最终交付可以用一句话概括：

> 这不是四个带不同人设 Prompt 的聊天机器人，而是一组从真人社交推理数据中学习、拥有独立私有信念、通过显式状态机协作、接受持续 Benchmark 挑战，并能共同演出一场值得人类参与和回看的竖屏推理剧场的 Agent。
