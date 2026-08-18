# B0 · 基线冻结证据(OpenSpec 03 · Task 1.1)

> 冻结"收到时"的可运行基线,作为后续二次开发的对照原点。B0 = baseline v0。
> 记录日期:2026-08-18。栈:Node(`packages/server-node`),Go 侧不改动。

## 环境

- Node v24.18.0 / npm 11.16.0(darwin)
- 依赖安装:`npm ci`,164 包,integrity 全匹配,0 漏洞。
- 已知环境改动:原 `package-lock.json` 的 209 条 `resolved` 指向内网镜像 `bnpm.byted.org`,
  脱离内网无法安装。已将 host 替换为 `registry.npmjs.org`(版本号与 integrity 不变),
  见提交 `chore(deps): 锁文件 resolved URL 由内网镜像改为公共 npm 源`。

## 基线结果(全绿)

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 构建 | `npm run build` | ✅ web(vite,1795 模块)+ server(`tsc --noEmit`)均通过 |
| 域测试 | `npm run test:node` | ✅ 3 文件 / 6 用例通过 |
| 语言无关契约 | `npm run contract:node` | ✅ 28 通过 / 0 失败 |

契约覆盖:健康就绪、开局与终局前信息隔离、描述阶段校验(泄词/长度)、
非法请求(空 targetId→400、不存在对局→404)、投票确定性裁决与终局揭示。

## 已观察到的基线问题(任务线① 的起点,待证据化)

- `game-engine.ts:194` `generateDescriptions` 用 `Promise.all` 并行 → 后发 Agent 读不到同轮先发描述。
- `game-engine.ts:15-20` `AI_PROFILES.style` 人设字段从未进入 `buildAgentContext` → 人设对行为零影响。
- `model.ts:82` 泄题检查仅 `description.includes(word)` 字面子串 → 无同质化 / 近义泄题拦截。

> 下一步:搭接缝骨架(Strategy / Strategist / QualityPolicy / TraceEvent + 顺序生成 + 域状态机),
> 使上述三问题可被机制拦下,且四角色行为可区分。见 OpenSpec 03 §2、§5。
