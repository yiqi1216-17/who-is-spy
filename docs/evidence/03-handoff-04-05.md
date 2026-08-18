# 03 §6.4 · 交接:面向 change 04 / 05 的共享接口与残余风险

> 记录日期:2026-08-19。本文冻结 change 03 对下游暴露的**共享事件/报告接口**,并列出
> **残余风险**,供 change 04(评测 E / 可观测+恢复 F / replay G)与 change 05(前端 H)据此实现。
> 所有 schema 见 `packages/server-node/server/schema.ts`(版本化信封 `{v,kind,data}`,`SCHEMA_VERSION=1`)。
> 独立架构/隐私评审见文末「§6.4-b」。

---

## A. 共享接口(已冻结,下游据此实现)

三类接口按"是否已接线"分:**已接线**(03 内已发射/可调用)、**已声明**(schema 已冻结、发射点留给下游)。

### A1. hook 观察缝 — 已接线(04-F 直播 trace / 05-H 直播叠加)

```
engine.registerRoundHook(name, fn: (p: HookPayload) => unknown, { timeoutMs? }): () => void
HookPayload = parseVersioned('hookPayload', ·) = {
  hook: 'onRoundPublished', round,
  public: { descriptions: [{playerId,text,round}], eliminations: [{text,round}] }
}                                                                  // 全 .strict()
```
- 发射点:`publishRound`(每回合公开时)。观察者收**深冻结克隆**、独立超时预算(默认 200ms)、
  失败隔离(单 hook 抛错/超时不波及其他与主流程),返回值一律忽略(观察者非裁决者)。
- secret-sentinel:投影经 strict schema 校验,夹带任何未登记字段(密词/身份/prompt)→ **整批拒绝**。
- 04/05 用法:注册观察者即得回合级公开事件流,无需触碰引擎内部;`HookEmitResult[]` 可直接喂 04 的 trace。

### A2. trace 事件 — 已声明(04-F 在模型/hook 边界发射)

```
traceEvent = {
  correlationId, round, ballot?,
  boundary: 'model.describe'|'model.vote'|'model.review'|'hook',
  playerId?, attempt, outcome: 'accepted'|'rejected'|'error',
  policyCode?, latencyMs?
}                                                                  // .strict(),无任何文本/密词字段
```
- **刻意脱敏**:schema 结构上没有 `text/word/reason/prompt` 字段——04-F 即便想记原文也无处可放。
- 与 03 现有机制 1:1 对齐:引擎的 `describeWithQualityGate` 已是**带 attempt 编号的有界重试**
  (`MAX_DESCRIBE_ATTEMPTS=3`),`quality-policy` 的判定码天然充当 `policyCode`(exact_leak /
  obfuscated_leak / too_similar / duplicate_self);失败走 `QualityExhaustedError`→`outcome:'rejected'`。
- 04-F 只需在模型/hook 边界发射 `envelope('traceEvent', …)`,**不得**借此拓宽 AgentContext(见 R1)。

### A3. 评测报告 — 已声明(04-E 批量评测写出)

```
report = { suite, milestone, sampleSize, metrics: [{ key, value, n }] }   // .strict()
```
- 04-E:一条命令跑多局 → 聚合成 `metrics` 表。`key` 为自由串,04 需**钉住一份 keyset**并遵守
  §4.4「权重只在训练/验证集拟合」纪律(见 R3)。里程碑阶梯 B0→B3 直接映射 `milestone`。

### A4. 私有信念只读缝 — 已接线(04-E 作结构化特征)

```
engine.getAgentBelief(gameId, agentId): Belief | undefined
Belief = { round, suspicions:[{playerId,score∈[0,1]}], selfExposure∈[0,1], evidenceRefs:[{playerId,round}] }
```
- **无自由文本字段**——可直接当评测特征(如校准:高怀疑目标是否命中真卧底)。
- 边界:**逐个 agent** 读。04-E 若聚合成全局表仅可用于**离线**打分,该表**绝不可回流**任何 AgentContext(见 R2)。

### A5. 确定性回放缝 — 已声明(04-G replay)

