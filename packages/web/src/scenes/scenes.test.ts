import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SCENES, sceneById } from './scenes';

/**
 * 场景库与场景驱动的验收测试(OpenSpec 05-H · 任务 4.2/4.3)
 *
 * 三层:
 *   1. 覆盖——题面点名的十个关键场景齐备且可寻址;
 *   2. 合法——每份 fixture 都是用生产类型构造的自洽快照(席位/相位/选票/揭示时点);
 *   3. 结构证明(任务 4.3)——场景层源码不含任何触达写路径的引用,
 *      并且 harness 只能经 `import.meta.env.DEV` 守卫动态加载 + 自带生产拒绝闸。
 */

const here = dirname(fileURLToPath(import.meta.url));
const src = (file: string): string => readFileSync(join(here, file), 'utf8');

const EXPECTED_IDS = [
  'role-reveal',
  'speech',
  'vote',
  'tie',
  'elimination',
  'failure',
  'reconnect',
  'finale',
  'highlight',
  'replay',
];

describe('场景库覆盖(任务 4.2)', () => {
  it('题面点名的十个场景齐备且顺序确定', () => {
    expect(SCENES.map((s) => s.id)).toEqual(EXPECTED_IDS);
    expect(new Set(SCENES.map((s) => s.id)).size).toBe(10);
  });

  it('sceneById 命中与未知回退', () => {
    expect(sceneById('finale')?.snapshot.phase).toBe('finished');
    expect(sceneById('nope')).toBeNull();
  });

  it('每个场景都有中文标题与一句话说明', () => {
    for (const s of SCENES) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.note.length).toBeGreaterThan(0);
    }
  });
});

describe('fixture 合法性(生产 schema 构造)', () => {
  it('每个场景五席、human 固定、相位合法', () => {
    for (const s of SCENES) {
      expect(s.snapshot.players).toHaveLength(5);
      expect(s.snapshot.id).toBe('scene');
      expect(s.snapshot.human.playerId).toBe('human');
      expect(['describing', 'voting', 'finished']).toContain(s.snapshot.phase);
    }
  });

  it('选票只指向真实席位', () => {
    for (const s of SCENES) {
      const seats = new Set(s.snapshot.players.map((p) => p.id));
      for (const v of s.snapshot.votes) {
        expect(seats.has(v.voterId)).toBe(true);
        expect(seats.has(v.targetId)).toBe(true);
      }
    }
  });

  it('投票/平票场景:可投目标为存活非人类;平票 ballot=2', () => {
    for (const id of ['vote', 'tie']) {
      const s = sceneById(id)!;
      expect(s.snapshot.eligibleTargetIds).toEqual(['ai-1', 'ai-2', 'ai-3', 'ai-4']);
      for (const target of s.snapshot.eligibleTargetIds!) {
        const p = s.snapshot.players.find((x) => x.id === target)!;
        expect(p.alive).toBe(true);
        expect(p.isHuman).toBe(false);
      }
    }
    expect(sceneById('tie')!.snapshot.ballot).toBe(2);
  });

  it('出局场景:恰一名非人类死席且未终局', () => {
    const s = sceneById('elimination')!;
    const dead = s.snapshot.players.filter((p) => !p.alive);
    expect(dead).toHaveLength(1);
    expect(dead[0]!.isHuman).toBe(false);
    expect(s.snapshot.phase).not.toBe('finished');
  });

  it('终局前不揭示任何身份/密词,胜负与复盘为空', () => {
    for (const s of SCENES.filter((x) => x.snapshot.phase !== 'finished')) {
      expect(s.snapshot.winner).toBeNull();
      expect(s.snapshot.review).toBeNull();
      for (const p of s.snapshot.players) {
        expect(p.revealedRole ?? null).toBeNull();
        expect(p.revealedWord ?? null).toBeNull();
      }
    }
  });

  it('终局场景:全员揭示 + 胜负/复盘齐备', () => {
    const s = sceneById('finale')!;
    expect(s.snapshot.winner).not.toBeNull();
    expect(s.snapshot.review).not.toBeNull();
    for (const p of s.snapshot.players) {
      expect(p.revealedRole).toBeTruthy();
      expect(p.revealedWord).toBeTruthy();
    }
  });

  it('高光 reel:可用、证据接地、默认层剧透安全', () => {
    const s = sceneById('highlight')!;
    expect(s.highlights?.available).toBe(true);
    expect(s.highlights!.cards.length).toBeGreaterThan(0);
    for (const card of s.highlights!.cards) {
      expect(card.citedEventIds.length).toBeGreaterThan(0);
      expect('role' in card).toBe(false);
      expect('word' in card).toBe(false);
    }
    // 默认层 JSON 里不允许出现任何阵营字样(剧透安全)。
    expect(JSON.stringify(s.highlights)).not.toMatch(/civilian|undercover/);
  });
});

describe('任务 4.3 结构证明:场景层无从触达写路径', () => {
  it.each(['scenes.ts', 'harness.tsx'])('%s 不引用 api 模块、无任何写调用', (file) => {
    const text = src(file);
    expect(text).not.toMatch(/from ['"]\.\.\/api['"]/);
    expect(text).not.toMatch(/\bapi\./);
  });

  it('harness 由 DEV 守卫动态加载(main.tsx),且自身带生产拒绝闸', () => {
    const main = src('../main.tsx');
    expect(main).toMatch(/import\.meta\.env\.DEV/);
    expect(main).toMatch(/import\(['"]\.\/scenes\/harness['"]\)/);

    const harness = src('harness.tsx');
    expect(harness).toMatch(/import\.meta\.env\.DEV/);
    expect(harness).toMatch(/throw new Error\('SceneHarness 仅限开发构建/);
  });
});
