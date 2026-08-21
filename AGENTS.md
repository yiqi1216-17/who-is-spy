# 07 · Project Agent Contract

## Authority

Read `CANDIDATE_TASK.md` and `contract/CONTRACT.md` before changing behavior. Treat the selected numbered OpenSpec change under `openspec/changes/` as the source of truth for new work. The numbered documents under `docs/planning-history/` are rationale, not executable requirements.

## Required workflow

1. For ambiguous product or architecture work, use OpenSpec explore and Superpowers brainstorming before creating artifacts.
2. Create or update an OpenSpec proposal, capability specs, design, and tasks before implementation.
3. Do not write implementation code until the relevant OpenSpec tasks are ready and the user has authorized implementation.
4. Respect the delivery dependency order: `03-human-data-and-agent-orchestration` → `04-evaluation-and-recovery` → `05-portrait-product-experience`.
5. During implementation, select one change explicitly and use the project skill `ship-who-is-spy-changes`.
6. When the Superpowers plugin is available, invoke its skills as applicable: brainstorming, writing-plans, test-driven-development, systematic-debugging, verification-before-completion, requesting-code-review, and finishing-a-development-branch.
7. If Superpowers is unavailable, report that runtime dependency before implementation; do not claim its workflow was executed.
8. Update `DECISIONS.md` during work with actual Agent contributions, human review, rejected suggestions, and verification evidence.

## Engineering boundaries

- Implement the selected backend only in `packages/server-node`; leave `packages/server-go` unchanged.
- Preserve existing public HTTP behavior and run `npm run contract:node` after relevant changes.
- Deterministic code owns phases, legal targets, ballots, eliminations, winners, and revelation.
- Build AgentContext and hook payloads through allowlists. Never pass a complete GameState to a model or general hook.
- Never persist API keys, complete secret words, private prompts, free-text chain-of-thought, other-agent beliefs, or unresolved votes.
- Keep direct human, licensed transfer, mixed, and synthetic data explicitly separated.
- Do not use unknown-license media or transcripts in training, fixtures, or committed data.

## Verification

Start behavior changes with a failing characterization or acceptance test. Diagnose failures systematically rather than patching symptoms. Before completion, run the scoped tests plus build, Node domain tests, Node contract, evaluation gate, privacy sentinels, and any required portrait visual verification. Do not claim completion from code inspection alone.

## Markdown numbering

Keep user-authored planning/reference Markdown numbered. Change directories carry the top-level sequence (`03`, `04`, `05`). Framework-mandated filenames such as `proposal.md`, `design.md`, `tasks.md`, `spec.md`, `SKILL.md`, and `AGENTS.md` retain their standard names; place their scoped sequence in the document title.

## 仓库文件索引

仅用于导航定位 —— 行为约束以上文契约为准,本树只标明各部分所在位置。生成产物与原始语料转储只作汇总,不逐条罗列。`server-node` 的每个源模块都有同名 `*.test.ts`。

