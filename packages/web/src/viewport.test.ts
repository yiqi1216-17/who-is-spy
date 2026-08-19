import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  initialState,
  isInputOpen,
  overlay,
  run,
  type PresentationEvent,
  type PresentationState,
} from './presentation/machine';

/**
 * 竖屏视口验收(OpenSpec 05-H · 任务 4.4)
 *
 * 题面点名四项:**安全区 / 输入可达性 / 动效 / 重连连续性**。
 * 本文件把四项各自钉成**确定性断言**,不依赖像素截图:
 *   - 安全区、无横向溢出、动效降级 → 断言 `styles.css` 的**令牌与裁切契约**(布局由令牌决定);
 *   - 输入可达性、重连连续性 → 断言**真实表现层 machine**(纯 reducer,与视口无关)。
 * 像素证据(截图/录屏)属呈现物料;本环境无浏览器驱动,边界已在证据文档如实记录。
 */

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, 'styles.css'), 'utf8');

/** 目标视口矩阵:题面基准 390×844,加窄屏下界与桌面上界。 */
const VIEWPORTS = [
  { name: '390×844(iPhone 14 基准)', width: 390, bleed: true },
  { name: '320×568(窄屏下界)', width: 320, bleed: true },
  { name: '1440×900(桌面)', width: 1440, bleed: false },
] as const;

/** 走到「人类行动」相位的最短权威路径。 */
const TO_HUMAN: readonly PresentationEvent[] = [
  { type: 'START' },
  { type: 'REVEAL_DONE' },
  { type: 'INTRO_DONE', humanTurn: true },
];

describe('任务 4.4 · 安全区与无横向溢出', () => {
  it('四向安全区令牌俱在,且 env() 带 0px 兜底', () => {
    for (const side of ['t', 'b', 'l', 'r']) {
      expect(css).toMatch(new RegExp(`--safe-${side}:\\s*env\\(safe-area-inset-\\w+,\\s*0px\\)`));
    }
  });

  it('舞台外壳四向都吃安全区,并取 max() 保底可视边距', () => {
    const frame = block('.app-frame');
    for (const side of ['t', 'r', 'b', 'l']) {
      expect(frame).toContain(`max(var(--safe-${side})`);
    }
  });

  it('屏面滚动容器禁横向滚动,纵向内衬安全区', () => {
    const screen = block('.screen');
    expect(screen).toContain('overflow-x: hidden');
    expect(screen).toContain('calc(var(--safe-t) + var(--s4))');
    expect(screen).toContain('calc(var(--safe-b) + var(--s5))');
  });

  it('舞台自身裁切溢出,宽度不越视口', () => {
    const stage = block('.stage');
    expect(stage).toContain('overflow: hidden');
    expect(stage).toContain('width: 100%');
    expect(stage).toContain('max-width: 452px');
  });

  it.each(VIEWPORTS)('$name:竖屏比例与全出血策略正确', ({ width, bleed }) => {
    if (bleed) {
      // 480px 以下:去圆角、解比例锁、满高全出血 —— 手机上不留死边。
      expect(width).toBeLessThanOrEqual(480);
      const mobile = mediaBlock('max-width: 480px');
      expect(mobile).toContain('max-width: none');
      expect(mobile).toContain('aspect-ratio: auto');
      expect(mobile).toContain('border-radius: 0');
      expect(mobile).toContain('padding: 0');
    } else {
      // 桌面:9:16 画框居中,不铺满宽屏。
      expect(width).toBeGreaterThan(480);
      expect(block('.stage')).toContain('aspect-ratio: 9 / 16');
      expect(block('.app-frame')).toContain('place-items: center');
    }
  });
});

