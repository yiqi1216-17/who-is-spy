import { useState } from 'react';
import {
  ArrowRight,
  Eye,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  RotateCcw,
  ScrollText,
  Send,
  ShieldCheck,
  Target,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { characterFor, SEAT_ORDER } from '../characters';
import { StageBackdrop, type PortraitState } from '../art/portraits';
import { seatState, type Interaction, type Spotlight } from '../director';
import type { PublicGameState } from '../types';
import { Seat } from '../components/Seat';

/**
 * 对局舞台(OpenSpec 05-H · 决策 2/3 · 任务 3.1/3.2/5.1)
 *
 * 9:16 竖屏剧场:顶栏轮次 → 五席立绘竞技场(第一人称居中)→ 聚光证词 → 行动坞。
 * 放映由父级导演驱动,本屏只做**呈现**:席位状态、聚光文案、输入闸、公开记录抽屉、网络叠层。
 * 网络轴与剧场正交——断线只盖叠层,绝不改动正在播放的镜头。
 */
export interface StageProps {
  game: PublicGameState;
  spotlight: Spotlight | null;
  focusId: string | null;
  suspectId: string | null;
  banner: string | null;
  thinking: boolean;
  /** 命令请求在途(真实模型一轮 30–90s):行动坞必须给出等待反馈并防连点。 */
  busy: boolean;
  mode: Interaction;
  description: string;
  selectedTarget: string;
  error: string;
  overlayKind: 'failure' | 'reconnect' | null;
  eliminatedRevealed: ReadonlySet<string>;
  onDescriptionChange: (value: string) => void;
  onDescribe: () => void;
  onSelectTarget: (id: string) => void;
  onVote: () => void;
  onContinue: () => void;
  onExit: () => void;
  onRetry: () => void;
}

export function StageScreen(props: StageProps) {
  const { game, focusId, mode, eliminatedRevealed } = props;
  const [sheetOpen, setSheetOpen] = useState(false);

  const nameOf = (id?: string): string =>
    game.players.find((player) => player.id === id)?.name ?? '主持人';
  const aliveCount = game.players.filter((player) => player.alive).length;

  // 投票期由选中目标兼作嫌疑聚光;出局镜头由导演直接给 suspectId。
  const suspect = mode === 'vote' && props.selectedTarget ? props.selectedTarget : props.suspectId;

  const stateFor = (id: string): PortraitState =>
    seatState(game.players.find((player) => player.id === id)!, {
      focusId,
      suspectId: suspect,
      eliminatedRevealed,
    });

  const tagFor = (id: string): string => {
    if (eliminatedRevealed.has(id)) return '已出局';
    if (focusId === id) return '发言中';
    return id === 'human' ? '第一人称' : 'AI 玩家';
  };

  const selectableFor = (id: string): boolean =>
    mode === 'vote' &&
    id !== 'human' &&
    (game.players.find((player) => player.id === id)?.alive ?? false) &&
    (game.eligibleTargetIds === null || game.eligibleTargetIds.includes(id));

  const accent = characterFor(focusId ?? 'human').palette.accent;

  return (
    <div className="play">
      <StageBackdrop accent={accent} />

      <div className="play-top">
        <div className="round-track">
          <b>第 {game.round} 轮</b>
          <i />
          <span className={`step ${game.phase === 'describing' ? 'active' : ''}`}>描述</span>
          <i />
          <span className={`step ${game.phase === 'voting' ? 'active' : ''}`}>
            投票{game.ballot > 1 ? ' · 加票' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="chip" title="你的密词（仅你可见）">
            <LockKeyhole size={13} />
            {game.human.word}
          </span>
          <button className="icon-btn" onClick={props.onExit} aria-label="退出牌局">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      <div className="arena">
        {SEAT_ORDER.map((id, index) => (
          <div className={`arena-ai pos-${index}`} key={id}>
            <Seat
              character={characterFor(id)}
              state={stateFor(id)}
              tag={tagFor(id)}
              selectable={selectableFor(id)}
              selected={props.selectedTarget === id}
              onSelect={() => props.onSelectTarget(id)}
            />
          </div>
        ))}

        <div className="arena-table" aria-hidden="true">
          <span className="r">R{String(game.round).padStart(2, '0')}</span>
          <span className="mark">潜</span>
          <small>{aliveCount} 人在场</small>
        </div>

        <div className="arena-human">
          <Seat character={characterFor('human')} state={stateFor('human')} tag={tagFor('human')} />
        </div>

        {props.banner && (
          <div className="round-flash" key={props.banner}>
            <span>{props.banner}</span>
          </div>
        )}
      </div>

      <Spotlightlet spotlight={props.spotlight} thinking={props.thinking} who={nameOf(props.spotlight?.speakerId ?? undefined)} mode={mode} />

      <button className="record-tab" onClick={() => setSheetOpen(true)}>
        <span className="live" />
        <ScrollText size={14} />
        公开记录 · {game.events.length}
      </button>

      <Dock {...props} />

      {sheetOpen && (
        <RecordSheet game={game} nameOf={nameOf} onClose={() => setSheetOpen(false)} />
      )}

      {props.overlayKind && (
        <NetOverlay kind={props.overlayKind} onRetry={props.onRetry} />
      )}
    </div>
  );
}

function Spotlightlet({
  spotlight,
  thinking,
  who,
  mode,
}: {
  spotlight: Spotlight | null;
  thinking: boolean;
  who: string;
  mode: Interaction;
}) {
  const kicker =
    mode === 'describe'
      ? '轮到你描述'
      : mode === 'vote'
        ? '投出你的一票'
        : spotlight?.kind === 'vote'
          ? '投票'
          : spotlight?.speakerId
            ? '证词'
            : '主持人';

  return (
    <div className="spotlight">
      <div className="spotlight-head">
        <span className="who">{spotlight?.speakerId ? who : '主持人'}</span>
        <span>{kicker}</span>
      </div>
      {spotlight ? (
        <p className={`spotlight-quote ${spotlight.muted ? 'muted' : ''}`}>{spotlight.text}</p>
      ) : (
        <p className="spotlight-quote muted">
          {thinking ? 'AI 玩家正在酝酿说辞…' : mode === 'describe' ? '组织一句不露密词的描述。' : '牌局静默片刻。'}
          {thinking && (
            <span className="thinking" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function Dock(props: StageProps) {
  const { mode, game } = props;

  if (mode === 'describe') {
    // 已提交:AI 逐个发言并经预告帧实时直播到上方聚光区;此处只留轻量进度说明。
    if (props.busy) {
      return (
        <div className="dock">
          <div className="dock-spectator" aria-live="polite">
            <LoaderCircle className="spin" size={20} />
            <div>
              <strong>描述已提交</strong>
              <small>四位 AI 正在依次发言——每说完一句会实时亮在上方聚光区</small>
            </div>
          </div>
        </div>
      );
    }
    const length = props.description.trim().length;
    return (
      <div className="dock">
        <div className="dock-head">
          <MessageCircleMore size={18} />
          <div>
            <strong>轮到你描述</strong>
            <span>不要出现密词原文 · 2–60 字</span>
          </div>
        </div>
        <div className="describe-field">
          <textarea
            value={props.description}
            onChange={(event) => props.onDescriptionChange(event.target.value)}
            placeholder="例如：它常在安静的时候出现…"
            maxLength={60}
            rows={2}
            aria-label="你的描述"
          />
          <span className="count">{length}/60</span>
          <button
            className="send-btn"
            onClick={props.onDescribe}
            disabled={length < 2}
            aria-label="提交描述"
          >
            <Send size={18} />
          </button>
        </div>
        {props.error && <ErrorLine message={props.error} />}
      </div>
    );
  }

  if (mode === 'vote') {
    const chosen = game.players.find((player) => player.id === props.selectedTarget);
    return (
      <div className="dock">
        <div className="dock-head">
          <Target size={18} />
          <div>
            <strong>{game.ballot > 1 ? '同票加赛 · 再选一次' : '选出最可疑的人'}</strong>
            <span>{chosen ? `已选择：${chosen.name}` : '点选上方立绘，再确认投票'}</span>
          </div>
        </div>
        <button
          className="btn btn-rust btn-block"
          onClick={props.onVote}
          disabled={!props.selectedTarget || props.busy}
        >
          {props.busy ? <LoaderCircle className="spin" size={17} /> : <Target size={17} />}
          {props.busy ? '计票中，稍候…' : `确认投给 ${chosen?.name ?? '…'}`}
        </button>
        {props.error && <ErrorLine message={props.error} />}
      </div>
    );
  }

  if (mode === 'spectate') {
    return (
      <div className="dock">
        <div className="dock-spectator">
          <Eye size={22} />
          <div>
            <strong>你已离席，牌局继续</strong>
            <small>以旁观视角推进 AI 的后续对局</small>
          </div>
        </div>
        <button className="btn btn-ink btn-block" onClick={props.onContinue} disabled={props.busy}>
          {props.busy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
          {props.busy ? 'AI 对局推进中，约需一分钟…' : '推进牌局'}
        </button>
        {props.error && <ErrorLine message={props.error} />}
      </div>
    );
  }

  // mode==='none'：放映进行中，保持沉浸留白。
  return (
    <div className="dock">
      <div className="dock-spectator" aria-live="polite">
        <LoaderCircle className="spin" size={20} />
        <div>
          <strong>本轮进行中</strong>
          <small>正在依次揭示每个人的发言</small>
        </div>
      </div>
    </div>
  );
}

function RecordSheet({
  game,
  nameOf,
  onClose,
}: {
  game: PublicGameState;
  nameOf: (id?: string) => string;
  onClose: () => void;
}) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label="公开记录">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h3>公开记录</h3>
          <button className="icon-btn" onClick={onClose} aria-label="收起记录" style={{ color: 'var(--ink-2)' }}>
            <X size={18} />
          </button>
        </div>
        <div className="sheet-body">
          {game.events.map((event, index) => (
            <div className={`event ${event.type}`} key={event.id} style={{ animationDelay: `${Math.min(index, 8) * 24}ms` }}>
              <span className="event-marker">
                {event.type === 'description' ? nameOf(event.playerId).slice(0, 1) : index + 1}
              </span>
              <div className="event-body">
                <small>
                  {event.type === 'description'
                    ? `${nameOf(event.playerId)} · 第 ${event.round} 轮`
                    : event.type === 'elimination'
                      ? '出局结果'
                      : event.type === 'vote_result'
                        ? '票型'
                        : '主持人'}
                </small>
                <p>{event.text}</p>
              </div>
            </div>
          ))}
          <div className="isolation-note">
            <ShieldCheck size={18} />
            <div>
              <strong>信息隔离已开启</strong>
              <span>每位 AI 仅接收自己的密词与此处公开记录，读不到他人身份。</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function NetOverlay({ kind, onRetry }: { kind: 'failure' | 'reconnect'; onRetry: () => void }) {
  if (kind === 'reconnect') {
    return (
      <div className="net-overlay" role="status">
        <div className="ring" />
        <h3>正在重连…</h3>
        <p>牌局镜头已暂存，连接恢复后继续。</p>
      </div>
    );
  }
  return (
    <div className="net-overlay" role="alertdialog" aria-label="连接中断">
      <WifiOff size={40} strokeWidth={1.5} />
      <h3>连接中断</h3>
      <p>与牌桌的连接断开了。你此刻看到的镜头不受影响，恢复后可继续行动。</p>
      <button className="btn btn-paper" onClick={onRetry}>
        <Wifi size={17} />
        重新连接
      </button>
    </div>
  );
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="inline-error" role="alert">
      <X size={15} />
      <span>{message}</span>
    </div>
  );
}
