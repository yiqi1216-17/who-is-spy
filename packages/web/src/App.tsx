import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api } from './api';
import type { GodGameState, PublicGameState } from './types';
import {
  eliminatedRevealed,
  interactionMode,
  planBeats,
  testimonyHold,
  type Beat,
  type Interaction,
  type Spotlight,
} from './director';
import { followGame, type Follower, type PreviewFrame } from './stream';
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

  // 生成途中已被 SSE 预告帧直播过的证词/票键(`round:playerId` / `v:round:voterId`):
  // 命令返回后 planBeats 据此只做快速回带,不再全时长重放(异步发言感)。
  const liveSeenRef = useRef<Set<string>>(new Set());

  // 生成途中已直播的瞬态发言缓冲(体验修复:直播留痕):
  // 权威 events 要等命令返回才落库,期间用户翻「公开记录」抽屉会扑空——这里把逐句/逐票预告
  // 暂存进来,抽屉以「直播中」态呈现;命令返回、权威事件补齐后即整体清空(以 GET 为准)。
  const [livePreviews, setLivePreviews] = useState<PreviewFrame[]>([]);

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

  // —— 生成直播(体验修复:异步发言感 + 直播留痕)——
  // 每局挂一条 SSE:AI 每说完一句 / 投出一票,服务端立刻推瞬态预告帧;此刻 HTTP 命令仍在途、
  // 放映队列空转,预告帧直接点亮席位与聚光,并写进 livePreviews 供「公开记录」抽屉即时呈现。
  // 命令返回后 planBeats 见 liveSeen 只做 0.6s 快速回带,状态机/揭示记账照常,权威性不受影响。
  const gameId = game?.id ?? null;
  useEffect(() => {
    if (!gameId) return;
    liveSeenRef.current = new Set();
    setLivePreviews([]);
    let follower: Follower | null = null;
    let clearTimer: number | undefined;
    const applyPreview = (frame: PreviewFrame): void => {
      // 键区分描述与投票,避免同轮 round:playerId 撞车(投票键加 `v:` 前缀)。
      const seenKey =
        frame.kind === 'vote' ? `v:${frame.round}:${frame.playerId}` : `${frame.round}:${frame.playerId}`;
      liveSeenRef.current.add(seenKey);
      // 抽屉留痕:同键去重后追加(重连补发/重复帧不重复入列)。
      setLivePreviews((prev) =>
        prev.some((p) => p.kind === frame.kind && p.round === frame.round && p.playerId === frame.playerId)
          ? prev
          : [...prev, frame],
      );
      setView((prev) => ({
        ...prev,
        focusId: frame.playerId,
        suspectId: frame.kind === 'vote' ? frame.targetId ?? prev.suspectId : prev.suspectId,
        spotlight: {
          speakerId: frame.playerId,
          text: frame.text,
          muted: false,
          kind: frame.kind === 'vote' ? 'vote' : 'testimony',
        },
      }));
      // 一句/一票读完后回到「斟酌中」留白,等下一帧;命令返回起播时该定时器已被新拍覆盖。
      if (clearTimer !== undefined) window.clearTimeout(clearTimer);
      clearTimer = window.setTimeout(() => {
        setView((prev) =>
          prev.focusId === frame.playerId ? { ...prev, focusId: null, spotlight: null } : prev,
        );
      }, testimonyHold(frame.text));
    };
    try {
      follower = followGame(gameId, {
        onEvent: () => {}, // 权威事件仍由 HTTP 响应统一放映(单一放映管线)
        onPreview: applyPreview,
      });
    } catch {
      // EventSource 不可用(极老环境):静默回退为原「等待→整段放映」体验。
    }
    return () => {
      if (clearTimer !== undefined) window.clearTimeout(clearTimer);
      follower?.close();
    };
  }, [gameId]);

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
    setLivePreviews([]);
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
    if (!game || busy) return; // busy 防重入:真实模型一轮 30–90s,连点会重复提交
    const text = description.trim();
    if (text.length < 2) return;
    const from = game.events.length;
    setBusy(true);
    setError('');
    try {
      const next = await api.describe(game.id, text);
      setGame(next);
      setLivePreviews([]); // 权威事件已落库,清空直播缓冲(改由 events 呈现)
      setDescription('');
      dispatch({ type: 'HUMAN_DESCRIBED' });
      startSegment(planBeats(next, from, 'testimony', liveSeenRef.current));
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }, [game, busy, description, handleFailure, startSegment]);

  const onVote = useCallback(async () => {
    if (!game || !selectedTarget || busy) return;
    const from = game.events.length;
    const wasHumanAction = pres.phase === 'human-action';
    setBusy(true);
    setError('');
    try {
      const next = await api.vote(game.id, selectedTarget);
      setGame(next);
      setLivePreviews([]); // 权威票型已落库,清空直播缓冲
      setSelectedTarget('');
      if (wasHumanAction) dispatch({ type: 'HUMAN_VOTED' });
      startSegment(planBeats(next, from, 'voting', liveSeenRef.current));
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }, [game, busy, selectedTarget, pres.phase, handleFailure, startSegment]);

  const onContinue = useCallback(async () => {
    if (!game || busy) return;
    const from = game.events.length;
    setBusy(true);
    setError('');
    try {
      const next = await api.continue(game.id);
      setGame(next);
      setLivePreviews([]); // 权威事件已落库,清空直播缓冲
      startSegment(planBeats(next, from, pres.phase, liveSeenRef.current));
    } catch (cause) {
      handleFailure(cause);
    } finally {
      setBusy(false);
    }
  }, [game, busy, pres.phase, handleFailure, startSegment]);

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
        livePreviews={livePreviews}
        spotlight={view.spotlight}
        focusId={view.focusId}
        suspectId={view.suspectId}
        banner={view.banner}
        thinking={busy}
        busy={busy}
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
      {/* 观测台入口(任务线③前端呈现):仅 DEV 可见;生产构建里整段被静态消除。 */}
      {import.meta.env.DEV && (
        <a className="ops-entry" href="/ops.html" title="评测面板 · trace 视图 · 故障注入(仅开发环境)">
          ◉ 观测台
        </a>
      )}
    </div>
  );
}
