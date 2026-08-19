import type { CSSProperties, KeyboardEvent } from 'react';
import { Check } from 'lucide-react';
import type { Character } from '../characters';
import { Portrait, type PortraitState } from '../art/portraits';

/**
 * 舞台席位(OpenSpec 05-H · 任务 2.2/2.3)
 *
 * 立绘为主角:一张参数化肖像 + 名号 + 气质标签,叠加四种状态样式
 * (常态/发言聚光/受质疑脉冲/出局灰度)。投票期可选中——以「按钮语义 + 键盘可达」呈现,
 * 满足无障碍(决策 9)。配色由角色调色板注入 CSS 变量,聚光晕染随之而变。
 */
export interface SeatProps {
  character: Character;
  state: PortraitState;
  /** 名号下方小标签(如「发言中」「AI 玩家」「真人」)。 */
  tag?: string;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}

export function Seat({ character, state, tag, selectable = false, selected = false, onSelect }: SeatProps) {
  const glow = { '--seat-glow': character.palette.glow } as CSSProperties;
  const className = [
    'seat',
    state,
    selectable ? 'selectable' : '',
    selected ? 'selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!selectable) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.();
    }
  };

  return (
    <div
      className={className}
      style={glow}
      onClick={selectable ? onSelect : undefined}
      onKeyDown={handleKey}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      aria-pressed={selectable ? selected : undefined}
      aria-label={selectable ? `投票给 ${character.name}` : undefined}
    >
      <div className="seat-portrait">
        <Portrait character={character} state={state} emblem />
        {state === 'eliminated' && <span className="seat-strike">已出局</span>}
        {selected && (
          <span className="seat-check" aria-hidden="true">
            <Check size={14} />
          </span>
        )}
      </div>
      <span className="seat-name">{character.name}</span>
      {tag && <span className="seat-tag">{tag}</span>}
    </div>
  );
}
