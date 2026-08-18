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
- ② 每个质量指标是怎么算的,阈值为什么定这个数:
- ③ 一条日志 / trace 里记了哪些字段,怎么保证不把密词和 Key 写进去:

## 4. 验证证据

> 贴命令 + 关键输出(注意别带上密钥或完整密词)。

- 契约(所选栈):`npm run contract:node` → **28 通过 / 0 失败**(FakeModel 路径)。见 `docs/evidence/B0-baseline.md`。
- 域测试 / 构建结果:`npm run test:node` → **6/6 通过**;`npm run build` → web(vite)+ server(tsc)**均通过**。B0 三绿。
- 批量评测脚本的输出(指标表):
- 故障注入 + 定位到具体一局 / 某一轮 / 某个 AI / 第几次尝试的示例:
- 用真实模型完整跑一局的记录:
