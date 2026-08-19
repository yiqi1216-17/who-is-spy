# 05.4 · Portrait Product Experience Tasks

> This change consumes changes 03 and 04. Every task ends with a deterministic scene fixture, interaction/E2E assertion, accessibility check, privacy proof, or approved visual artifact.

## 1. Define the presentation contract

- [ ] 1.1 Write projection tests for first-person, live AI theater, and terminal omniscient replay before adding any new client payload. — **部分**:first-person 投影有 fixture 级隐私断言(`scenes.test.ts` 终局前不揭示/终局全揭示),终局全知走独立 `/api/god-games` 端点(隔离靠端点而非相位门禁,`god-director.test.ts` 11 例);「实时公开观战」的投影证明在**服务端**(SSE `theater-privacy.test.ts` 配对证明,任务 5.1 已勾),前端独立 theater 视图未建(现为 human/god 双模式)。
- [x] 1.2 Write presentation transition and idempotency fixtures for home, role reveal, round intro, speaking, human action, voting, tie, elimination, finale, highlights, replay, failure, and reconnect. — `presentation/machine.ts` 十相位 + 网络轴全定义;`machine.test.ts` 13 例(整轮合法路径/幂等/乱序/平票复投/网络正交)+ `scenes.ts` 十场景 fixture + `scenes.test.ts` 13 例。13 个点名状态全部命中,无缺口(独立盘点确认)。
- [ ] 1.3 Define 9:16 tokens, safe areas, typography, contrast, focus, motion, reduced-motion, and responsive acceptance targets. — **部分**:9:16/安全区/clamp 排版/焦点(`:focus-visible` 金描边)/动效/reduced-motion/480px 断点令牌俱在且被 `viewport.test.ts` 钉住;**缺**成文的对比度数值目标(≥4.5:1)与 tap-target(≥44px)验收线——现 `.send-btn` 44px 达标但 `.icon-btn` 34px 未达,须先定标再改,不伪勾。

## 2. Build the portrait stage and characters

- [ ] 2.1 Build the centered responsive five-seat stage and prove 390×844, narrow mobile, and desktop layouts have no horizontal overflow or unreachable action. — **部分**:舞台实现齐(9:16 居中 452px 上限/移动全出血/五席弧形布点/`overflow-x:hidden`),`viewport.test.ts` 三档视口钉住 CSS 契约;**缺**真浏览器渲染测量(无横向溢出/可达性的像素级证明需 Playwright,本机无浏览器驱动)。契约层已证,渲染层留现场。
- [ ] 2.2 Create a rights-documented character bible mapping each evidence-derived Agent to stable portrait, palette, silhouette, motion rhythm, accessible name, and state variants. — **部分**:圣经本体在 `characters.ts`(id/name/sigil/tagline/palette/axes/portrait 由实测策略轴派生)+ 原创 SVG 立绘 `art/portraits.tsx`(权利天然干净,`manifest.json` 如实记录 ARK 文生图六条 failed 的降级);**缺** motion-rhythm 字段、逐角色权利清单成文、`characters.ts` 专属测试。
- [ ] 2.3 Implement active, speaking, suspicious, waiting, eliminated, and finale character states without exposing hidden strategy or role information. — **部分**:四态已实现(idle/speaking/suspect/eliminated,`PortraitState` + `director.ts::seatState`),隐私边界干净(`Seat.tsx` 只收公开 `Character` 型,结构上拿不到 role/word);**缺** active 与 finale 两个独立态(现终局复用 suspect)。

## 3. Complete first-person gameplay

- [ ] 3.1 Implement intentional private role/word reveal and concealment with focus, keyboard, screen-reader, and accidental-exposure tests. — **部分**:私密信笺翻卡已实现(`RevealScreen.tsx`,`aria-label` + 确认按钮闸),数据面只用 `game.human` 自己的 role/word;**缺**「再次隐藏」交互、焦点管理、`aria-live` 播报,且组件级测试需 DOM 环境(vitest 现为纯 node、不收集 .tsx)。意外暴露的**数据面**证明已由 fixture 断言覆盖(终局前公开态无他人 role/word)。
- [x] 3.2 Complete round intro, sequential testimony, human description, vote selection, ballot reveal, tie/revote, elimination, finale, and rematch against fixture events. — 全链路实现 + 测试:轮次横幅/顺序证词(`director.ts` 线性化)/人类描述与投票 Dock/计票逐张揭示/平票复投(`machine.ts` voting 留驻)/出局聚焦/终局(`FinaleScreen`)/rematch(`RESET` 保网络轴)。`director.test.ts` 12 例 + `machine.test.ts` 13 例对 fixture 事件断言,无缺口(独立盘点确认)。
- [ ] 3.3 Add non-graphic Agent-specific elimination effects driven only by authoritative event IDs; prove duplicate events and animation completion cannot advance domain state. — **部分**:事件驱动与幂等**已证**(`BALLOT_DONE`/`CONTINUE` 带 eventId 去重,`machine.test.ts`「重复出局事件不二次推进」;动画完成信号在类型上只发呈现事件、结构上无从裁定域结果);非血腥淘汰效果已有(灰度+面纱);**缺** per-Agent 差异化效果(现为全员统一处理)。
- [ ] 3.4 Add loading, retry, provider failure, reconnect, stale-event, and state-reconciliation experiences without displaying private trace payloads. — **部分**:六项体验均已实现(loading/重试/失败 `role=alertdialog`/重连 `role=status`/SSE 去重缺号→`needsResync`→`resyncFrom` 权威对账),流层 `stream.test.ts` 17 例;**缺**「错误文案不含私有 trace 载荷」的专属断言(现 `error.message` 直传——服务端错误映射本就不含密词/Key,但前端缺一道脱敏函数与测试钉住)。

