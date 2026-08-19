import { useEffect, useMemo, useState } from 'react';
import {
  Brain,
  Crown,
  Eye,
  FastForward,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  ScrollText,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { characterFor, SEAT_ORDER } from '../characters';
import { Portrait, StageBackdrop, type PortraitState } from '../art/portraits';
import { godEliminated, planGodBeats, type GodBeat } from '../god-director';
import type { GodGameState, GodPlayerView } from '../types';

/**
 * 上帝放映厅(双模式 · 上帝模式 · 任务 #26)
 *
 * 一桌**全 AI** 对局的全知旁观:服务端一次性解算整局(含每步内心 OS),前端把它线性化为
 * 自走时间线逐拍放映。与玩家模式最大的不同——上帝可见**一切**:每席的身份/密词,以及每句
 * 公开发言背后那句**只对你显影**的心声(绝不回喂任何 agent、绝不落盘)。
 *
 * 自包含:自带放映时钟(暂停/快进/跳终局),不经玩家状态机。加载态覆盖 ~20–60s 的解算等待。
 */
export interface GodScreenProps {
  game: GodGameState | null;
  loading: boolean;
  error: string;
  onExit: () => void;
  onReplay: () => void;
}

export function GodScreen({ game, loading, error, onExit, onReplay }: GodScreenProps) {
  if (!game) return <GodLoading error={error} onExit={onExit} onReplay={onReplay} />;
  return <GodTheater game={game} onExit={onExit} onReplay={onReplay} />;
}

/** 解算等待:全 AI 桌需要真实模型跑完整局,给一个有呼吸感的候场。 */
function GodLoading({ error, onExit, onReplay }: { error: string; onExit: () => void; onReplay: () => void }) {
  return (
    <div className="screen god-loading">
      <StageBackdrop accent="#5b6b93" />
      <div className="god-loading-top">
        <span className="chip god-chip">
          <Eye size={13} />
          上帝视角
        </span>
        <button className="icon-btn" onClick={onExit} aria-label="返回首页">
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="god-loading-core">
        <div className="god-loading-portraits" aria-hidden="true">
          {SEAT_ORDER.map((id, index) => (
            <Portrait key={id} character={characterFor(id)} className={`glp glp-${index}`} emblem />
          ))}
        </div>

        {error ? (
          <>
            <h2>解算未能完成</h2>
            <p className="god-loading-note">{error}</p>
            <div className="god-loading-actions">
              <button className="btn btn-rust" onClick={onReplay}>
                <RotateCcw size={16} />
                重开一桌
              </button>
              <button className="btn btn-paper" onClick={onExit}>
                返回首页
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="god-loading-spin">
              <LoaderCircle className="spin" size={22} />
              正在解算整桌对局
            </span>
            <h2>四位 AI 正在独立入局</h2>
            <p className="god-loading-note">
              每位 AI 只看得到自己的密词，独立描述、独立投票。牌局全程跑完后，
              你将以<strong>全知视角</strong>逐拍回看——包括每个人不曾说出口的心声。
            </p>
            <div className="god-loading-bar" aria-hidden="true">
              <i />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 放映厅本体:自带时钟的全知逐拍回放 + 终局复盘。 */
function GodTheater({ game, onExit, onReplay }: { game: GodGameState; onExit: () => void; onReplay: () => void }) {
  const beats = useMemo(() => planGodBeats(game), [game]);
  const lastIndex = Math.max(0, beats.length - 1);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const beat: GodBeat | null = beats[index] ?? null;
  const atFinale = beat?.kind === 'finale';

  // 放映时钟:逐拍推进,停在终局拍;暂停即冻结当前镜头。
  useEffect(() => {
    if (paused || index >= lastIndex) return;
    const current = beats[index];
    const timer = setTimeout(() => setIndex((value) => Math.min(value + 1, lastIndex)), current.hold);
    return () => clearTimeout(timer);
  }, [index, lastIndex, paused, beats]);

  const eliminated = useMemo(() => godEliminated(beats, index), [beats, index]);
  const byId = useMemo(() => new Map(game.players.map((player) => [player.id, player])), [game.players]);
  const nameOf = (id: string | null): string => (id ? byId.get(id)?.name ?? '主持人' : '主持人');

  const stateFor = (id: string): PortraitState => {
    if (eliminated.has(id)) return 'eliminated';
    if (beat?.focusId === id) return 'speaking';
    if (beat?.suspectId === id) return 'suspect';
    return 'idle';
  };

  const aliveCount = game.players.filter((player) => !eliminated.has(player.id)).length;
  const speakerThought = beat?.kind === 'describe' ? beat.thought : null;
  const kicker =
    beat?.kind === 'vote' ? '投票'
      : beat?.kind === 'eliminate' ? '出局'
        : beat?.kind === 'tie' ? '平票'
          : beat?.kind === 'round' ? '开局'
            : beat?.kind === 'describe' ? '证词'
              : '主持人';

  return (
    <div className="play god-play">
      <StageBackdrop accent={characterFor(beat?.focusId ?? 'ai-3').palette.accent} />

      <div className="play-top">
        <div className="round-track">
          <span className="chip god-chip">
            <Eye size={13} />
            上帝视角
          </span>
          <i />
          <b>第 {beat?.round ?? 1} 轮</b>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="chip" title="在场人数">
            <UsersRound size={13} />
            {aliveCount} 人
          </span>
          <button className="icon-btn" onClick={onExit} aria-label="退出观战">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <div className="arena god-arena">
        {SEAT_ORDER.map((id, position) => {
          const player = byId.get(id);
          if (!player) return null;
          return (
            <div className={`arena-ai pos-${position}`} key={id}>
              <GodSeat player={player} state={stateFor(id)} speaking={beat?.focusId === id} />
            </div>
          );
        })}

        <div className="arena-table" aria-hidden="true">
          <span className="r">R{String(beat?.round ?? 1).padStart(2, '0')}</span>
          <span className="mark">潜</span>
          <small>{aliveCount} 人在场</small>
        </div>

        {beat?.kind === 'round' && (
          <div className="round-flash" key={`gr-${beat.round}`}>
            <span>{beat.text}</span>
          </div>
        )}
      </div>

      {/* 心声:仅上帝可见的内心独白,与公开证词并置对照。 */}
      <div className={`os-console ${speakerThought ? 'live' : 'idle'}`}>
        <div className="os-head">
          <Brain size={15} />
          <span>{speakerThought ? `${nameOf(beat?.focusId ?? null)} · 心声` : '心声 · 仅你可见'}</span>
        </div>
        <p>{speakerThought ?? '公开发言之外，这里显影每个 AI 的真实盘算。'}</p>
      </div>

      {/* 公开聚光:证词 / 票型 / 出局结果。 */}
      <div className="spotlight god-spotlight">
        <div className="spotlight-head">
          <span className="who">{beat?.speakerId ? nameOf(beat.speakerId) : '主持人'}</span>
          <span>{kicker}</span>
        </div>
        <p className={`spotlight-quote ${beat && (beat.kind === 'tie' || beat.kind === 'eliminate' || beat.kind === 'round') ? 'muted' : ''}`}>
          {beat?.text ?? '牌局静默片刻。'}
        </p>
      </div>

      {atFinale ? (
        <GodFinale game={game} onExit={onExit} onReplay={onReplay} />
      ) : (
        <GodControls
          index={index}
          total={beats.length}
          paused={paused}
          onToggle={() => setPaused((value) => !value)}
          onSkip={() => setIndex(lastIndex)}
        />
      )}
    </div>
  );
}

/** 全知席位:立绘 + 名号 + 身份/密词徽记(上帝可见)。 */
function GodSeat({ player, state, speaking }: { player: GodPlayerView; state: PortraitState; speaking: boolean }) {
  const character = characterFor(player.id);
  const spy = player.role === 'undercover';
  return (
    <div className={`seat god-seat ${state} ${speaking ? 'speaking' : ''}`}>
      <div className="seat-portrait">
        <Portrait character={character} state={state} emblem />
        {state === 'eliminated' && <span className="seat-strike">已出局</span>}
      </div>
      <span className="seat-name">{character.name}</span>
      <span className={`god-badge ${spy ? 'spy' : 'civ'}`}>
        <span className="god-badge-dot" />
        {spy ? '卧底' : '平民'} · {player.word}
      </span>
    </div>
  );
}

/** 放映控制坞:暂停/继续 + 进度 + 跳至终局。 */
function GodControls({
  index,
  total,
  paused,
  onToggle,
  onSkip,
}: {
  index: number;
  total: number;
  paused: boolean;
  onToggle: () => void;
  onSkip: () => void;
}) {
  const progress = total <= 1 ? 1 : index / (total - 1);
  return (
    <div className="dock god-dock">
      <button className="god-ctl" onClick={onToggle} aria-label={paused ? '继续放映' : '暂停放映'}>
        {paused ? <Play size={18} /> : <Pause size={18} />}
      </button>
      <div className="god-progress" aria-hidden="true">
        <i style={{ width: `${Math.round(progress * 100)}%` }} />
      </div>
      <span className="god-progress-num">
        {Math.min(index + 1, total)} / {total}
      </span>
      <button className="god-ctl" onClick={onSkip} aria-label="跳至终局">
        <FastForward size={18} />
      </button>
    </div>
  );
}

/** 上帝终局:胜负 + 全员身份密词 + AI 复盘,一屏收束。 */
function GodFinale({ game, onExit, onReplay }: { game: GodGameState; onExit: () => void; onReplay: () => void }) {
  const [tab, setTab] = useState<'identity' | 'review'>('identity');
  const spyWon = game.winner === 'undercover';
  const nameOf = (id: string): string => game.players.find((player) => player.id === id)?.name ?? '某位玩家';

  return (
    <div className="god-finale">
      <div className="god-finale-hero">
        <span className="winner-pill">
          <Crown size={14} />
          {spyWon ? '卧底阵营胜出' : '平民阵营胜出'}
        </span>
        <h2>真相揭晓</h2>
      </div>

      <div className="view-switch god-switch" role="tablist" aria-label="复盘视图">
        <button role="tab" aria-selected={tab === 'identity'} className={tab === 'identity' ? 'active' : ''} onClick={() => setTab('identity')}>
          <UsersRound size={14} /> 身份
        </button>
        <button role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          <ScrollText size={14} /> 复盘
        </button>
      </div>

      {tab === 'identity' ? (
        <div className="identity-grid god-identity">
          {game.players.map((player) => {
            const character = characterFor(player.id);
            const spy = player.role === 'undercover';
            return (
              <div className={`identity-card ${spy ? 'spy' : ''}`} key={player.id}>
                {spy && <span className="spy-tag">卧底</span>}
                <Portrait character={character} state={spy ? 'suspect' : 'idle'} emblem className="mini-pt" />
                <strong>{character.name}</strong>
                <span className="role">{spy ? '卧底' : '平民'}</span>
                <span className="word">{player.word}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="god-review">
          {game.review ? (
            <>
              <div className="summary-card">
                <Sparkles size={18} />
                <div>
                  <h3>{game.review.headline}</h3>
                  <p>{game.review.summary}</p>
                </div>
              </div>
              {game.review.turningPoints.length > 0 && (
                <div className="reel">
                  {game.review.turningPoints.map((point, position) => (
                    <div className="reel-item turn" key={position}>
                      <span className="rn">{String(position + 1).padStart(2, '0')}</span>
                      <p>{point}</p>
                    </div>
                  ))}
                </div>
              )}
              {game.review.playerInsights.map((item) => (
                <div className="insight" key={item.playerId}>
                  <Portrait character={characterFor(item.playerId)} state="idle" emblem className="mini-pt" />
                  <div>
                    <p>
                      <strong>{nameOf(item.playerId)}</strong>
                      {item.insight}
                    </p>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <p className="section-label">复盘生成中，稍后重开可见。</p>
          )}
        </div>
      )}

      <div className="god-finale-actions">
        <button className="btn btn-rust btn-block" onClick={onReplay}>
          <RotateCcw size={17} />
          再观一桌
        </button>
        <button className="btn btn-paper btn-block" onClick={onExit}>
          返回首页
        </button>
      </div>
    </div>
  );
}
