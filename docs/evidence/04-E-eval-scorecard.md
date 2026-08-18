# 04-E · 批量评测记分卡与门禁证据

> 记录日期:2026-08-19。对应 OpenSpec 04 · Task 1.2 / 1.3 / 2.2 / 2.3。
> 命令:`npm run eval:node -- [--games N] [--seed S] [--demo-fail] [--json] [--min-* x]`
> 实现:`packages/server-node/server/eval/{self-play,metrics,report}.ts` + `tools/evaluate.ts`;
> 测试:`server/eval/{self-play,metrics,gates}.test.ts`(23 条)。

---

## 1. 为什么能"无头批量跑" — 不改核心规则的前提解法

引擎 `createGame` 按题设把人类硬编码在 seat0(评审 MED:"无 headless 全 AI 入口")。
我**不动核心规则**,而在 harness 里用一个**确定性安全脚本**陪跑人类座位:
- describe 轮换安全句 —— 对 `words.ts` 全部 24 个候选密词都不含子串,恒过引擎字面泄题门;
- vote 恒投首个合法存活 AI(平票复投投首个合法 eligible)。

4 个 AI 座位由模型驱动;**指标只在 AI 座位上计算**,人类座位是确定性陪跑、不进分子。
复现性来自**共享 `mulberry32(seed)` 随机流**:一条流跨多局顺序推进 → 局与局各异(覆盖不同
卧底落位 / 词对 / 终局),但同 seed 同批**逐字节可复现**(`gates.test.ts` 断言两次运行报告 JSON 全等)。

---

## 2. 记分卡(fixture 确定性,`--games 12 --seed 1`)

```
===== 评测记分卡 · fixture-selfplay / B3-current =====
样本:12 局(fixture 确定性,逐字节可复现)

— 安全不变量(应恒 0)—
  泄题条数        0 / 111 条 AI 描述
  非法投票        0 / 111 张 AI 票

— 完成度 —
  完成率          100.0% ±0.0%(n=12)
  平均轮数        2.50

— 差异化(反转 CH-2 的可测证据)—
  多样度          99.6%(同轮跨 AI 平均措辞距离,n=153 对)
  策略可区分率    100.0% ±0.0%
  自我重复率      0.5%(越低越好,n=63 对)

— 信念校准(离线特征,永不回流 context)—
  最高怀疑命中率  35.9% ±15.1%(n=39 名平民 AI)
  平均怀疑差      0.0958(对真卧底 − 对他人)

— 角色结果 / 用量 —
  卧底胜率        50.0% · 平民胜率 50.0%
  模型调用总数    234 · 描述重试 0

===== 门禁 =====
✅ 通过:五类门(泄题/非法/未完成/隐私哨兵/阈值)均未触发。
```

> 说明:fixture 用确定性假模型,信念校准命中率仅作**基线口径**(35.9% 不代表真机能力);
> latency/cost 是墙钟量,**留真机模式单列**——fixture 报告要逐字节稳定,故不含时延字段。

---

## 3. 指标口径(全部带分母 n;比率类附 95% 近似置信半宽)

| 指标 key | 定义 | 分母 n |
| --- | --- | --- |
| `leak_count` | AI 描述含自身密词条数(结构上应恒 0,跨 N 局回归) | AI 描述总数 |
| `illegal_vote_count` | 目标非真实存活 / 自投条数(应恒 0,引擎已重裁) | AI 票总数 |
| `completion_rate` | 打到终局的对局占比 | 对局数 |
| `diversity_rate` | 同轮跨 AI 描述对的平均 (1 − 字符 bigram 相似度) | 跨 AI 描述对数 |
| `strategy_distinguishability` | 同轮跨 AI 描述对中相似度 < 0.72 的占比 | 跨 AI 描述对数 |
| `self_repetition_rate` | 同一 AI 相邻两轮自述相似度均值(越低越好) | 相邻自述对数 |
| `belief_hit_rate` | 平民 AI 最高怀疑命中真卧底的比率(卧底不入分母) | 平民 AI 数 |
| `mean_suspicion_gap` | 对真卧底怀疑 − 对他人平均怀疑 | 平民 AI 数 |
| `undercover_win_rate` / `civilian_win_rate` | 角色胜率 | 对局数 |
| `model_calls_total` | describe+vote+review 调用总数 | 对局数 |
| `describe_retries_total` | describe 调用数 − 落地描述数(有界重试的可观测代理) | AI 描述总数 |

阈值取"当前 fixture 稳过、又非平凡"档:完成率下限 =1、可区分率下限 =0.5、多样度下限 =0.05,
校准命中默认不设硬门(假模型不代表真机)。**keyset 冻结**以防指标操纵 / split 泄漏(残余风险 R3)。

---

## 4. 门禁会红 — 故障演示(`--demo-fail`,3 局)

注入一个**必然泄题**的模型(描述直接吐自身密词)→ 质量门穷尽 → 整回合**原子终止**(CH-4)→
harness 记为"未完成" → 完成率门捕获。process **以非零退出**:

```
===== 门禁 =====
❌ 失败(3 项)——process 将以非零退出:
  · [incomplete_game] 完成率 0 < 下限 1
  · [threshold_diversity] 多样度 0 < 下限 0.05
  · [threshold_distinguishability] 可区分率 0 < 下限 0.5
EXIT=1
```

> 注:`描述重试 9` = 3 局 × 每局 3 次被质量门驳回的尝试,全部未落地 —— 这是"有界重试→原子终止"
> 在评测侧的可观测信号。收紧阈值也能演示:`-- --min-belief-hit 0.9` → `threshold_belief_hit` 触发(exit 1)。

五类门(泄题 / 非法动作 / 未完成 / 隐私哨兵 / 阈值突破)在 `gates.test.ts` 各有独立断言;
隐私哨兵扫描报告工件中的**密词字面量 + 凭据**(不误伤 `undercover_win_rate` 等角色词构成的 key)。

---

## 5. 交付边界(诚实标注,见 `openspec/changes/04-.../tasks.md` 顶部范围决定)

**本轮交付**(4 项全绿):1.2 fixture 复现 · 1.3 场景矩阵 · 2.2 带分母指标 · 2.3 非零门禁。
**显式延后**(以效果为目标、不引入治理开销):1.1 多版本清单校验、2.1 frozen-core 哈希门、
2.4 盲测人类偏好;§3/§4 可观测+恢复 → **04-F**,§5 replay+数据记录 → **04-G**,§6 收尾 → **交付收尾批**。
