# data/ · 语料回填基础(C 阶段前置)

> 本目录是 openspec change 03 中**显式延后**的 §3「human-game data foundation」与 §4「真实语料
> 挖掘」的落地起点(见 `openspec/changes/03-human-data-and-agent-orchestration/tasks.md` 的
> 范围决定与 `docs/evidence/03-handoff-04-05.md` §6.4-b 分诊表:语料回填 → C 阶段)。
> 现在只落**来源清单 + 获取脚本 + 目录约定**,不引入数据治理代码——治理机器(consent/withdrawal/
> split-manifests)仍按原决定延后,拾取时按本 README 的执行路线逐步兑现。

## 0. 一句话结论(先读这个)

调研的四篇论文(见 `sources.yaml`)**没有任何一篇提供"真实人类玩谁是卧底"的对局语料**。
因此 `strategies.ts` 里 `provenance:{kind:'synthetic'}` 的种子策略**短期内不可能升级为
`human`**;能诚实回填的最高等级是 **`transfer`**(跨游戏的人类行为分类学)。这与
design.md 决策 3 一致:transfer 语料可指导策略维度,但**永不冒充**直接 human 证据。

## 1. 来源速查表

| id | 论文 | 可用资产 | 语言 | 许可 | 本项目定性 |
| --- | --- | --- | --- | --- | --- |
| `werewolf-among-us` | arXiv:2212.08279(ACL'23 Findings) | 199 局**真实人类**社交推理对局转录(ONUW/Avalon)+ 26,647 条句级说服策略标注 + 胜负/投票结果 | en | Apache-2.0(HF 载体;Ego4D 视频另需签 Ego4D license,**只取文本+标注即可**) | **`transfer`** —— 唯一真实人类语料,但游戏不是谁是卧底;用于策略分类学与 tactics 分布 |
| `spygame` | arXiv:2310.20499(Tencent) | 中英关键词对(`prompt/keyword_set.json`)+ DEEP 40 目标词 + 多 agent 评测框架 | zh/en | **GPL-3.0** | 方法论输入(座位/名字/选项顺序消偏、ToM 探针 → 喂 change 04 评测设计);**代码禁止拷贝进本 repo**(传染性;本 repo 无 LICENSE) |
| `ctwei-spy` | arXiv:2503.15235 | 中文 4 人局词表 `data/4player.csv` / `4players-simple.csv`(格式:4 玩家词+卧底座位+类别,与本项目 1 human + 4 AI 座次最贴近)+ CoT prompt + GLM 对局日志 | zh | **无 LICENSE(默认保留所有权利)** | **quarantine** —— 只可本地对照实验,不入库、不再分发;对局日志为 `synthetic`(GLM 生成) |
| `ck-arena` | arXiv:2505.17512 | 628 英文词对(形/副/动/名词,13+ 语义类,HF/Kaggle)+ 746 份 LLM 对局日志(GitHub `logs/`)+ QA train/test.jsonl + LLM-judge/ELO 打分代码 | en(主) | Apache-2.0(HF) | 词对可安全入库(需翻译/筛选);对局日志为 **`synthetic`**(LLM 局,绝不可标 human);LLM-judge + ELO 方法喂 change 04 |

机器可读明细(URL、获取命令、permitted/blocked uses、风险)见 [`sources.yaml`](./sources.yaml)。

## 2. 目录约定

```
data/
  README.md        本文件:定性结论 + 执行路线
  sources.yaml     版本化来源 manifest(spec「verifiable provenance」的最小实现)
  scripts/
    fetch.sh       一键抓取 → raw/(幂等;HF 走 hf-mirror.com,直连不通)
  raw/             原始下载物 —— 不进 Git(.gitignore),unknown-rights 来源天然被隔离在此
  normalized/      归一化产物:`<source>.jsonl`(datasetRecord 信封,不进 Git,可复现)
                   + `import-report.json`(入库/拒绝/diagnostic 汇总,进 Git 作证据)
  splits/          `split-manifest.json`:train / validation / frozen-core /
                   rolling-challenge / preference-holdout(种子化确定性,进 Git)
```

与已冻结 schema 的对齐(**不新发明格式**):

- 归一化目标 = `packages/server-node/server/schema.ts:172` 的 `datasetRecordSchema`:
  `{ gameId, provenance: 'human'|'transfer'|'synthetic', players: [{pseudoId, role}], actions: [{round, playerId, kind, text?, targetId?}], license? }`
- 策略回填目标 = 同文件 `strategySchema` 的 `provenance: { kind, sampleIds? }`,
  `sampleIds` 指向 normalized 记录的 `gameId`。
- 词库扩充目标 = `packages/server-node/server/words.ts` 的 `WORD_PAIRS`(中文词对二元组)。

## 3. 后续执行方式(拾取顺序即依赖顺序)

每步对应 tasks.md 延后项编号;**每步开始前先写失败测试**(项目惯例)。

1. **抓取 ✅ 已落地** — `bash data/scripts/fetch.sh all`。产物只落 `raw/`;脚本对
   `ctwei-spy` 打印 quarantine 警告,对 HF 来源自动走镜像(hf CLI 自身增量,可续传)。
2. **归一化 + 隔离 ✅ 已落地(tasks 3.1/3.2)** — `npm run data:import`
   (`server/tools/import-corpus.ts` + `server/corpus/normalize.ts`,测试
   `normalize.test.ts` 14 项)。实测:ck-arena 707 局(synthetic)+ werewolf-among-us
   Youtube 子集 151 局(transfer)入库 `normalized/`,`ctwei-spy`(unknown-rights)与
   `spygame`(无对局记录)带 diagnostic 拒绝,汇总见 `normalized/import-report.json`。
   要点:来源→`provenance` 是封闭映射表(类型上写不出 human);Ego4D 子集无角色信息
   不入库;句级说服策略 `annotation` **留在 raw/**(strict datasetRecord 不承载),
   第 4 步策略抽取直读——证据层与分析层分离。
3. **切分 ✅ 已落地(tasks 3.3)** — `npm run data:splits [--seed N]`
   (`server/corpus/splits.ts`,测试 `splits.test.ts` 8 项)。ck-arena 按**词对**、
   werewolf 按**视频 cohort** 整组分配(同组永不跨 split;实测 520 组 0 冲突),
   FNV 种子化 70/10/10/10,复跑逐字节一致;`preference-holdout` 诚实为空。
   检索资格 API `isRetrievalEligible`:train/validation 可检索,frozen-core /
   rolling-challenge / 未登记 gameId **一律拒绝**(spec「Retrieval attempts to use a
   holdout example」的 denial 已有测试,待 C 阶段检索层直接消费)。
4. **策略抽取 ✅ 已落地(tasks 4.1/4.2)** — `npm run data:strategies`
   (`server/corpus/extract-strategies.ts`,测试 6 项;CLI 生成
   `server/strategies.data.ts` + `normalized/strategy-extraction-report.json`)。
   实测:train 109 局、475 个玩家样本,按主导标签分桶为四个可解释原型——
   质询试探 209 / 稳守辩护 115 / 直接施压 105 / 举证定调 46;三个连续量为簇内实测占比
   (specificity=Evidence+IdentityDeclaration,novelty=Interrogation+CallForAction,
   risk=Accusation+IdentityDeclaration),tactics 为簇 top3 标签经固定词典生成。
   `SEED_STRATEGIES` 已由 synthetic v1 替换为 transfer v2(`provenance.sampleIds ⊆ train`,
   frozen 局有测试证明不进拟合);编排代码零改动,persona/sentinel 测试锚点同步。
   已知近似(已写入代码注释与报告):狼人杀→谁是卧底跨游戏、en→zh 跨语言;
   train 实测 civilian 与 undercover 分布几乎相同,是 `role:'any'` 的数据依据。
5. **评测联动(→ change 04)** — `ck-arena` 的 synthetic 对局日志做泄题/同质化指标的
   **校准集与回归 fixture**(不是人类证据,报表按 spec 分列 human/transfer/synthetic
   计数);SpyGame 的三类顺序消偏纳入 04 的批量评测设计。
6. **真正的 `human` 语料(tasks 3.4,最后)** — 只能一方自采:runbook + consent 文案 +
   标注指南。在此之前,任何对外表述**不得**出现"learned from human play"。

## 4. 风险与红线(操作时对照)

- **红线 1**:`raw/` 永不进 Git;`normalized/` 只进有明确 license 的样例。
- **红线 2**:`provenance` 三值映射只升不降——synthetic 不得洗成 transfer,transfer
  不得洗成 human(spec「Human and synthetic data remain distinguishable」)。
- **红线 3**:SpyGame(GPL-3.0)与 ct-wei(无 LICENSE)的**代码与数据均不拷贝**进
  仓库;只读方法、自行实现。
- **网络事实**(2026-08-19 实测):直连 `huggingface.co` 不通,`fetch.sh` 已固定
  `HF_ENDPOINT=https://hf-mirror.com`;`git clone` 直连 github.com:443 超时而
  curl(api/codeload)可达,故脚本用 **curl tarball 优先、git clone 兜底**,
  GitHub raw 偶发抖动时重跑脚本即可(幂等)。
- **词库注意**:CK-Arena 词对为英文,直接翻译可能破坏"相近但可区分"的词对张力,
  入 `WORD_PAIRS` 前需人工复核一遍中文语感。
