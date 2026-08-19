import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api } from './api';
import type { GodGameState, PublicGameState } from './types';
import {
  eliminatedRevealed,
  interactionMode,
  planBeats,
  type Beat,
  type Interaction,
  type Spotlight,
} from './director';
import { initialState, overlay, reduce } from './presentation/machine';
import { HomeScreen, type HomeMode } from './screens/HomeScreen';
import { RevealScreen } from './screens/RevealScreen';
import { StageScreen } from './screens/StageScreen';
import { FinaleScreen } from './screens/FinaleScreen';
import { GodScreen } from './screens/GodScreen';

/**
 * 编排器(OpenSpec 05-H · 决策 2/3 · 任务 3.x)
 *
 * 把三样东西缝合成一台戏:
 *  1) `api` —— 同步服务端契约(describe/vote/continue 各返回整段新公开事件);
 *  2) `director` —— 把「事件增量」线性化为一串 `Beat`(逐拍揭示,单/多轮共用管线);
 *  3) `machine` —— 纯 reducer 编排剧场 phase 与幂等闸。
 *
 * 关键设计:
 *  - 放映是**客户端对已知数据的定时揭示**——一个 beat 队列 + 定时器逐拍推进(`appliedRef` 抗 StrictMode 重入)。
 *  - 行动闸(dock)以**服务端 game 为权威**(`interactionMode`),天然处理平票复投(机器仍停在 voting)。
 *  - 网络轴与剧场正交:断线只派 `NET_LOST`(叠层),绝不改动正在播放的镜头。
 */

interface View {
  focusId: string | null;
  suspectId: string | null;
  spotlight: Spotlight | null;
  banner: string | null;
}
const EMPTY_VIEW: View = { focusId: null, suspectId: null, spotlight: null, banner: null };

