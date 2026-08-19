import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  Compass,
  Crosshair,
  Crown,
  EyeOff,
  Film,
  Link2,
  RotateCcw,
  Scale,
  ScrollText,
  ShieldCheck,
  Shuffle,
  Sparkle,
  Sparkles,
  Star,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { characterFor } from '../characters';
import { Portrait } from '../art/portraits';
import { api } from '../api';
import { citationLabel, formatMeasure, metaFor } from '../highlights';
import type { HighlightCard, HighlightReel, PublicGameState, Role } from '../types';

type Tab = 'identity' | 'highlights' | 'review' | 'ballot';

/** 图标名 → lucide 组件(highlights.ts 只存名字,保持其无 JSX 依赖)。 */
const HL_ICONS: Record<string, LucideIcon> = {
  Scale,
  Shuffle,
  ShieldCheck,
  Crosshair,
  EyeOff,
  Link2,
  Sparkle,
  Star,
};

/**
 * 终局复盘(OpenSpec 05-H · 任务 3.1/6.x)
 *
 * 只有走到 `phase==='finished'` 才解封域真相:全员身份/密词、胜负、AI 复盘。
 * 三视图切换——身份揭晓 / 局势复盘 / 票型回放——把一局信息在竖屏内层层展开。
 */
export function FinaleScreen({ game, onRestart }: { game: PublicGameState; onRestart: () => void }) {
  const [tab, setTab] = useState<Tab>('identity');
  const won = game.winner !== null && game.winner === game.human.role;
  const spyWon = game.winner === 'undercover';

  return (
    <div className="finale">
      <div className="finale-scroll">
        <header className="finale-hero">
          <span className={`result-stamp ${won ? '' : 'lose'}`}>{won ? '胜' : '负'}</span>
          <h1>{won ? '你赢了' : '你输了'}</h1>
          <span className="winner-pill">
            <Crown size={14} />
            {spyWon ? '卧底阵营胜出' : '平民阵营胜出'}
          </span>
          <p className="headline">
            {won
              ? '你读懂了这张牌桌上每一处措辞的重量。'
              : game.human.role === 'undercover'
                ? '伪装终究被那处细微的偏差出卖。'
                : '卧底把相似性利用到了最后一刻。'}
          </p>
        </header>

        <div className="finale-body">
          <div className="view-switch" role="tablist" aria-label="复盘视图">
            <Tabber tab={tab} value="identity" onSelect={setTab} icon={<UsersRound size={14} />} label="身份" />
            <Tabber tab={tab} value="highlights" onSelect={setTab} icon={<Film size={14} />} label="高光" />
            <Tabber tab={tab} value="review" onSelect={setTab} icon={<Compass size={14} />} label="复盘" />
            <Tabber tab={tab} value="ballot" onSelect={setTab} icon={<ScrollText size={14} />} label="票局" />
          </div>

          {tab === 'identity' && <IdentityView game={game} />}
          {tab === 'highlights' && <HighlightsView game={game} />}
          {tab === 'review' && <ReviewView game={game} />}
          {tab === 'ballot' && <BallotView game={game} />}
        </div>
      </div>

      <div className="finale-footer">
        <button className="btn btn-rust btn-block" onClick={onRestart}>
          <RotateCcw size={17} />
          再来一局
        </button>
      </div>
    </div>
  );
}

function Tabber({
  tab,
  value,
  onSelect,
  icon,
  label,
}: {
  tab: Tab;
  value: Tab;
  onSelect: (tab: Tab) => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => onSelect(value)}>
      {icon} {label}
    </button>
  );
}

