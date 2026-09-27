import { ACTION_NAMES, type EnvironmentConfig, type EvaluationResult } from '../domain/types';

interface Props {
  environment: EnvironmentConfig;
  result: EvaluationResult | null;
  maxSteps: number;
  caption?: string;
}

export function ResultsPanel({ environment, result, maxSteps, caption }: Props) {
  const coordinates = (cell: number) => `${Math.floor(cell / environment.width) + 1}:${cell % environment.width + 1}`;
  const hasTreat = environment.treat !== undefined;
  return <section className="results-section" aria-labelledby="results-title">
    <div className="section-topline"><h2 id="results-title">Итог проверки</h2><span>{caption ?? (result ? 'Один проход выученной стратегии' : 'После тренировки нажми «Посмотреть путь»')}</span></div>
    <div className={`result-grid ${hasTreat ? 'has-treat' : ''}`}>
      <div className={`result-box goal-box ${result?.outcome === 'goal' ? 'success' : result ? 'timeout' : ''}`}><span>Добралась домой?</span><strong data-testid="goal-result">{result ? result.outcome === 'goal' ? 'Да, дома!' : 'До домика не дошла' : 'Не проверяли'}</strong><small>{result ? result.outcome === 'goal' ? 'Домик достигнут' : 'Причина: лимит шагов' : 'Ждём первый путь'}</small></div>
      <div className="result-box"><span>Набранные очки</span><strong data-testid="reward-result">{result ? result.reward : '—'}</strong><small>Сумма наград за шаги</small></div>
      <div className="result-box"><span>Выполнено шагов</span><strong data-testid="steps-result">{result ? result.steps : '—'}</strong><small>Лимит — {maxSteps}</small></div>
      {hasTreat && <div className="result-box"><span>Входы к лакомству</span><strong data-testid="treat-result">{result ? result.treatEntries : '—'}</strong><small>Каждый вход, включая первый</small></div>}
    </div>
    {hasTreat && result?.outcome === 'timeout' && <p className="outcome-note">{result.reward > 0 ? 'Очки набраны, но задача не выполнена.' : 'Лимит шагов закончился.'} До домика не дошла.</p>}
    {result && <details className="trace-details"><summary>Посмотреть расчёт по шагам</summary><p>Строка:столбец. Повторный просмотр воспроизводит этот же расчёт и не является новым испытанием.</p>
      <ol data-testid="trace-list">{result.transitions.map((transition, index) => <li key={index}>#{index + 1}: {coordinates(transition.from)} → {coordinates(transition.to)} · {ACTION_NAMES[transition.action]} · {transition.reward > 0 ? '+' : ''}{transition.reward} очк.{transition.enteredTreat ? ' · вход к лакомству' : ''}{transition.collision ? ' · столкновение' : ''}{transition.terminated ? ' · домик' : ''}</li>)}</ol>
    </details>}
  </section>;
}
