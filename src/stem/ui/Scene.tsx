import type { CSSProperties } from 'react';
import dog from '../../assets/pixel/dachshund.svg';
import home from '../../assets/pixel/home.svg';
import rock from '../../assets/pixel/rock.svg';
import { describeSituation, isBlocked, MOVE_ARROWS, MOVE_LABELS, type HomeSide, type Move, type Situation, type Verdict } from '../situations';

interface Props {
  situation: Situation;
  /** Решение, которое такса показывает на поле. */
  move?: Move | null;
  verdict?: Verdict | null;
  /** Смена значения перезапускает анимацию шага. */
  animationKey?: string | number;
  size?: 'large' | 'small' | 'tiny';
  editable?: boolean;
  onToggleRock?: (side: Move) => void;
  onHome?: (side: HomeSide) => void;
  label?: string;
}

// Поле 3 × 3: такса внизу в центре и смотрит вверх. Слева, впереди и справа от
// неё могут лежать камни; домик стоит в верхнем ряду — слева, прямо или справа.
const HOME_COLUMN: Record<HomeSide, number> = { left: 0, ahead: 1, right: 2 };
const ROCK_CELL: Record<Move, [number, number]> = { left: [2, 0], straight: [1, 1], right: [2, 2] };
const ROCK_NAMES: Record<Move, string> = { left: 'слева', straight: 'впереди', right: 'справа' };

export function SituationScene({ situation, move = null, verdict = null, animationKey, size = 'large', editable = false, onToggleRock, onHome, label }: Props) {
  const cells = [];
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const rockSide = (Object.keys(ROCK_CELL) as Move[]).find((side) => ROCK_CELL[side][0] === row && ROCK_CELL[side][1] === column);
      const homeHere = row === 0 && HOME_COLUMN[situation.home] === column;
      const hasRock = rockSide ? isBlocked(situation, rockSide) : false;
      const content = <>
        {hasRock && <img className="scene-rock" src={rock} alt="" />}
        {homeHere && <img className="scene-home" src={home} alt="" />}
      </>;
      const key = `${row}-${column}`;
      if (editable && rockSide) {
        cells.push(<button type="button" key={key} className={`scene-cell editable ${hasRock ? 'has-rock' : ''}`} aria-pressed={hasRock}
          aria-label={`Камень ${ROCK_NAMES[rockSide]}`} onClick={() => onToggleRock?.(rockSide)}>{content}{!hasRock && <span className="scene-plus">+</span>}</button>);
      } else if (editable && row === 0) {
        const side = (['left', 'ahead', 'right'] as HomeSide[])[column];
        cells.push(<button type="button" key={key} className={`scene-cell editable home-slot ${homeHere ? 'has-home' : ''}`} aria-pressed={homeHere}
          aria-label={`Домик ${side === 'left' ? 'слева' : side === 'right' ? 'справа' : 'прямо'}`} onClick={() => onHome?.(side)}>{content}{!homeHere && <span className="scene-plus">⌂</span>}</button>);
      } else {
        cells.push(<div key={key} className={`scene-cell ${row === 2 && column === 1 ? 'dog-start' : ''}`} aria-hidden="true">{content}</div>);
      }
    }
  }
  const motion = move ? `${verdict === 'crash' ? 'crash' : 'go'}-${move}` : '';
  const text = label ?? `Ситуация: ${describeSituation(situation)}.${move ? ` Бот выбирает ${MOVE_LABELS[move]}.` : ''}`;
  return <div className={`scene scene-${size} ${verdict ? `scene-${verdict}` : ''}`} data-testid="scene" data-situation={`${+situation.rockLeft}${+situation.rockAhead}${+situation.rockRight}-${situation.home}`}>
    <div className="scene-grid" role={editable ? 'group' : 'img'} aria-label={text}>
      {cells}
      <div key={animationKey} className={`scene-dog ${motion}`} style={{ '--row': 2, '--column': 1 } as CSSProperties} aria-hidden="true">
        <img src={dog} alt="" />
        {!move && size !== 'tiny' && <span className="scene-facing">↑</span>}
        {move && size !== 'tiny' && <span className="scene-choice">{MOVE_ARROWS[move]}</span>}
      </div>
    </div>
  </div>;
}