## 4. Connect authoritative events and CLI scenes

- [x] 4.1 Add versioned SSE consumption with monotonic IDs, deduplication, resume, and authoritative state-refresh fallback while retaining existing HTTP commands.
- [x] 4.2 Build the development CLI scene driver for role reveal, speech, vote, tie, elimination, failure, reconnect, finale, highlight, and replay using production schemas. — `scenes/scenes.ts` 用生产类型(`PublicGameState`/`PublicPlayer`/`GameEvent`/`Vote`/`HighlightReel`)构造十份确定性快照,`tsc` 即 schema 校验;`scenes/harness.tsx` 经 `?scene=` 渲染,复用真实 `RevealScreen`(`onDone`)/`FinaleScreen`(`onRestart`),`failure`/`reconnect` 由真实表现层状态机 `run([NET_LOST|NET_RETRYING])` + `overlay()` 派生(网络轴与剧场相位正交,非复刻)。证据 `docs/evidence/05-4-scene-driver.md`。
- [x] 4.3 Prove production builds reject or omit CLI/fault controls and that fixture scenes cannot mutate a production game. — 三层保险:**结构**(scenes.ts/harness.tsx 从不 import `../api`、无 `api.` 调用,`scenes.test.ts` 读源码断言 → 无写命令可触发)· **构建**(`main.tsx` 以 `import.meta.env.DEV && ?scene` 守卫动态 import;生产 DCE 消除,产物无 `harness-*.js` 分块,12 个 scenes 独占串在 `dist/` 检索 `leaked=0`)· **运行时**(`SceneHarness` 入口 `!import.meta.env.DEV` 即抛错)。假阳性已澄清:`阿序`/`身份揭晓` 等命中来自生产 `characters.ts`/`portraits.tsx`/`FinaleScreen.tsx`,故证明须用独占串。
- [x] 4.4 Capture the critical portrait scene matrix as screenshots or video and run mobile viewport E2E checks for safe areas, input reachability, motion, and reconnect continuity. — 可自动化半面全绿(`viewport.test.ts` 17 例,三档视口 390×844/320×568/1440×900):安全区四向 `env()` 兜底且被 `.app-frame`/`.screen` 真实消费、`overflow-x:hidden` + 480px 全出血 vs 桌面 9:16 居中、`prefers-reduced-motion` 全局归零、输入闸(human-action 且 live)与重连连续性(叠层与 phase 正交 / `NET_OK` 回原相位 / 权威事件按 eventId 幂等)经真实 `machine.ts` 断言。**诚实边界**:像素截图/录屏与真浏览器 E2E 因本机无浏览器驱动(playwright 缓存空、联网超时)未做,场景矩阵可由 `?scene=` 十场景现场实拍;此为 CSS/状态机契约层证明,非渲染测量。

## 5. Add view modes and replay value

- [x] 5.1 Implement live AI theater with public events only and paired tests proving roles, words, beliefs, private prompts, and unpublished votes cannot affect its pre-finale projection.
- [x] 5.2 Unlock terminal roles, words, structured belief evolution, and evidence links only after authoritative terminal reveal; never expose free-text chain-of-thought.
- [x] 5.3 Add fixture-backed detectors for consensus flips, self-saves, undercover blending, lone correct reads, decisive votes, callbacks, and novel safe metaphors.
- [x] 5.4 Rank a bounded diverse moment reel and add spoiler-safe cards; generated titles must cite event IDs and pass quote/action/outcome faithfulness checks.
- [x] 5.5 Add consented, de-identified completion, rematch, favorite Agent, favorite moment, share, replay-intent, and playtest-preference feedback with a complete opt-out path.

## 6. Verify product completeness

- [ ] 6.1 Run the entire first-person critical path, a live AI-theater game, and terminal omniscient replay at target portrait viewports with reduced-motion and keyboard variants. — **留现场**:需真机浏览器全程走查(reduced-motion/键盘变体);逻辑层等价物已绿(director/machine/god-director 全链路测试 + `?scene=` 十场景可现场逐屏演示)。
- [ ] 6.2 Run build, web tests, E2E, Node contract, privacy projections, strict OpenSpec validation, and a real-event smoke game; preserve redacted visual evidence. — **除 E2E/视觉证据外全绿**(2026-08-19):`npm run build` EXIT 0 · web vitest 89/89 · `test:node` 280/280(含隐私投影/哨兵)· `contract:node` 28/0 · `openspec validate 05 --strict` ✓ · 真机 smoke 已于 03 §6.3 通过并留脱敏 transcript。E2E 与截图证据因无浏览器驱动留现场实拍。
- [ ] 6.3 Conduct a short blinded product playtest comparing B0 UI and the portrait path for clarity, fun, replay intent, and share intent; report sample limits honestly. — **留现场**:需真人样本;采集面已备好(任务 5.5 知情去标识反馈通道 + playtest 偏好三选项)。
- [ ] 6.4 Request independent product, accessibility, and privacy review; address findings with fixtures and record residual risks before archive. — **部分**:独立盘点评审已做一轮(fresh-context 只读盘查 §1–§3 十项,结论以现状注记回填本清单);无障碍/产品向深评与归档前残余风险清点留交付终批。
