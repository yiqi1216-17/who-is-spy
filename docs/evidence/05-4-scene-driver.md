# 05-H 任务 4.2 / 4.3 证据 · 开发态场景驱动与生产禁用

> 日期 2026-08-19 · 范围 `packages/web/src/scenes/*` + `packages/web/src/main.tsx`
> 对应 OpenSpec `openspec/changes/05-portrait-product-experience/tasks.md` 第 4.2 / 4.3 条。

## 1. 任务 4.2 · 十个关键场景由生产 schema 驱动

`scenes.ts` 用**生产类型**(`PublicGameState` / `PublicPlayer` / `GameEvent` / `Vote` / `HighlightReel`)
构造十份确定性快照;类型即 schema,`tsc` 逐字段校验其合法性。覆盖题面点名的全部呈现态:

| # | id | 定格的呈现态 |
|---|---|---|
| 1 | `role-reveal` | 开局私密展示身份与密词 |
| 2 | `speech` | 轮流描述,两名 AI 先发言 |
| 3 | `vote` | 描述结束,给出可投目标 |
| 4 | `tie` | 打平进入第二张选票(ballot=2) |
| 5 | `elimination` | 某席被票出,渐显灰度 |
| 6 | `failure` | 剧场照旧,盖供应商故障叠层 |
| 7 | `reconnect` | 剧场照旧,盖断线重连叠层 |
| 8 | `finale` | 身份/密词/胜负/复盘全揭晓 |
| 9 | `highlight` | 证据接地的剧透安全高光卡 |
| 10 | `replay` | 从开局逐拍重放到终局 |

渲染侧 `harness.tsx` 的三条纪律:

1. **复用真实屏**:`finished` 相位交给真实 `FinaleScreen`(prop `onRestart`),
   `role-reveal` 交给真实 `RevealScreen`(prop `onDone`)——场景与线上呈现同源。
2. **网络轴正交**:`failure`/`reconnect` 不另造分支,而是把 `NET_LOST` / `NET_RETRYING`
   喂进**真实表现层状态机** `presentation/machine.ts` 的 `run()`,再由 `overlay()` 派生叠层。
   剧场镜头(相位)与网络叠层是两条独立轴,这一点由状态机本身保证,不是 harness 复刻的。
3. **逐拍回放**:`replay` 场景按事件序逐条推进,游标由本地 state 持有,不触碰任何权威状态。

## 2. 任务 4.3 · 生产构建禁用 + fixture 不可改真局

三重保险,分别在**结构**、**构建**、**运行时**三个层面成立:

### 2.1 结构层:场景代码无从触达写路径

`scenes.ts` 与 `harness.tsx` **从不引用 `../api`**,也不含任何 `api.` 调用。
没有写命令可被触发,场景纯本地渲染,**结构上不可能**改动任何真实对局。
由 `scenes.test.ts` 的 `it.each(['scenes.ts','harness.tsx'])` 读源码断言:

```
expect(text).not.toMatch(/from ['"]\.\.\/api['"]/)
expect(text).not.toMatch(/\bapi\./)
```

### 2.2 构建层:整段被静态消除,不进产物

`main.tsx` 用 `import.meta.env.DEV && params.has('scene')` 守卫**动态** `import('./scenes/harness')`。
生产构建里 `import.meta.env.DEV` 为编译期常量 `false`,整个分支连同 `./scenes/*` 被 DCE 消除。

复核方式(`packages/web`):

```
rm -rf dist && npx vite build      # BUILD_EXIT=0
ls -1 dist/assets/                 # 仅 index-*.css / index-*.js,无 harness-*.js
```

产物只有单一 JS chunk,**没有** `harness-[hash].js` 独立分块 —— 动态 import 未被保留。

进一步做字符串级检索:取 12 个**仅在 `scenes/` 出现**的独占串,在 `dist/` 全目录检索,
命中数须为 0。

| 检索串 | dist 命中 |
|---|---|
| `围坐分享` / `一锅百味` / `一次干净的收网` | 0 |
| `天冷时最抚慰人心` / `措辞太笼统` / `离开了牌桌` | 0 |
| `独醒者` / `一锤定音` | 0 |
| `场景驱动 · DEV` / `未知场景` | 0 |
| `sh-inspector` / `sh-beatbar` | 0 |

合计 `checked=12 leaked=0`。

**一处需澄清的假阳性**:`身份揭晓`、`阿序`/`弥生`/`老墨`/`小满` 在 `dist` 中确有命中,
但它们并非 fixture 独占——`身份揭晓` 同时是 `screens/FinaleScreen.tsx` 的真实文案,
四个角色名来自生产角色库 `src/characters.ts` 与立绘 `src/art/portraits.tsx`。
故这些命中来自生产模块,不构成场景代码泄漏。这也是为什么证明必须用**独占串**而非任意串。

### 2.3 运行时层:harness 自带生产拒绝闸

即便有人绕过构建守卫直接引用,`SceneHarness` 入口第一件事就是自检:

```tsx
if (!import.meta.env.DEV) {
  throw new Error('SceneHarness 仅限开发构建(import.meta.env.DEV)。');
}
```

对应断言在 `scenes.test.ts`:同时校验 `main.tsx` 含 DEV 守卫 + 动态 import 形态,
以及 `harness.tsx` 含这条拒绝闸。守卫被误删会让测试红,不会静默降级。

## 3. 门禁

| 项目 | 命令 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit`(packages/web) | EXIT 0,0 行输出 |
| 单测 | `npx vitest run` | 7 文件 / **72 通过** |
| 场景单测 | `npx vitest run src/scenes/scenes.test.ts` | 1 文件 / **13 通过** |
| 生产构建 | `npx vite build` | EXIT 0,单 chunk 255.00 kB + 37.21 kB CSS |
| DCE 检索 | 12 独占串 × `dist/` | `leaked=0` |

## 4. 诚实边界

- 本轮交付的是**开发态场景驱动 + 生产禁用证明**(4.2 / 4.3)。
  任务 4.4 的竖屏截图矩阵与移动视口 E2E 需要真实浏览器驱动,单列一批,未在此文档声称完成。
- 场景快照 id 固定为 `'scene'`,`FinaleScreen` 内的高光 tab 会按该 id 发起拉取并 404,
  随后优雅降级——不影响身份/复盘/票局三视图的呈现,但这是已知的开发态噪声,非线上路径。
- `highlight` 场景的 reel 由 fixture 直接提供(剧透安全层),
  未经服务端检测器实际计算;服务端检测器自身的证据在 04/05 的高光测试里另有覆盖。
