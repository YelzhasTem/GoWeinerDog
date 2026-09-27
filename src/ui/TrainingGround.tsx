import type { CSSProperties } from 'react';
import type { Action, EnvironmentConfig, EvaluationResult } from '../domain/types';
import dog from '../assets/pixel/dachshund.svg';
import home from '../assets/pixel/home.svg';
import fence from '../assets/pixel/fence.svg';
import paw from '../assets/pixel/paw.svg';
import treat from '../assets/pixel/treat.svg';

interface Props {
  environment: EnvironmentConfig;
  evaluation: EvaluationResult | null;
  cursor: number;
  /** Меняется только рисунок: номера клеток и сама среда остаются 6×6. */
  compact?: boolean;
}

export function TrainingGround({ environment, evaluation, cursor, compact = false }: Props) {
  const position = evaluation?.positions[cursor] ?? environment.start;
  const action: Action = evaluation?.transitions[cursor - 1]?.action ?? 1;
  const visited = new Set(evaluation?.positions.slice(0, cursor) ?? []);
  const x = position % environment.width;
  const y = Math.floor(position / environment.width);
  const coordinates = (cell: number) => `${Math.floor(cell / environment.width) + 1}:${cell % environment.width + 1}`;
  const groundStyle = {
    '--grid-width': environment.width,
    '--grid-height': compact ? 1 : environment.height,
  } as CSSProperties;
  const treatDescription = environment.treat === undefined
    ? 'Лакомства на площадке нет.'
    : `Лакомство (строка:столбец): ${coordinates(environment.treat)}. Бонус ${environment.rewards.treat} за каждый вход, включая первый.`;
  return <div className={`ground-wrap ${compact ? 'corridor-board' : ''}`}>
    <div className="ground" role="img" aria-label={`Площадка: ${environment.height} строк, ${environment.width} столбцов. ${compact ? 'Показана открытая верхняя дорожка; остальные строки заняты ограждениями. ' : ''}Такса: строка ${y + 1}, столбец ${x + 1}. Старт (строка:столбец): ${coordinates(environment.start)}. Домик (строка:столбец): ${coordinates(environment.home)}. Ограждения (строка:столбец): ${environment.fences.map(coordinates).join(', ') || 'нет'}. ${treatDescription}`}
      style={groundStyle} data-testid="ground" data-position={position}>
      {Array.from({ length: environment.width * (compact ? 1 : environment.height) }, (_, cell) => {
        const blocked = environment.fences.includes(cell);
        return <div key={cell} className={`ground-cell ${blocked ? 'fenced' : 'path-cell'} ${cell === environment.home ? 'home-cell' : ''} ${cell === environment.treat ? 'treat-cell' : ''}`} aria-hidden="true">
          {blocked && <img className="fence-art" src={fence} alt="" />}
          {visited.has(cell) && !blocked && cell !== environment.home && cell !== environment.treat && <img className="trail-paw" src={paw} alt="" />}
          {cell === environment.start && <span className="start-marker">СТАРТ</span>}
          {cell === environment.home && <img className="home-art" src={home} alt="" />}
          {cell === environment.treat && <img className="treat-art" src={treat} alt="" />}
        </div>;
      })}
      <div className="dog-cell" style={{ '--dog-x': x, '--dog-y': y } as CSSProperties} aria-hidden="true">
        <img src={dog} alt="" className={`dog-art ${action === 3 ? 'faces-left' : ''}`} />
        {cursor > 0 && <span className="direction-marker">{['↑', '→', '↓', '←'][action]}</span>}
      </div>
    </div>
  </div>;
}
