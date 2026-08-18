import { describe, expect, it } from 'vitest';
import { HookRegistry } from './hooks.js';
import { GameEngine } from './game-engine.js';
import { FakeGameModel } from './test-utils.js';

/**
 * B2 · Typed hook 注册表(OpenSpec 03 · Task 5.2)
 *
 * 覆盖投影 / 超时 / 权限 / 失败隔离 / 密词哨兵五条约束。
 */

const CLEAN_PROJECTION = {
  hook: 'onRoundPublished',
  round: 1,
  public: {
    descriptions: [{ playerId: 'human', text: '一句公开描述', round: 1 }],
    eliminations: [],
  },
};

describe('B2 · hook 投影与密词哨兵', () => {
  it('干净的公开投影可发射,hook 收到与投影一致的数据', async () => {
    const registry = new HookRegistry();
    const seen: unknown[] = [];
    registry.register('onRoundPublished', 'capture', (p) => void seen.push(p));

    const results = await registry.emit('onRoundPublished', CLEAN_PROJECTION);

    expect(results).toEqual([{ name: 'capture', outcome: 'ok' }]);
    expect(seen[0]).toEqual(CLEAN_PROJECTION);
  });

  it('投影夹带密词/身份等未登记字段 → 整批拒绝,任何 hook 都不触发', async () => {
    const registry = new HookRegistry();
    let called = false;
    registry.register('onRoundPublished', 'spy', () => void (called = true));

    const tainted = { ...CLEAN_PROJECTION, word: '拿铁', identity: { role: 'undercover' } };
    await expect(registry.emit('onRoundPublished', tainted)).rejects.toThrow();
    expect(called).toBe(false);
  });
});

describe('B2 · hook 权限(观察者不可变更状态)', () => {
  it('hook 拿到深冻结克隆,试图改动会失败且不影响后续 hook', async () => {
    const registry = new HookRegistry();
    registry.register('onRoundPublished', 'mutator', (p) => {
      // 运行时冻结:尝试改动会抛错(类型层合法,故不加 ts 指令)
      p.public.descriptions.push({ playerId: 'x', text: '注入', round: 1 });
    });
    let observedLen = -1;
    registry.register('onRoundPublished', 'observer', (p) => {
      observedLen = p.public.descriptions.length;
    });

    const results = await registry.emit('onRoundPublished', CLEAN_PROJECTION);

    expect(results[0]).toEqual({ name: 'mutator', outcome: 'error' });
    // 第二个 hook 仍收到未被污染的投影(每个 hook 独立克隆)
    expect(observedLen).toBe(1);
  });

  it('hook 的返回值被忽略(观察者非裁决者)', async () => {
    const registry = new HookRegistry();
    registry.register('onRoundPublished', 'returns', () => ({ verdict: 'override' }));
    const results = await registry.emit('onRoundPublished', CLEAN_PROJECTION);
    expect(results).toEqual([{ name: 'returns', outcome: 'ok' }]);
  });
});

describe('B2 · hook 超时与失败隔离', () => {
  it('挂起的 hook 超时按失败计,emit 不被拖死', async () => {
    const registry = new HookRegistry();
    registry.register('onRoundPublished', 'hang', () => new Promise(() => {}), { timeoutMs: 20 });

    const results = await registry.emit('onRoundPublished', CLEAN_PROJECTION);
    expect(results).toEqual([{ name: 'hang', outcome: 'timeout' }]);
  });

  it('一个 hook 抛错不影响其他 hook 与主流程', async () => {
    const registry = new HookRegistry();
    registry.register('onRoundPublished', 'boom', () => {
      throw new Error('hook 内部崩了');
    });
    let ran = false;
    registry.register('onRoundPublished', 'survivor', () => void (ran = true));

    const results = await registry.emit('onRoundPublished', CLEAN_PROJECTION);

    expect(results).toEqual([
      { name: 'boom', outcome: 'error' },
      { name: 'survivor', outcome: 'ok' },
    ]);
    expect(ran).toBe(true);
  });

  it('注销后不再触发', async () => {
    const registry = new HookRegistry();
    let count = 0;
    const off = registry.register('onRoundPublished', 'once', () => void (count += 1));
    await registry.emit('onRoundPublished', CLEAN_PROJECTION);
    off();
    await registry.emit('onRoundPublished', CLEAN_PROJECTION);
    expect(count).toBe(1);
    expect(registry.size('onRoundPublished')).toBe(0);
  });
});

describe('B2 · hook 接入引擎(回合公开点)', () => {
  const DETERMINISTIC = () => 0;

  it('回合公开时通知观察者,投影只含公开描述,绝无密词', async () => {
    const engine = new GameEngine(new FakeGameModel(), DETERMINISTIC);
    const game = engine.createGame();
    const internal = engine.getInternalGame(game.id);
    const secretWords = new Set(internal.players.map((p) => p.word));
    const payloads: unknown[] = [];
    engine.registerRoundHook('audit', (p) => void payloads.push(p));

    await engine.submitHumanDescription(game.id, '人类给出的一句独特描述');

    expect(payloads).toHaveLength(1);
    const serialized = JSON.stringify(payloads[0]);
    for (const word of secretWords) expect(serialized).not.toContain(word);
    // 投影里带的是本轮 5 条公开描述
    const payload = payloads[0] as { public: { descriptions: unknown[] } };
    expect(payload.public.descriptions).toHaveLength(5);
  });

  it('观察者抛错/超时不影响对局照常推进', async () => {
    const engine = new GameEngine(new FakeGameModel(), DETERMINISTIC);
    const game = engine.createGame();
    engine.registerRoundHook('boom', () => {
      throw new Error('观察者崩了');
    });
    engine.registerRoundHook('hang', () => new Promise(() => {}), { timeoutMs: 20 });

    const voting = await engine.submitHumanDescription(game.id, '人类的独特描述');
    expect(voting.phase).toBe('voting');
    expect(voting.descriptions).toHaveLength(5);
  });
});
