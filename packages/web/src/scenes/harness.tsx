import './harness.css';
import { useState } from 'react';
import { RevealScreen } from '../screens/RevealScreen';
import { FinaleScreen } from '../screens/FinaleScreen';
import {
  initialState,
  overlay,
  run,
  type PresentationEvent,
  type PresentationState,
} from '../presentation/machine';
import type { GameEvent, PublicGameState, PublicPlayer } from '../types';
import { SCENES, sceneById, type SceneFixture } from './scenes';

/** 公开选票行:直接从生产 DTO 取型,场景与线上同一 schema。 */
type SceneVote = PublicGameState['votes'][number];

/**
 * 开发态场景驱动(OpenSpec 05-H · 任务 4.2)
 *
 * 把 `scenes.ts` 的确定性生产 schema 快照渲染成可视场景,供开发/截图矩阵(任务 4.4)使用。
 * 三条铁律,对应任务 4.3「生产禁用 + fixture 不可改真局」:
 *   1. 本模块**从不引用 api 模块**——没有任何写命令能被触发,场景纯本地渲染,结构上无法改动真实对局。
 *   2. 由 `main.tsx` 用 `import.meta.env.DEV` 守卫**动态** import;生产构建里整段被静态消除,不进 bundle。
 *      本组件另带运行时拒绝闸(双保险):非开发构建直接抛错。
 *   3. 复用真实 RevealScreen / FinaleScreen;网络叠层与逐拍回放经**真实表现层状态机**(machine.ts)演算,
 *      与线上呈现同源。
 */
export function SceneHarness({ sceneId }: { sceneId: string }) {
  if (!import.meta.env.DEV) {
    // 任务 4.3:生产构建双保险——本组件既被 DCE 剔除,万一被引用也拒绝渲染。
    throw new Error('SceneHarness 仅限开发构建(import.meta.env.DEV)。');
  }
  const [current, setCurrent] = useState(sceneId);
  const scene = sceneById(current);

  return (
    <div className="sh-root">
      <SceneSwitcher currentId={current} onPick={setCurrent} />
      <div className="sh-stage">
        {scene ? <SceneView key={scene.id} scene={scene} /> : <UnknownScene id={current} />}
      </div>
    </div>
  );
}

function SceneView({ scene }: { scene: SceneFixture }) {
  const { snapshot } = scene;

  // 逐拍回放:用真实状态机跑既定事件脚本(见 ReplayStrip)。
  if (scene.replay) {
    return <ReplayStrip scene={scene} />;
  }

  // 终局/高光:复用真实 FinaleScreen(其高光 tab 按 gameId 拉取,场景 id='scene' 会 404 并优雅降级;
  // fixture 自带的剧透安全 reel 在框顶注明,身份/复盘/票局三视图照常呈现)。
  if (snapshot.phase === 'finished') {
    return (
      <div className="sh-frame">
        {scene.highlights && (
          <div className="sh-reelnote">
            fixture 高光 reel:{scene.highlights.cards.length} 张卡(默认剧透安全层)
          </div>
        )}
        <FinaleScreen game={snapshot} onRestart={noop} />
      </div>
    );
  }

  // 开局身份揭晓:复用真实 RevealScreen。
  if (scene.id === 'role-reveal') {
    return (
      <div className="sh-frame">
        <RevealScreen game={snapshot} onDone={noop} />
      </div>
    );
  }

  // 其余(证词/投票/平票/出局/失败/重连):检视器呈现快照 + 经真实状态机派生的网络叠层。
  return <StageInspector scene={scene} />;
}

/**
 * 舞台检视器:快照直读生产 DTO;failure/reconnect 叠层**不是**手写布尔,
 * 而是把 NET_LOST / NET_RETRYING 喂进真实 machine.run 后经 overlay() 派生——
 * 网络轴与剧场 phase 的正交性由此与线上同源(任务 1.2/3.4 的同一台机器)。
 */
