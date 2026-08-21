# 公网部署指南(Vercel 前端 + Render 后端)

> 目标:让网友直接在浏览器玩「谁是卧底」。前端是纯静态站,可上 Vercel;
> 但**游戏核心在后端**——内存态对局引擎 + SSE 长连接 + DeepSeek 真实调用,
> Vercel serverless(无状态、短生命周期)承载不了,所以后端放 Render(常驻 Node 进程),
> 前端用 Vercel rewrites 反代 `/api` 同源转发(免 CORS、前端零改动)。

## 架构

```text
网友浏览器
   │  https://your-app.vercel.app        (静态站:Vercel CDN)
   │  /api/* ── vercel.json rewrites ──▶ https://who-is-spy-api.onrender.com
   │                                     (常驻 Node:对局引擎 + SSE + 公网守卫)
   │                                        │ DEEPSEEK_API_KEY(只在 Render,绝不进前端)
   ▼                                        ▼
 index.html + assets                    api.deepseek.com
```

## 第一步:部署后端(Render,约 5 分钟)

1. 把仓库推到 GitHub(私有仓库亦可)。
2. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → 选本仓库。
   Render 读取根目录 `render.yaml` 自动配置;创建时会提示输入 **`DEEPSEEK_API_KEY`**(唯一手填项)。
3. 部署完成后拿到域名,形如 `https://who-is-spy-api.onrender.com`,验证:

   ```bash
   curl https://who-is-spy-api.onrender.com/api/health
   # → {"ok":true,"model":"deepseek-v4-flash","configured":true}
   ```

关键环境变量(render.yaml 已内置):

| 变量 | 值 | 作用 |
| --- | --- | --- |
| `NODE_ENV` | `production` | 生产闸:不挂 `/api/ops/*`、模型链无故障注入面 |
| `PUBLIC_MODE` | `1` | 公网守卫:限频 + 建局限额(见下) |
| `GAME_MODEL` | `real` | 真实 DeepSeek(演示可临时改 `fake` 零成本试链路) |
| `DEEPSEEK_API_KEY` | 手填 | 只存在于 Render,永不下发浏览器 |

## 第二步:部署前端(Vercel,约 3 分钟)

1. 先把后端域名填进根目录 `vercel.json` 的 rewrites destination(替换
   `REPLACE_WITH_YOUR_BACKEND.onrender.com`),提交推送。
2. [vercel.com/new](https://vercel.com/new) → Import 本仓库 → **全部默认**直接 Deploy
   (`vercel.json` 已声明 install/build/outputDirectory,Root Directory 留仓库根即可)。
3. 打开 `https://your-app.vercel.app` 即可玩。CLI 党等价操作:`npx vercel --prod`。

## 公网守卫(必读:这是你的钱包保险丝)

一局(尤其上帝局)= 几十次真实模型调用。`PUBLIC_MODE=1` 启用三道闸
(`server/public-guard.ts`,超限 429 + Retry-After;GET/观战/SSE 不限):

| 闸 | 默认 | 环境变量 |
| --- | --- | --- |
| 每 IP 命令频率 | 30 次/分钟 | `PUBLIC_MAX_COMMANDS_PER_MINUTE` |
| 每 IP 建局(含上帝局) | 6 局/小时 | `PUBLIC_MAX_GAMES_PER_IP_HOUR` |
| **全局建局日额** | **150 局/24h** | `PUBLIC_MAX_GAMES_PER_DAY` |

按余额估算日额:一局人类局 ≈ 15–25 次调用、上帝局 ≈ 30–80 次;deepseek-v4-flash
单价低,150 局/天通常在几元人民币量级——请按自己的余额把 `PUBLIC_MAX_GAMES_PER_DAY` 调到安心值。

## 已知限制(免费档如实说)

- **对局在内存**:后端重启/重新部署 = 进行中的对局丢失(题目基线即纯内存,公网演示可接受)。
- **Render 免费档休眠**:约 15 分钟无流量后休眠,下一个访客首个请求要等 ~30s 冷启动
  (`/api/health` 唤醒)。想常驻:升 Starter 档,或用 UptimeRobot 每 10 分钟 ping 一次 health。
- **SSE 经 Vercel 反代**:rewrites 支持流式响应;若个别网络中间层缓冲,前端本就有
  「缺号 → 权威对账回退」(`GET /api/games/:id`),观战不至于断流。
- **观测台不上线**:`/ops.html` 不在生产构建入口,`/api/ops/*` 生产 404——这是刻意的
  (故障注入开关绝不能对公网开放);排障用 Render 日志。

## 上线前自检清单

- [ ] `git grep -n "sk-" -- ':!*.md'` 无真实密钥入库(`.env` 已被 gitignore)
- [ ] 后端 `/api/health` 返回 `configured: true`
- [ ] vercel.json destination 已替换成你的 Render 域名
- [ ] 用手机流量(非家庭 WiFi)完整玩一局 + 开一桌上帝局
- [ ] 第 7 局建局收到 429「开局太频繁」(守卫真的在工作)
- [ ] DeepSeek 控制台设余额告警
