import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Compass, Crown, RotateCcw, ScrollText, Sparkles, UsersRound } from 'lucide-react';
import { characterFor } from '../characters';
import { Portrait } from '../art/portraits';
import type { PublicGameState, Role } from '../types';

type Tab = 'identity' | 'review' | 'ballot';

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
            <Tabber tab={tab} value="review" onSelect={setTab} icon={<Compass size={14} />} label="复盘" />
            <Tabber tab={tab} value="ballot" onSelect={setTab} icon={<ScrollText size={14} />} label="票局" />
          </div>

          {tab === 'identity' && <IdentityView game={game} />}
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

function roleName(role?: Role): string {
  return role === 'undercover' ? '卧底' : role === 'civilian' ? '平民' : '—';
}