function IdentityView({ game }: { game: PublicGameState }) {
  return (
    <section>
      <p className="section-label">
        <span>◆</span> 身份揭晓 · 全员密词
      </p>
      <div className="identity-grid">
        {game.players.map((player) => {
          const character = characterFor(player.id);
          const spy = player.revealedRole === 'undercover';
          return (
            <div className={`identity-card ${spy ? 'spy' : ''}`} key={player.id}>
              {spy && <span className="spy-tag">卧底</span>}
              <Portrait character={character} state={spy ? 'suspect' : 'idle'} emblem className="mini-pt" />
              <strong>
                {character.name}
                {player.isHuman ? ' · 你' : ''}
              </strong>
              <span className="role">{roleName(player.revealedRole)}</span>
              <span className="word">{player.revealedWord ?? '—'}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReviewView({ game }: { game: PublicGameState }) {
  const review = game.review;
  if (!review) {
    return <p className="section-label">复盘生成中，稍后重开可见。</p>;
  }
  return (
    <>
      <section>
        <div className="summary-card">
          <Sparkles size={18} />
          <div>
            <h3>{review.headline}</h3>
            <p>{review.summary}</p>
          </div>
        </div>
      </section>

      {review.turningPoints.length > 0 && (
        <section>
          <p className="section-label">
            <span>◆</span> 关键转折
          </p>
          <div className="reel">
            {review.turningPoints.map((point, index) => (
              <div className="reel-item turn" key={index}>
                <span className="rn">{String(index + 1).padStart(2, '0')}</span>
                <p>{point}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {review.playerInsights.length > 0 && (
        <section>
          <p className="section-label">
            <span>◆</span> 众生相
          </p>
          <div>
            {review.playerInsights.map((item) => {
              const character = characterFor(item.playerId);
              return (
                <div className="insight" key={item.playerId}>
                  <Portrait character={character} state="idle" emblem className="mini-pt" />
                  <div>
                    <p>
                      <strong>{character.name}</strong>
                      {item.insight}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}

function BallotView({ game }: { game: PublicGameState }) {
  const nameOf = (id?: string) => game.players.find((player) => player.id === id)?.name ?? '主持人';
  const rounds = useMemo(() => {
    const nums = new Set<number>();
    game.descriptions.forEach((item) => nums.add(item.round));
    game.votes.forEach((vote) => nums.add(vote.round));
    return [...nums].sort((a, b) => a - b);
  }, [game]);

  return (
    <section>
      <p className="section-label">
        <span>◆</span> 逐轮回放 · 描述与票型
      </p>
      {rounds.map((round, index) => (
        <RoundAccordion
          key={round}
          round={round}
          nameOf={nameOf}
          descriptions={game.descriptions.filter((item) => item.round === round)}
          votes={game.votes.filter((vote) => vote.round === round)}
          eliminations={game.events.filter((event) => event.type === 'elimination' && event.round === round)}
          defaultOpen={index === rounds.length - 1}
        />
      ))}
    </section>
  );
}

function RoundAccordion({
  round,
  descriptions,
  votes,
  eliminations,
  nameOf,
  defaultOpen,
}: {
  round: number;
  descriptions: Array<{ playerId: string; text: string }>;
  votes: Array<{ voterId: string; targetId: string }>;
  eliminations: Array<{ id: string; text: string }>;
  nameOf: (id?: string) => string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`round-acc ${open ? 'open' : ''}`}>
      <button onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className="rr">R{String(round).padStart(2, '0')}</span>
        <strong>第 {round} 轮</strong>
        <ChevronDown size={18} />
      </button>
      {open && (
        <div className="round-detail">
          {descriptions.map((item, index) => (
            <p className="desc" key={index}>
              <b>{nameOf(item.playerId)}</b>
              {item.text}
            </p>
          ))}
          {votes.length > 0 && (
            <div className="vote-lines">
              {votes.map((vote, index) => (
                <span key={index}>
                  {nameOf(vote.voterId)} → {nameOf(vote.targetId)}
                </span>
              ))}
            </div>
          )}
          {eliminations.map((event) => (
            <p className="desc" key={event.id} style={{ color: 'var(--rust-dark)' }}>
              <b>结果</b>
              {event.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 高光时刻(任务 5.4):终局取一小束证据接地的时刻卡片。
 * 默认剧透安全(结构上无 role/word);「剧透」开关打开后才二次拉取 ?spoilers=1,
 * 揭晓身份/密词/结构化信念增量 —— 与服务端终局门禁同源。
 */
function HighlightsView({ game }: { game: PublicGameState }) {
  const [spoilers, setSpoilers] = useState(false);
  const [reel, setReel] = useState<HighlightReel | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReel(null);
    setError(null);
    api
      .highlights(game.id, spoilers)
      .then((data) => {
        if (!cancelled) setReel(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '高光加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [game.id, spoilers]);

  const nameOf = (id: string) => characterFor(id).name;

  return (
    <section>
      <div className="hl-head">
        <p className="section-label" style={{ marginBottom: 0 }}>
          <span>◆</span> 高光时刻 · 证据接地
        </p>
        <button
          type="button"
          role="switch"
          aria-checked={spoilers}
          className={`spoiler-toggle ${spoilers ? 'on' : ''}`}
          onClick={() => setSpoilers((value) => !value)}
        >
          <span className="dot" />
          {spoilers ? '剧透已开' : '剧透'}
        </button>
      </div>

      {error && <p className="hl-empty">高光加载失败,稍后重开可见。</p>}
      {!error && reel === null && <p className="hl-empty">正在挑选本局最值得回看的瞬间…</p>}
      {!error && reel !== null && reel.cards.length === 0 && (
        <p className="hl-empty">这局节奏平稳,没有触发值得单独定格的高光——不凑数,只呈现真实发生过的时刻。</p>
      )}

      <div className="hl-reel">
        {reel?.cards.map((card) => (
          <HighlightCardView key={card.id} card={card} nameOf={nameOf} />
        ))}
      </div>
    </section>
  );
}

function HighlightCardView({ card, nameOf }: { card: HighlightCard; nameOf: (id: string) => string }) {
  const meta = metaFor(card.type);
  const Icon = HL_ICONS[meta.icon] ?? Star;
  return (
    <article className="hl-card" style={{ ['--hl' as string]: `var(${meta.accent})` }}>
      <header className="hl-top">
        <span className="hl-badge">
          <Icon size={13} />
          {meta.label}
        </span>
        <span className="hl-round">R{String(card.round).padStart(2, '0')}</span>
      </header>
      <h3 className="hl-title">{card.title}</h3>
      <p className="hl-caption">{card.caption}</p>

      {card.quotes.map((quote, index) => (
        <blockquote className="hl-quote" key={index}>
          <span className="who">{nameOf(quote.playerId)}</span>
          {quote.text}
        </blockquote>
      ))}

      {card.measures.length > 0 && (
        <div className="hl-measures">
          {card.measures.map((measure, index) => (
            <span className="hl-stat" key={index}>
              <b>{formatMeasure(measure)}</b>
              {measure.label}
            </span>
          ))}
        </div>
      )}

      <footer className="hl-cite">{citationLabel(card)}</footer>

      {card.spoiler && <SpoilerPanel spoiler={card.spoiler} nameOf={nameOf} />}
    </article>
  );
}

function SpoilerPanel({
  spoiler,
  nameOf,
}: {
  spoiler: NonNullable<HighlightCard['spoiler']>;
  nameOf: (id: string) => string;
}) {
  return (
    <div className="hl-spoiler">
      <span className="hl-spoiler-tag">剧透</span>
      <p>{spoiler.note}</p>
      {spoiler.roleReveals && spoiler.roleReveals.length > 0 && (
        <div className="hl-reveals">
          {spoiler.roleReveals.map((reveal) => (
            <span className={`hl-reveal ${reveal.role}`} key={reveal.playerId}>
              {nameOf(reveal.playerId)} · {roleName(reveal.role)} · {reveal.word}
            </span>
          ))}
        </div>
      )}
      {spoiler.beliefDeltas && spoiler.beliefDeltas.length > 0 && (
        <div className="hl-beliefs">
          {spoiler.beliefDeltas.map((delta, index) => (
            <span key={index}>
              {nameOf(delta.agentId)} 对 {nameOf(delta.targetId)} 的怀疑 {delta.before} → {delta.after}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function roleName(role?: Role): string {
  return role === 'undercover' ? '卧底' : role === 'civilian' ? '平民' : '—';
}