- 引擎在 `(model, rng)` 下确定:`new GameEngine(model, () => 0)` 逐字节复现;`FakeGameModel` 给"无模型"确定性。
- CH-4 原子性:被拒回合经 `withGame` 草稿**整体回滚**,replay 永不见半回合。
- `datasetRecord`(已声明,strict)承载脱敏对局(三来源 human/transfer/synthetic 显式分离)供 04-G/ C 阶段落盘与复放。

### A6. 失败信号 — 已接线(04-F 恢复层消费)

- `QualityExhaustedError(playerId, code, attempts)`(status 500):整回合原子终止信号,`code` 即 policyCode。
- `ModelError`:真实 API/传输失败。预算封顶范式见 `BudgetCappedModel`(`tools/play-real-game.ts`)——04-F 批量跑必须封顶防失控消耗。

### A7. 公开 DTO — 已接线(05-H 前端唯一可见面)

```
PublicGameState = { id, phase, round, ballot, players:[PublicPlayer],
  descriptions, votes, events, eligibleTargetIds, winner, review,
  human:{playerId,role,word}, model }
PublicPlayer = { id,name,avatar,isHuman,alive, revealedRole?, revealedWord? }
```
- `revealedRole/revealedWord` **终局前恒空**;`human` 块是观看者**自己**身份的唯一出处(他人 role/word 终局前不出现)。
- 05-H:按 `phase`(describing/voting/finished)+ `ballot`(>1 即平票复投)+ `eligibleTargetIds`(非投票期为 null)驱动 UI;
  终局渲染揭示 + `review`。**HTTP 契约冻结**(`contract/`),05 不得改响应形状,`contract:node` 守卫。

---

## B. 残余风险(下游必须承接)

| # | 风险 | 触发场景 | 04/05 应对 |
| --- | --- | --- | --- |
| R1 | trace 发射尚无落点 | 04-F 加日志时若图省事记原文 | 只走 `traceEvent` strict 信封(无 text 字段=结构安全);发射不得拓宽 AgentContext |
| R2 | 跨 agent 信念聚合 | 04-E 把各 agent 信念拼成全局表 | 仅离线打分用;加测试断言评测特征永不回流 model context(把 ② 从"社会约束"升为结构约束) |
| R3 | 报告 metric key 未冻结 | 04-E 自由加指标/在测试集调权 | 钉 keyset + 权重只在 train/val 拟合(§4.4);防指标操纵/split 泄漏 |
| R4 | 真机不可逐字节回放 | 04-G 想复放真实 DeepSeek 局 | 录 `datasetRecord`(含模型输出)再复放;批量跑强制预算封顶 |
| R5 | 人类在环时序 | 04-E 批量评测需无头人类 | 指标默认全 AI 自博弈;人类仅交互局 |
| R6 | 持久化边界 | C 阶段 / 04-G 落盘 | 仅写脱敏 `datasetRecord` + `PublicGameState`;私有信念 Map / 内部 GameState(role/word)/ `.env` **绝不序列化**;A3 迁移守卫(推迟)覆盖版本化落盘工件 |

---

## §6.4-b · 独立架构 / 隐私评审

> 已请两名**独立**评审(fresh context,对抗性,只读)分别审 change 03 的架构与隐私隔离,
> 指向真实源码而非本人叙述。两份评审**不约而同**收敛到 `generateVotes` 同一处缺陷——
> 该收敛缺陷已在 commit `02786df` 整改并加回归(`vote-authority.test.ts`);其余发现按下表分诊。

### 收敛缺陷(两份评审独立指到同一处)— 已整改

`game-engine.ts:generateVotes` 曾同时踩中隐私与授权两条线,故被两名评审各自独立命中:

| 维度 | 评审原判 | 根因 | 整改(02786df) |
| --- | --- | --- | --- |
| 隐私 ①×M | 隐私审计 [latent] | vote 第二参传完整 `Player[]`(挟带 role/word),机密靠适配器"自觉不读"兜底;哨兵扫描**只记录第一个参数**,此越界通道对既有测试隐形 | 引入 `VoteTarget` 投影,第二参**结构上**只含 `{id,name,isHuman,alive}`;新增回归断言键集恰好四字段、序列化无密词 |
| 授权 | 架构审计 [HIGH] | AI 的 targetId 合法性托付给模型;越界/自投/已出局 id 直达 `resolveBallot`——轻则污染计票,重则 `find(id)===undefined` 抛 500 腐坏状态 | 引擎重新裁决,非法回落确定性首选合法目标(与 human 投票同权);回归覆盖"不存在 id 不崩溃""自投不穿透" |