export function App() {
  const [pres, dispatch] = useReducer(reduce, undefined, initialState);
  const [game, setGame] = useState<PublicGameState | null>(null);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [model, setModel] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');
  const [selectedTarget, setSelectedTarget] = useState('');

  // —— 双模式:首屏选择玩家/上帝;上帝态独立于玩家状态机(自成一套放映) ——
  const [homeMode, setHomeMode] = useState<HomeMode>('human');
  const [godGame, setGodGame] = useState<GodGameState | null>(null);
  const [godBusy, setGodBusy] = useState(false);
  const [godError, setGodError] = useState('');

  // 放映队列:beats[beatIndex] 由播放 effect 逐拍应用。
  const [beats, setBeats] = useState<Beat[]>([]);
  const [beatIndex, setBeatIndex] = useState(0);
  const [view, setView] = useState<View>(EMPTY_VIEW);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());
  const appliedRef = useRef<Set<string>>(new Set());

  const queueEmpty = beatIndex >= beats.length;

  // —— 开机自检:确认模型是否就席 ——
  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((health) => {
        if (!alive) return;
        setConfigured(health.configured);
        setModel(health.model);
      })
      .catch(() => alive && setConfigured(false));
    return () => {
      alive = false;
    };
  }, []);

  // —— 播放 effect:应用当前拍 → 定时推进下一拍 ——
  useEffect(() => {
    if (beatIndex >= beats.length) return;
    const beat = beats[beatIndex];
    if (!appliedRef.current.has(beat.id)) {
      appliedRef.current.add(beat.id);
      if (beat.machine) dispatch(beat.machine);
      setView((prev) => ({
        focusId: beat.focusId !== undefined ? beat.focusId : prev.focusId,
        suspectId: beat.suspectId !== undefined ? beat.suspectId : prev.suspectId,
        spotlight: beat.spotlight !== undefined ? beat.spotlight : prev.spotlight,
        banner: beat.banner !== undefined ? beat.banner : prev.banner,
      }));
      if (beat.reveals) {
        const id = beat.reveals;
        setRevealed((prev) => new Set(prev).add(id));
      }
    }
    const timer = setTimeout(() => setBeatIndex((index) => index + 1), beat.hold);
    return () => clearTimeout(timer);
  }, [beatIndex, beats]);

  // —— 轮次横幅是瞬时的:出现后短暂停留即隐去 ——
  useEffect(() => {
    if (!view.banner) return;
    const timer = setTimeout(() => setView((prev) => ({ ...prev, banner: null })), 1200);
    return () => clearTimeout(timer);
  }, [view.banner]);

  // —— 首轮开场:落到 round-intro 且队列已空(仅发生在 REVEAL_DONE 之后)→ 触发开局 ——
  useEffect(() => {
    if (pres.phase !== 'round-intro' || !game || !queueEmpty) return;
    const human = game.players.find((player) => player.isHuman);
    const humanTurn =
      !!human?.alive &&
      game.phase === 'describing' &&
      !game.descriptions.some((item) => item.playerId === human.id && item.round === game.round);
    dispatch({ type: 'INTRO_DONE', humanTurn });
  }, [pres.phase, game, queueEmpty]);

  const startSegment = useCallback((plan: Beat[]) => {
    setBeats(plan);
    setBeatIndex(0);
  }, []);

  const handleFailure = useCallback((cause: unknown) => {
    if (cause instanceof TypeError) {
      dispatch({ type: 'NET_LOST' });
    } else {
      setError(cause instanceof Error ? cause.message : '出了点问题，请重试');
    }
  }, []);

  const resetAll = useCallback(() => {
    dispatch({ type: 'RESET' });
    setGame(null);
    setBeats([]);
    setBeatIndex(0);
    appliedRef.current = new Set();
    setRevealed(new Set());
    setView(EMPTY_VIEW);
    setError('');
    setDescription('');
    setSelectedTarget('');
  }, []);

  // —— 上帝模式:一次性解算整桌全 AI 对局(耗时较长),再交给 GodScreen 逐拍放映 ——
  const startGod = useCallback(async () => {
    setGodError('');
    setGodGame(null);
    setGodBusy(true);
    try {
      const created = await api.createGodGame();
      setGodGame(created);
    } catch (cause) {
      setGodError(cause instanceof Error ? cause.message : '解算失败，请重试');
    } finally {
      setGodBusy(false);
    }
  }, []);

  const exitGod = useCallback(() => {
    setGodBusy(false);
    setGodGame(null);
    setGodError('');
  }, []);

  // —— 动作:开局(按模式分派) / 揭示完成 / 描述 / 投票 / 旁观推进 ——
  const onStart = useCallback(async () => {
    if (homeMode === 'god') {
      await startGod();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const created = await api.createGame();
      setGame(created);
      dispatch({ type: 'START' });
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }, [homeMode, startGod, handleFailure]);

  const onDescribe = useCallback(async () => {
    if (!game) return;
    const text = description.trim();
    if (text.length < 2) return;
    const from = game.events.length;
    setBusy(true);
    setError('');
    try {
      const next = await api.describe(game.id, text);
      setGame(next);
      setDescription('');
      dispatch({ type: 'HUMAN_DESCRIBED' });
      startSegment(planBeats(next, from, 'testimony'));
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }, [game, description, handleFailure, startSegment]);

  const onVote = useCallback(async () => {
    if (!game || !selectedTarget) return;
    const from = game.events.length;
    const wasHumanAction = pres.phase === 'human-action';
    setBusy(true);
    setError('');
    try {
      const next = await api.vote(game.id, selectedTarget);
      setGame(next);
      setSelectedTarget('');
      if (wasHumanAction) dispatch({ type: 'HUMAN_VOTED' });
      startSegment(planBeats(next, from, 'voting'));
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }, [game, selectedTarget, pres.phase, handleFailure, startSegment]);

  const onContinue = useCallback(async () => {
    if (!game) return;
    const from = game.events.length;
    setBusy(true);
    setError('');
    try {
      const next = await api.continue(game.id);
      setGame(next);
      startSegment(planBeats(next, from, pres.phase));
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }, [game, pres.phase, handleFailure, startSegment]);

  const onRetry = useCallback(async () => {
    dispatch({ type: 'NET_RETRYING' });
    try {
      await api.health();
      dispatch({ type: 'NET_OK' });
    } catch {
      dispatch({ type: 'NET_LOST' });
    }
  }, []);

  // —— 渲染路由:以剧场 phase 为准 ——
  const overlayKind = overlay(pres);
  const mode: Interaction =
    game && pres.phase !== 'home'
      ? interactionMode(game, { queueEmpty, online: pres.network === 'live' })
      : 'none';

  let screen;
  if (godBusy || godGame) {
    screen = (
      <GodScreen
        game={godGame}
        loading={godBusy}
        error={godError}
        onExit={exitGod}
        onReplay={startGod}
      />
    );
  } else if (!game || pres.phase === 'home') {
    screen = (
      <HomeScreen
        configured={configured}
        model={model}
        busy={busy}
        error={error}
        mode={homeMode}
        onModeChange={setHomeMode}
        onStart={onStart}
      />
    );
  } else if (pres.phase === 'role-reveal') {
    screen = <RevealScreen game={game} onDone={() => dispatch({ type: 'REVEAL_DONE' })} />;
  } else if (pres.phase === 'finale' || pres.phase === 'highlights' || pres.phase === 'replay') {
    screen = <FinaleScreen game={game} onRestart={resetAll} />;
  } else {
    screen = (
      <StageScreen
        game={game}
        spotlight={view.spotlight}
        focusId={view.focusId}
        suspectId={view.suspectId}
        banner={view.banner}
        thinking={busy}
        mode={mode}
        description={description}
        selectedTarget={selectedTarget}
        error={error}
        overlayKind={overlayKind}
        eliminatedRevealed={eliminatedRevealed(game.events, revealed)}
        onDescriptionChange={setDescription}
        onDescribe={onDescribe}
        onSelectTarget={(id) => setSelectedTarget((prev) => (prev === id ? '' : id))}
        onVote={onVote}
        onContinue={onContinue}
        onExit={resetAll}
        onRetry={onRetry}
      />
    );
  }

  return (
    <div className="app-frame">
      <div className="paper-noise" />
      <main className="stage">{screen}</main>
    </div>
  );
}
