# 03 §6 · 变更证明证据(配对消融 + 哨兵越界)

> 记录日期:2026-08-18。栈:Node(`packages/server-node`),Go 侧不改动。
> 本文汇总 OpenSpec 03 §6.1(配对消融)与 §6.2(哨兵越界)两项确定性证明,
> 供现场投屏对照。所有数字由 `ablation.test.ts` / `sentinel-sweep.test.ts` 确定性产出。

## §6.1 配对消融表(同 scenario + 同 seed)

同一固定局面(第 1 轮,human/ai-1/ai-2 已公开描述)、同一确定性种子下,对三条改造轴
对照 baseline(病)与 improved(愈),度量各自的可观测量:

| 轴 | 度量 | baseline(病) | improved(愈) | 反转对应 |
| --- | --- | --- | --- | --- |
| A 顺序编排 | 后发者可见的"本轮先发公开描述"条数 | **0** | **3** | CH-1 · §5.3 |
| B 人设策略 | 四 AI 的可区分人设数 | **1** | **4** | CH-2 · §4 |
| C 信念校准 | 离群者与随大流者的怀疑度差 | **0** | **>0** | §5.1 |

- 轴A:baseline 用并行快照(每个 Agent 只见开局),improved 用座次串行(经允许列投影,
  只多看到"公开描述",仍看不到他人 role/word)。
- 轴B:baseline 用中性空策略(无策略通道),improved 用 `strategyForAgent` 的版本化原型;
  人设可区分但投影已剥离全部溯源元数据(见 §6.2)。
- 轴C:baseline 无 `observeRound`(信念恒空,无校准信号),improved 由离群度→怀疑度 EMA 校准。

证据:`packages/server-node/server/ablation.test.ts`(3 用例,3 轴各一)。

## §6.2 哨兵 × 边界 矩阵(全局收口)

跑一整局确定性对局到终局,捕获三类跨界工件(model 上下文 / hook 投影 / 各阶段公开 DTO),
对五类哨兵逐一断言"绝不越界"。持久化边界以"可导出的公开 DTO"为代表。

| 哨兵 ＼ 边界 | model 上下文 | hook 投影 | 公开 DTO(终局前) | 持久化(公开 DTO) |
| --- | --- | --- | --- | --- |
| ① 他人 role/word | 拦截 ✓ | 拦截 ✓ | 拦截 ✓(不揭示) | 拦截 ✓ |
| ② 跨 Agent 信念 | 拦截 ✓ | 拦截 ✓ | 拦截 ✓ | 拦截 ✓ |
| ③ 完整内部状态 | 拦截 ✓ | 拦截 ✓ | 拦截 ✓ | 拦截 ✓ |
| ④ 私有 prompt/溯源 | 拦截 ✓ | 拦截 ✓ | 拦截 ✓ | 拦截 ✓ |
| ⑤ 未结算票 | 拦截 ✓ | 拦截 ✓ | —(结算后才公开) | — |

- 种子 `() => 0`:human=卧底(卡布奇诺),ai-1..4=平民(拿铁)。故"卡布奇诺""undercover"
  绝不出现在任一 AI 的 model 上下文;hook 投影里词与角色一律不出现。
- ② 信念在引擎私有存储确实存在(`getAgentBelief('ai-1')` 有值),但 `suspicions/selfExposure/
  evidenceRefs` 标记不出现在任何边界工件。
- ③ model 上下文顶层键恒为允许列三键 `{game, identity, strategy}`;内部独有字段 `createdAt` 不越界。
- 揭示点被推迟到终局:终局前所有 `revealedRole/revealedWord` 为空,终局才全部揭示。

证据:`packages/server-node/server/sentinel-sweep.test.ts`(7 用例)。

## 门禁(本次 §6 提交时)

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `npm run build`(server,`tsc --noEmit`) | ✅ 通过 |
| 域测试 | `npm run test:node` | ✅ 17 文件 / 78 用例通过 |
| 语言无关契约 | `npm run contract:node` | ✅ 28 通过 / 0 失败 |
| 规格校验 | `openspec validate 03 --strict` | ✅ valid |

## 尚未覆盖(诚实边界)

- §6.3 的**预算封顶 DeepSeek smoke 局**harness 已落地(`smoke.deepseek.test.ts`,MAX_MODEL_CALLS=24
  防失控消耗),依赖真实 `DEEPSEEK_API_KEY`;未配置时按 `isConfigured()` 优雅跳过(本次 1 skipped),
  密钥就绪后自动生效并补录脱敏证据。要现场跑:提示符输入 `! echo 'DEEPSEEK_API_KEY=...' >> packages/server-node/.env`。
- §6.1 中"人类检索/原型分布"的真实语料部分属 C 阶段(§3–§4 后半),此处以合成原型形态对照。