### 隐私审计 · 结论 `ISOLATED-WITH-RESIDUAL-RISK`

5(边界)×4(机密类别)矩阵**无确认的活跃泄漏**;唯一 latent 发现(①×M)已整改。其余为**残余风险**,
非当前泄漏,但下游若持久化/日志化会转为真实泄漏,已并入 B 表:

- **P1**(→ 已整改):`allowedTargets` 全 `Player` 越界 = 上表收敛缺陷。
- **P2**(→ R6):`PublicGameState.human` 终局前无条件携带**观看者自己**的活跃密词——当前安全(DTO 只回其所属 human,AI 永不经此拿 P),但一旦被持久化/日志化即泄漏;哨兵未守终局前 DTO 的自身密词。
- **P3**(→ R6):`getInternalGame` 返回**裸** `GameState`(含全员 role/word),仅供引擎内部/测试;任何外部消费者/落盘不得触碰。
- **P4**(→ 设计既定):终局 `review` 向外部模型发送全员 role+word——**终局后**发生,属规则揭示范畴,非泄漏;但 04-F 若把 review 入 trace 需走脱敏信封。
- **P5**(→ R4/R6):`play-real-game.ts` redactor 仅精确子串替换,漏未加引号/混淆变体的密词(出现在未过质量门的 vote reason / review 中);仅 demo 工具,批量评测落盘须改用结构化脱敏。

### 架构审计 · 结论 `SOUND-WITH-CAVEATS`

三层解耦(A 硬约束/B 版本化策略/C prompt=render)成立;CH-1/2/3 反转与 CH-4 原子性守住。发现按严重度分诊:

| 严重度 | 发现 | 分诊去向 |
| --- | --- | --- |
| HIGH | vote 授权托付模型 | **已整改**(见上) |
| HIGH | 版本化信封仅在 1/12 kind(hookPayload)强制,其余靠自觉 | 04-G:抽共享 `render/validate` 路径,把信封落到全部 kind(A3 迁移守卫) |
| MED | beliefs 在 `withGame` 草稿**之外**变更(:83-101,240,298),回滚时会与 GameState 脱同步 | 04-G:把 beliefs 纳入原子边界(04 一旦读 beliefs 即暴露)|
| MED | games/chains/beliefs 从不驱逐 → 评测批量跑内存泄漏 | 04-E:加 TTL/显式驱逐;无头自博弈前置 |
| MED | `model.ts` 重声明 describe/vote/review schema 且**无 .strict()**,与 schema.ts 分叉 | 04-G:统一到 schema.ts 单一真源 |
| MED | `withTimeout` 无法打断**同步** hook 体(hooks.ts:101-115) | 04-F:文档化"观察者须异步/自我让步",或加同步预算保护 |
| MED | replay 半接线:`randomUUID` 7 处 + `Date.now`(:184)未注入 | 04-G:注入 id/clock 工厂,补齐逐字节回放 |
| MED | 无无头全 AI 入口(createGame 硬编码 human 占 seat0 :151) | 04-E:加 headless 自博弈入口(评测前提) |
| MED | 无模型边界可观测 hook | 04-F:在 model.describe/vote/review 发射 traceEvent |
| LOW | human/AI 泄题检查不对称(:211 raw includes vs AI 走质量门 :346) | 04-F:文档化差异或对齐(human 无同质/自我重复门属设计取舍)|
| LOW | `schema.ts:71 review: z.unknown().nullable()` 严格性缺口 | 04-G:收紧为具体 review schema |
| LOW | hooks 提交前串行发射 | 观察者非热路径,暂记录不整改 |

**评审 Top-3 建议**(均已排入下游):① 修 vote 授权(**本次已做**);② beliefs 纳入原子边界 + 可注入 replay + 驱逐(04-G/E);③ 让信封真正生效——共享 render/validate 路径覆盖全 kind(04-G)。

> 分诊纪律:两条 HIGH 中的收敛缺陷当场整改并加回归(不留给下游);其余 MED/LOW 不在 03 内扩张范围
> (避免过度规划),而是**结构化交接**——每条都锚定到 04-E/F/G 的具体 task 或 B 表 R 行,可被 `openspec` 追踪。