describe('任务 4.4 · 动效可降级', () => {
  it('prefers-reduced-motion 全局兜底,动画与转场同时归零', () => {
    const reduce = mediaBlock('prefers-reduced-motion: reduce');
    expect(reduce).toMatch(/\*,\s*\*::before,\s*\*::after/);
    expect(reduce).toContain('animation-duration: 0.001ms !important');
    expect(reduce).toContain('animation-iteration-count: 1 !important');
    expect(reduce).toContain('transition-duration: 0.001ms !important');
  });

  it('场景驱动样式亦带 reduced-motion 分支', () => {
    expect(readFileSync(join(here, 'scenes', 'harness.css'), 'utf8')).toContain(
      '@media (prefers-reduced-motion: reduce)',
    );
  });

  it('读屏专用类不靠 display/visibility 隐藏,文本仍可达', () => {
    const srOnly = block('.sr-only');
    expect(srOnly).toContain('clip: rect(0, 0, 0, 0)');
    expect(srOnly).not.toContain('display: none');
    expect(srOnly).not.toContain('visibility: hidden');
  });
});

describe('任务 4.4 · 输入可达性(视口无关,由表现层裁决)', () => {
  it('人类回合开输入;AI 证词回合关闭,不留死按钮', () => {
    expect(isInputOpen(run(TO_HUMAN))).toBe(true);
    const ai = run([{ type: 'START' }, { type: 'REVEAL_DONE' }, { type: 'INTRO_DONE', humanTurn: false }]);
    expect(ai.phase).toBe('testimony');
    expect(isInputOpen(ai)).toBe(false);
  });

  it('断网即关输入 —— 不给出会丢的提交口', () => {
    const lost = run([...TO_HUMAN, { type: 'NET_LOST' }]);
    expect(overlay(lost)).toBe('failure');
    expect(isInputOpen(lost)).toBe(false);
  });
});

describe('任务 4.4 · 重连连续性', () => {
  it('重连叠层与剧场相位正交:盖叠层不动剧场进度与聚光', () => {
    const before = run(TO_HUMAN);
    const during = run([{ type: 'NET_RETRYING' }], before);
    expect(overlay(during)).toBe('reconnect');
    expect(during.phase).toBe(before.phase);
    expect(during.focusId).toBe(before.focusId);
  });

  it('重连成功回到原相位并恢复输入,不回退开局', () => {
    const mid = run(TO_HUMAN);
    const back = run([{ type: 'NET_RETRYING' }, { type: 'NET_OK' }], mid);
    expect(overlay(back)).toBeNull();
    expect(back.phase).toBe(mid.phase);
    expect(isInputOpen(back)).toBe(true);
  });

  it('重连后重复的权威事件被幂等吞掉,不二次推进', () => {
    const voting = run([...TO_HUMAN, { type: 'HUMAN_VOTED' }]);
    expect(voting.phase).toBe('voting');
    const ballot: PresentationEvent = {
      type: 'BALLOT_DONE',
      outcome: 'eliminated',
      eventId: 'ev-9',
      focusId: 'ai-3',
    };
    const once = run([ballot], voting);
    expect(once.phase).toBe('elimination');
    // 断线重连常见的重投同一条权威事件:整个状态逐字段不变。
    expect(run([ballot], once)).toEqual(once);
    expect(run([ballot, ballot], once).consumed).toEqual(once.consumed);
  });

  it('重开保留网络轴,不谎报连通性', () => {
    const offline = run([...TO_HUMAN, { type: 'NET_LOST' }, { type: 'RESET' }]);
    expect(offline.phase).toBe('home');
    expect(overlay(offline)).toBe('failure');
  });

  it('初始态无叠层,输入默认关闭', () => {
    const init: PresentationState = initialState();
    expect(overlay(init)).toBeNull();
    expect(isInputOpen(init)).toBe(false);
  });
});

/** 抽出某选择器的声明块(取首个匹配,足够钉契约)。 */
function block(selector: string): string {
  const at = css.indexOf(`\n${selector} {`);
  expect(at, `选择器 ${selector} 应存在于 styles.css`).toBeGreaterThan(-1);
  const start = css.indexOf('{', at);
  return css.slice(start, css.indexOf('}', start));
}

/** 抽出某 @media 查询整段(大括号配平扫描)。 */
function mediaBlock(query: string): string {
  const at = css.indexOf(`@media (${query})`);
  expect(at, `媒体查询 ${query} 应存在于 styles.css`).toBeGreaterThan(-1);
  const start = css.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}' && --depth === 0) return css.slice(start, i);
  }
  throw new Error(`媒体查询 ${query} 大括号未配平`);
}