function StageInspector({ scene }: { scene: SceneFixture }) {
  const { snapshot } = scene;
  const net: PresentationState =
    scene.overlay === 'failure'
      ? run([{ type: 'NET_LOST' }])
      : scene.overlay === 'reconnect'
        ? run([{ type: 'NET_RETRYING' }])
        : initialState();
  const mask = overlay(net);

  return (
    <div className="sh-frame">
      <div className="sh-inspector">
        <div className="sh-meta">
          <span className={`sh-phase ${snapshot.phase}`}>{phaseName(snapshot.phase)}</span>
          <span>第 {snapshot.round} 轮 · 第 {snapshot.ballot} 票</span>
          {mask && <span className={`sh-overlay ${mask}`}>{overlayName(mask)}</span>}
        </div>

        <div className="sh-seats">
          {snapshot.players.map((player: PublicPlayer) => (
            <div key={player.id} className={`sh-seat ${player.alive ? '' : 'out'}`}>
              <span className="sh-av">{player.avatar}</span>
              <span className="sh-nm">{player.name}</span>
              {!player.alive && <span className="sh-tag">出局</span>}
            </div>
          ))}
        </div>

        {snapshot.eligibleTargetIds && (
          <div className="sh-eligible">
            <span className="sh-dim">可投:</span>
            {snapshot.eligibleTargetIds.map((id: string) => (
              <span key={id} className="sh-chip">
                {nameOf(snapshot.players, id)}
              </span>
            ))}
          </div>
        )}

        {snapshot.votes.length > 0 && (
          <div className="sh-votes">
            <span className="sh-dim">票:</span>
            {snapshot.votes.map((vote: SceneVote, index: number) => (
              <span key={index} className="sh-vote">
                {nameOf(snapshot.players, vote.voterId)} → {nameOf(snapshot.players, vote.targetId)}
              </span>
            ))}
          </div>
        )}

        <ol className="sh-events">
          {snapshot.events.map((event: GameEvent) => (
            <li key={event.id} className={`sh-ev ${event.type}`}>
              <span className="sh-evr">R{event.round}</span>
              <span className="sh-evt">{event.text}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** 逐拍回放脚本:开局 → 两段证词 → 人类投票 → 平票复投 → 决出出局 → 终局。 */
const REPLAY_SCRIPT: readonly PresentationEvent[] = [
  { type: 'START' },
  { type: 'REVEAL_DONE' },
  { type: 'INTRO_DONE', humanTurn: false },
  { type: 'TESTIMONY_START', speakerId: 'ai-1' },
  { type: 'TESTIMONY_DONE', next: 'more' },
  { type: 'TESTIMONY_START', speakerId: 'ai-2' },
  { type: 'TESTIMONY_DONE', next: 'human-vote' },
  { type: 'HUMAN_VOTED' },
  { type: 'BALLOT_DONE', outcome: 'tie', eventId: 'rp-b1' },
  { type: 'BALLOT_DONE', outcome: 'eliminated', eventId: 'rp-b2', focusId: 'ai-3' },
  { type: 'CONTINUE', finished: true, eventId: 'rp-c1' },
];

/**
 * 逐拍回放(replay 场景):cursor 每进一步就把脚本前缀重新折叠进真实 `machine.run`——
 * 呈现的 phase / 聚焦席位 / 已消费权威事件数全部出自线上同一台纯函数状态机。
 */
function ReplayStrip({ scene }: { scene: SceneFixture }) {
  const [cursor, setCursor] = useState(0);
  const state = run(REPLAY_SCRIPT.slice(0, cursor));
  const done = cursor >= REPLAY_SCRIPT.length;

  return (
    <div className="sh-frame">
      <div className="sh-inspector">
        <div className="sh-meta">
          <span className="sh-phase">{state.phase}</span>
          {state.focusId && (
            <span className="sh-chip">聚焦 {nameOf(scene.snapshot.players, state.focusId)}</span>
          )}
          <span className="sh-dim">已消费权威事件 {state.consumed.length}</span>
        </div>

        <div className="sh-beatbar">
          <button type="button" onClick={() => setCursor(0)}>
            ⏮ 回起点
          </button>
          <button
            type="button"
            disabled={done}
            onClick={() => setCursor((c) => Math.min(c + 1, REPLAY_SCRIPT.length))}
          >
            ▶ 下一拍
          </button>
          <span className="sh-cursor">
            {cursor} / {REPLAY_SCRIPT.length}
          </span>
        </div>

        <p className="sh-dim">
          {done
            ? '已到 finale——出局与终局只由带 eventId 的权威事件推进,重复投递会被幂等闸吞掉。'
            : '逐拍推进真实表现层状态机;完整终局画面见「终局揭晓」场景。'}
        </p>
      </div>
    </div>
  );
}

function SceneSwitcher({
  currentId,
  onPick,
}: {
  currentId: string;
  onPick: (id: string) => void;
}) {
  return (
    <nav className="sh-switch" aria-label="场景切换">
      <span className="sh-brand">场景驱动 · DEV</span>
      <div className="sh-tabs">
        {SCENES.map((scene) => (
          <button
            type="button"
            key={scene.id}
            className={scene.id === currentId ? 'on' : ''}
            aria-current={scene.id === currentId}
            title={scene.note}
            onClick={() => {
              onPick(scene.id);
              const url = new URL(window.location.href);
              url.searchParams.set('scene', scene.id);
              window.history.replaceState(null, '', url);
            }}
          >
            {scene.title}
          </button>
        ))}
      </div>
    </nav>
  );
}

function UnknownScene({ id }: { id: string }) {
  return (
    <div className="sh-frame sh-unknown">
      <p>
        未知场景:<code>{id}</code>
      </p>
      <p className="sh-dim">可选:{SCENES.map((s) => s.id).join(' / ')}</p>
    </div>
  );
}

function nameOf(players: readonly PublicPlayer[], id: string): string {
  return players.find((p) => p.id === id)?.name ?? id;
}

function phaseName(phase: PublicGameState['phase']): string {
  return phase === 'describing' ? '描述' : phase === 'voting' ? '投票' : '终局';
}

function overlayName(mask: 'failure' | 'reconnect'): string {
  return mask === 'failure' ? '⚠ 供应商故障' : '⟳ 断线重连';
}

function noop(): void {
  /* 场景是只读呈现:回调刻意为空,fixture 无从触发任何真实写入(任务 4.3)。 */
}
