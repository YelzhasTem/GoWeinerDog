import type { EvaluationRecord } from '../domain/types';
import { ACTION_NAMES } from '../domain/types';

interface Props {
  result: EvaluationRecord | null;
  rulesVersion?: string;
  cursor: number;
  playing: boolean;
  onPlay: () => void;
  onStep: () => void;
  onRewind: () => void;
  onFinish: () => void;
  speed?: number;
  onSpeed?: (value: number) => void;
}

export function RoutePlayer({ result, cursor, playing, onPlay, onStep, onRewind, onFinish, speed = 1, onSpeed, rulesVersion = 'treat-once-v2' }: Props) {
  const last = result && cursor > 0 ? result.transitions[cursor - 1] : null;
  const treatNote = last?.enteredTreat
    ? rulesVersion === 'repeat-treat-v1' ? ' Получено лакомство по архивным правилам v1.'
      : last.collectedTreat ? ' Лакомство собрано.' : ' Повторный вход: лакомство уже собрано, нового бонуса нет.'
    : '';
  return <div className="route-player">
    <div className="player-caption">
      <span>{result ? 'Рассчитанный путь' : 'Здесь появится путь таксы'}</span>
      <span className="mono" data-testid="playback-step">{result ? `${cursor} / ${result.steps}` : '— / —'}</span>
    </div>
    <div className="transport" aria-label="Управление просмотром пути">
      <button type="button" onClick={onRewind} disabled={!result} aria-label="Сначала" title="Сначала">↤</button>
      <button type="button" className="play-toggle" onClick={onPlay} disabled={!result}>
        <span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span> {playing ? 'Пауза' : cursor === result?.steps ? 'Повторить путь' : 'Воспроизвести'}
      </button>
      <button type="button" onClick={onStep} disabled={!result || cursor >= result.steps} aria-label="Один шаг" title="Один шаг">→<span className="step-label"> Шаг</span></button>
      <button type="button" className="finish-playback" onClick={onFinish} disabled={!result || cursor >= result.steps}>Сразу результат</button>
    </div>
    {onSpeed && <label className="playback-speed">Скорость просмотра
      <select aria-label="Скорость просмотра" value={speed} onChange={(event) => onSpeed(Number(event.target.value))}>
        <option value={1}>1× — обычная</option><option value={4}>4× — быстрее</option><option value={12}>12× — быстро</option>
      </select>
    </label>}
    <p className="player-note" data-testid="transition-note">
      {!result ? 'Сначала тренировка, затем проверка без случайных действий.' : last
        ? `Шаг ${cursor}: ${ACTION_NAMES[last.action]}${last.collision ? ', столкновение' : ''}. Награда: ${last.reward > 0 ? '+' : ''}${last.reward}.${treatNote}`
        : 'Такса на старте. Проигрываем уже рассчитанные действия.'}
    </p>
  </div>;
}
