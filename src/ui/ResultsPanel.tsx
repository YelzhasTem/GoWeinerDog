import { ACTION_NAMES, type EnvironmentConfig, type EvaluationRecord } from '../domain/types';

interface Props {
  environment: EnvironmentConfig;
  result: EvaluationRecord | null;
  maxSteps: number;
  caption?: string;
  rulesVersion?: string;
}

export function ResultsPanel({ environment, result, maxSteps, caption, rulesVersion = 'treat-once-v2' }: Props) {
  const coordinates = (cell: number) => `${Math.floor(cell / environment.width) + 1}:${cell % environment.width + 1}`;
  const hasTreat = environment.treat !== undefined;
  const legacyRules = rulesVersion === 'repeat-treat-v1';
  const collections = result ? legacyRules ? result.treatEntries : result.treatCollections : undefined;
  return <section className="results-section" aria-labelledby="results-title">
    <div className="section-topline"><h2 id="results-title">Итог проверки</h2><span>{caption ?? (result ? 'Один проход выученной стратегии' : 'После тренировки нажми «Посмотреть путь»')}</span></div>
    <div className={`result-grid ${hasTreat ? 'has-treat' : ''}`}>
      <div className={`result-box goal-box ${result?.outcome === 'goal' ? 'success' : result ? 'timeout' : ''}`}><span>Добралась домой?</span><strong data-testid="goal-result">{result ? result.outcome === 'goal' ? 'Да, дома!' : 'До домика не дошла' : 'Не проверяли'}</strong><small>{result ? result.outcome === 'goal' ? 'Домик достигнут' : 'Причина: лимит шагов' : 'Ждём первый путь'}</small></div>
      <div className="result-box"><span>Набранные очки</span><strong data-testid="reward-result">{result ? result.reward : '—'}</strong><small>Сумма наград за шаги</small></div>
      <div className="result-box"><span>Выполнено шагов</span><strong data-testid="steps-result">{result ? result.steps : '—'}</strong><small>Лимит — {maxSteps}</small></div>
      {hasTreat && <div className="result-box"><span>Входы на клетку лакомства</span><strong data-testid="treat-result">{result ? result.treatEntries : '—'}</strong><small>Посещения, включая повторные</small></div>}
      {hasTreat && <div className="result-box"><span>Собрано лакомств</span><strong data-testid="treat-collections">{collections ?? '—'}</strong><small>{legacyRules ? 'Архивные правила v1: при каждом входе' : 'Не более одного за попытку'}</small></div>}
    </div>
    {hasTreat && result?.outcome === 'timeout' && <p className="outcome-note">{result.reward > 0 ? 'Очки набраны, но задача не выполнена.' : 'Лимит шагов закончился.'} До домика не дошла.</p>}
    {result && <details className="trace-details"><summary>Посмотреть расчёт по шагам</summary><p>Строка:столбец. Повторный просмотр воспроизводит этот же расчёт и не является новым испытанием.</p>
      <ol data-testid="trace-list">{result.transitions.map((transition, index) => <li key={index}>#{index + 1}: {coordinates(transition.from)} → {coordinates(transition.to)} · {ACTION_NAMES[transition.action]} · {transition.reward > 0 ? '+' : ''}{transition.reward} очк.{transition.enteredTreat ? ' · вход на клетку лакомства' : ''}{transition.collectedTreat ? ' · лакомство собрано' : transition.enteredTreat ? legacyRules ? ' · лакомство получено (правила v1)' : ' · уже собрано, бонуса нет' : ''}{transition.collision ? ' · столкновение' : ''}{transition.terminated ? ' · домик' : ''}</li>)}</ol>
    </details>}
  </section>;
}
