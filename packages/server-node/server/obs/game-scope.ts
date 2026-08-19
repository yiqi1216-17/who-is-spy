import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * 隐式对局作用域(OpenSpec 04 · §3.2 补钉:trace 的「哪一局」维度)
 *
 * 题面验收要求故障能定位到「哪一局、哪一轮、哪个 AI、第几次重试、什么错误」。
 * 后四维 trace 早已携带;唯独 gameId 缺位——因为 `AgentContext.game` 是允许列投影,
 * **刻意不含局号**,而 `GameModel` 接口(describe/vote/review 签名)受契约冻结,不能加参。
 *
 * 解法:Node 标准的 `AsyncLocalStorage` 隐式传播。引擎在每局命令边界(`withGame`)与
 * 上帝局解算点 `run({gameId})`,`emitTrace` 落汇时读取——跨 await/Promise.all 自动继承,
 * 模型接口与允许列投影零改动,信息隔离不变(gameId 本就是公开 DTO 字段,非机密)。
 */
const storage = new AsyncLocalStorage<{ gameId: string }>();

/** 在某局的作用域内执行 fn;其内部(含所有异步续体)的 trace 自动归属该局。 */
export function runInGameScope<T>(gameId: string, fn: () => T): T {
  return storage.run({ gameId }, fn);
}

/** 当前异步作用域所属的对局 id;不在任何对局作用域内(如离线单测直发)时为 undefined。 */
export function currentGameId(): string | undefined {
  return storage.getStore()?.gameId;
}
