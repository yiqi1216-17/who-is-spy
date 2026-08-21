import type express from 'express';

/**
 * 公网守卫(部署加固 · 仅在 `PUBLIC_MODE=1` 时挂载)
 *
 * 面向网友开放后,两类资源必须封顶:
 *   - **钱**:每局(尤其上帝局)是几十次真实 DeepSeek 调用,恶意刷局能直接刷爆余额;
 *   - **内存**:对局存进程内 Map,无上限创建即无界增长。
 *
 * 三道闸(全部可配、可注入时钟、确定性可测):
 *   1. 每 IP 命令频率:POST 命令(描述/投票/继续)滑动窗口限频——正常玩家远碰不到;
 *   2. 每 IP 建局频率:POST /api/games 与 /api/god-games 每小时限次——建局才是成本源;
 *   3. 全局建局日额:所有 IP 共享的 24h 滑动窗口总额——余额的最终保险丝。
 *
 * 刻意**不挂载即零行为差异**:契约测试与本地开发不设 PUBLIC_MODE,行为逐字节不变;
 * GET(读状态/SSE/回放/高光)不限——只读端点无模型成本,限了反而伤观战与断线对账。
 * 超限统一 429 + Retry-After,文案不暴露阈值细节。
 */
export interface PublicGuardOptions {
  /** 注入时钟(毫秒),测试用;默认 Date.now。 */
  now?: () => number;
  /** 每 IP 每分钟 POST 命令上限(默认 30:一轮人类操作 ≈ 2-3 次,余量充足)。 */
  maxCommandsPerIpPerMinute?: number;
  /** 每 IP 每小时建局上限(默认 6:含上帝局,正常体验足够)。 */
  maxGamesPerIpPerHour?: number;
  /** 全局 24h 建局总额(默认 150:按每局几十次调用估算的余额保险丝)。 */
  maxGamesPerDay?: number;
}

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 全量清扫间隔:定期移除已静默 IP 的窗口,防止换 IP 扫射把 Map 撑大。 */
const SWEEP_INTERVAL = 10 * MINUTE;

/** 建局端点(成本源):人类局与上帝局。 */
const CREATION_PATHS = new Set(['/api/games', '/api/god-games']);

export function createPublicGuard(options: PublicGuardOptions = {}): express.RequestHandler {
  const now = options.now ?? Date.now;
  const maxCommands = options.maxCommandsPerIpPerMinute ?? 30;
  const maxGamesPerIp = options.maxGamesPerIpPerHour ?? 6;
  const maxGamesGlobal = options.maxGamesPerDay ?? 150;

  const commandHits = new Map<string, number[]>();
  const creationHits = new Map<string, number[]>();
  const globalCreations: number[] = [];
  let lastSweep = 0;

  /** 修剪窗口内过期时间戳;返回窗口内计数。 */
  function prune(hits: number[], windowMs: number, at: number): number {
    while (hits.length > 0 && at - hits[0] >= windowMs) hits.shift();
    return hits.length;
  }

  function sweep(at: number): void {
    if (at - lastSweep < SWEEP_INTERVAL) return;
    lastSweep = at;
    for (const [ip, hits] of commandHits) {
      if (prune(hits, MINUTE, at) === 0) commandHits.delete(ip);
    }
    for (const [ip, hits] of creationHits) {
      if (prune(hits, HOUR, at) === 0) creationHits.delete(ip);
    }
  }

  /** 反代(Vercel rewrites → Render)链路取真实来源:XFF 最左跳,取不到回落 req.ip。 */
  function clientIp(request: express.Request): string {
    const forwarded = request.headers['x-forwarded-for'];
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return first?.split(',')[0]?.trim() || request.ip || 'unknown';
  }

  function reject(response: express.Response, retryAfterSeconds: number, message: string): void {
    response.status(429).set('Retry-After', String(retryAfterSeconds)).json({ error: message });
  }

  return (request, response, next) => {
    // 只闸 /api 下的 POST;GET(状态/SSE/回放/高光)与非 API 路径直放。
    if (request.method !== 'POST' || !request.path.startsWith('/api/')) {
      next();
      return;
    }
    const at = now();
    sweep(at);
    const ip = clientIp(request);

    if (CREATION_PATHS.has(request.path)) {
      if (prune(globalCreations, DAY, at) >= maxGamesGlobal) {
        reject(response, 3600, '今日牌桌已满，明天再来吧');
        return;
      }
      const mine = creationHits.get(ip) ?? [];
      if (prune(mine, HOUR, at) >= maxGamesPerIp) {
        reject(response, 600, '开局太频繁了，歇一会儿再开新局');
        return;
      }
      mine.push(at);
      creationHits.set(ip, mine);
      globalCreations.push(at);
      next();
      return;
    }

    const mine = commandHits.get(ip) ?? [];
    if (prune(mine, MINUTE, at) >= maxCommands) {
      reject(response, 30, '操作太快了，稍等片刻');
      return;
    }
    mine.push(at);
    commandHits.set(ip, mine);
    next();
  };
}

/** 从环境变量读取覆盖值(缺省用默认档);非法值忽略。 */
export function guardOptionsFromEnv(env: NodeJS.ProcessEnv): PublicGuardOptions {
  const read = (key: string): number | undefined => {
    const raw = env[key];
    if (raw === undefined || raw === '') return undefined;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : undefined;
  };
  return {
    maxCommandsPerIpPerMinute: read('PUBLIC_MAX_COMMANDS_PER_MINUTE'),
    maxGamesPerIpPerHour: read('PUBLIC_MAX_GAMES_PER_IP_HOUR'),
    maxGamesPerDay: read('PUBLIC_MAX_GAMES_PER_DAY'),
  };
}