```text
who-is-spy/
├── AGENTS.md                  # 本契约(权威来源 + 工作流 + 工程边界)
├── CANDIDATE_TASK.md          # 面试题面 —— 改动行为前先读
├── DECISIONS.md               # 决策流水:Agent 贡献、人工复核、被否方案、验证证据
├── README.md                  # 项目概览(monorepo:前端 + Node/Go 双后端 + 契约)
├── package.json               # npm workspaces(web、server-node、contract)+ dev/build/test/contract/eval/data 脚本
├── .env.example               # 模型 API key / 运行时配置模板
│
├── contract/                  # 语言无关的公开 HTTP 契约(双后端一致性校验)
│   ├── CONTRACT.md            #   冻结的公开 HTTP 行为 —— 须保持;改动后跑 `npm run contract:node`
│   └── run.mjs                #   契约运行器:`node contract/run.mjs <node|go>`
│
├── packages/
│   ├── server-node/           # ★ 选定后端 —— 新功能只在这里实现
│   │   └── server/
│   │       ├── app.ts · index.ts                 # HTTP 应用 + 入口
│   │       ├── game-engine.ts · state-machine.ts # 确定性:阶段、合法目标、投票、淘汰、胜负、揭晓
│   │       ├── agent-context.ts · hooks.ts       # 白名单化的 AgentContext + hook 载荷(绝不传完整 GameState)
│   │       ├── schema.ts                          # zod schema,含 datasetRecordSchema(provenance 信封)
│   │       ├── redaction.ts                       # 隐私脱敏(不落密语 / 思维链 / 他方信念 / 未定投票)
│   │       ├── beliefs.ts · model.ts · strategies.ts · words.ts  # 信念追踪、模型适配、种子策略、WORD_PAIRS
│   │       ├── feedback.ts · highlights.ts · ops.ts · stream.ts · quality-policy.ts  # 产品 + 运维面
│   │       ├── corpus/        # normalize.ts、splits.ts —— 语料入库 + 确定性切分
│   │       ├── eval/          # metrics.ts、report.ts、self-play.ts(+ gate 测试)—— 评测门禁
│   │       ├── obs/           # tracer、retry、recovery、failure-taxonomy、fault-injection、traced-model、game-scope
│   │       ├── replay/        # dataset.ts、log.ts、replay.ts —— 确定性回放
│   │       ├── tools/         # CLI:import-corpus、build-splits、evaluate、generate-portraits、play-real-game
│   │       └── *.test.ts      # 同目录:领域 + 特征化(b0)+ 隐私哨兵 + 投票隔离测试
│   │
│   ├── server-go/             # 参考后端 —— 保持不变(仅作契约一致性对照)
│   │   ├── game_engine.go · agent_context.go · app.go · model.go · types.go · words.go · …
│   │   └── game_engine_test.go
│   │
│   └── web/                   # 前端(React + Vite)
│       ├── src/
│       │   ├── App.tsx · main.tsx · api.ts · types.ts · characters.ts
│       │   ├── screens/       # Home · Stage · Reveal · God · Finale
│       │   ├── scenes/ · presentation/ · components/ · art/  # 场景驱动、状态机、Seat/ui、立绘
│       │   ├── ops/           # OpsConsole(ops.html 入口)
│       │   └── director.ts · god-director.ts · highlights.ts · stream.ts · feedback.ts
│       └── public/portraits/manifest.json
│
├── openspec/                  # spec 驱动的变更管理 —— 新功能的唯一真实来源
│   ├── config.yaml
│   └── changes/               # 按依赖顺序交付:03 → 04 → 05
│       ├── 03-human-data-and-agent-orchestration/   # proposal.md · design.md · tasks.md · specs/
│       ├── 04-evaluation-and-recovery/
│       └── 05-portrait-product-experience/
│
├── docs/
│   ├── planning-history/      # 01/02 决策依据 —— 非可执行需求
│   └── evidence/              # 验证证据:基线、佐证、交接、评分卡
│
├── data/                      # 语料回填基础(C 阶段前置)
│   ├── README.md              #   provenance 定性结论 + 执行路线
│   ├── sources.yaml           #   版本化来源 manifest(4 个来源;真实人类谁是卧底对局为 0)
│   ├── scripts/fetch.sh       #   幂等抓取 → raw/
│   ├── raw/                   #   下载物,不进 Git:werewolf-among-us、ck-arena(+hf)、spygame、ctwei-spy(隔离)
│   ├── normalized/            #   <source>.jsonl + import-report.json(作为证据进 Git)
│   └── splits/split-manifest.json   # 种子化 train / validation / frozen-core / rolling-challenge / preference-holdout
│
└── .agents/skills/            # 项目 + OpenSpec 技能
    ├── ship-who-is-spy-changes/   # 实现技能(实现阶段调用)
    └── openspec-*/                # explore · propose · apply-change · update-change · archive-change · sync-specs
```
