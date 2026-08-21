import { useState } from 'react';
import { ArrowRight, LockKeyhole } from 'lucide-react';
import type { PublicGameState } from '../types';
import { Brand } from '../components/ui';

/**
 * 身份揭示(OpenSpec 05-H · 任务 3.1)
 *
 * 私密信笺:仅本机可见的阵营与密词,以 3D 翻卡拆封。
 * 数据只用 `game.human`(自己的 role/word)——他人身份要到终局才解封。
 */
export function RevealScreen({ game, onDone }: { game: PublicGameState; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const spy = game.human.role === 'undercover';

  return (
    <div className="screen reveal">
      <Brand />
      <p className="reveal-note">Private Briefing · 仅本机可见</p>
      <h2>{open ? '记住它，然后藏好。' : '你的身份已封入信笺。'}</h2>
      <p className="reveal-sub">五人中随机一位是卧底——这次也可能是你。</p>

      <button
        className={`envelope ${open ? 'open' : ''}`}
        onClick={() => !open && setOpen(true)}
        aria-label={open ? '身份已揭晓' : '点击拆封，查看你的身份'}
      >
        <div className="envelope-inner">
          <div className="envelope-face envelope-front">
            <span className="seal">
              <LockKeyhole size={22} />
            </span>
            <span>点击拆封</span>
            <small>只看一眼，别让旁人发现</small>
          </div>
          <div className="envelope-face envelope-back">
            <span className="identity-role">你的阵营</span>
            <span className={`identity-band ${spy ? 'spy' : ''}`}>{spy ? '卧底' : '平民'}</span>
            <div className="word-plate">
              <span>你的密词</span>
              <b>{game.human.word}</b>
            </div>
            <p className="identity-hint">
              {spy
                ? '你的词与多数人不同。听懂他们的暗示，把自己伪装到最后。'
                : '找出那个描述总偏一点的人，并把票投给他。'}
            </p>
          </div>
        </div>
      </button>

      <button className="btn btn-paper btn-block" disabled={!open} onClick={onDone}>
        我记住了，进入牌局
        <ArrowRight size={18} />
      </button>
    </div>
  );
}
