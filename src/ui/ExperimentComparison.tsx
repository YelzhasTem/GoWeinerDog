import { compareExperiments } from '../experiments/session';
import type { Experience } from '../experiments/lesson';

interface Props {
  first: Experience;
  second: Experience | null;
  secondFixed?: boolean;
  onViewFirst: () => void;
  onViewSecond: () => void;
  onReset?: () => void;
  explanation: string;
  onExplain: (value: string) => void;
  onObservation?: (id: string, value: string) => void;
  title?: string;
  idPrefix?: string;
  onCommit?: () => void;
  needsCommit?: boolean;
}

function ExperienceCard({ record, index, fixed, onView, onObservation, idPrefix }: {
  record: Experience;
  index: number;
  fixed: boolean;
  onView: () => void;
  onObservation?: (id: string, value: string) => void;
  idPrefix: string;
}) {
  const { result, notes, model } = record;
  const environment = model.environment;
  const config = model.config;
  const coordinates = (cell: number) => `${Math.floor(cell / environment.width) + 1}:${cell % environment.width + 1}`;
  const signed = (number: number) => `${number > 0 ? '+' : ''}${number}`;
  const hasTreat = environment.treat !== undefined;
  return <article className="experience-card" data-testid={`experience-${index}`}>
    <div className="experience-heading"><h3>Опыт {index}</h3><span>{fixed ? 'Снимок результата' : 'Текущий результат'}</span></div>
    {hasTreat && <p className="experience-bonus">Лакомство <b data-testid={`experience-${index}-bonus`}>{signed(environment.rewards.treat)}</b></p>}
    <p className={`experience-outcome ${result.outcome === 'goal' ? 'green-text' : ''}`} data-testid={`experience-${index}-outcome`}>{result.outcome === 'goal' ? 'Да, дома!' : 'До домика не дошла'}</p>
    <dl>
      <div><dt>Очки</dt><dd data-testid={`experience-${index}-reward`}>{result.reward}</dd></div>
      <div><dt>Выполнено шагов</dt><dd data-testid={`experience-${index}-steps`}>{result.steps}</dd></div>
      {hasTreat && <div><dt>Входы к лакомству</dt><dd data-testid={`experience-${index}-entries`}>{result.treatEntries}</dd></div>}
      <div><dt>Причина окончания</dt><dd data-testid={`experience-${index}-reason`}>{result.outcome === 'goal' ? 'Домик достигнут' : 'Лимит шагов'}</dd></div>
    </dl>
    <button type="button" className="text-button" onClick={onView}>Путь опыта {index}</button>
    <details className="experience-notes"><summary>Прогноз и наблюдение опыта {index}</summary>
      <p><b>Прогноз:</b> {notes.prediction.trim() || 'Не записан.'}</p>
      {onObservation ? <><label htmlFor={`${idPrefix}-observation-${index}`}>Наблюдение опыта {index}</label>
        <textarea id={`${idPrefix}-observation-${index}`} rows={2} maxLength={1500} value={notes.observation} onChange={(event) => onObservation(record.id, event.target.value)} placeholder="Что ты заметил в поведении таксы?" />
        <p className="field-hint">Запись можно дописать. Условия и рассчитанный результат не меняются.</p></>
        : <p><b>Наблюдение:</b> {notes.observation.trim() || 'Не записано.'}</p>}
    </details>
    <details className="experience-conditions"><summary>Условия опыта {index}</summary>
      <dl>
        <div><dt>Миссия</dt><dd>{record.missionId === 'trap' ? 'Ловушка лакомства' : 'Дорога домой'}</dd></div>
        <div><dt>Площадка</dt><dd>{environment.width} × {environment.height}</dd></div>
        <div><dt>Старт · домик</dt><dd>{coordinates(environment.start)} · {coordinates(environment.home)}</dd></div>
        {hasTreat && <div><dt>Лакомство</dt><dd>{coordinates(environment.treat!)}</dd></div>}
        <div><dt>Шаг · столкновение</dt><dd>{signed(environment.rewards.step)} · дополнительно {signed(environment.rewards.collision)}</dd></div>
        <div><dt>За домик</dt><dd>{signed(environment.rewards.home)}</dd></div>
        {hasTreat && <div><dt>За каждый вход к лакомству</dt><dd>{signed(environment.rewards.treat)}</dd></div>}
        <div><dt>Seed</dt><dd>{config.seed}</dd></div>
        <div><dt>Попытки обучения</dt><dd>{config.episodes}</dd></div>
        <div><dt>Лимит попытки · проверки</dt><dd>{config.maxSteps} · {record.evaluationMaxSteps} шагов</dd></div>
        <div><dt>Alpha · gamma</dt><dd>{config.alpha} · {config.gamma}</dd></div>
        <div><dt>Случайные действия</dt><dd>{config.epsilonStart * 100}% → {config.epsilonEnd * 100}% за {Math.round(config.episodes * config.decayFraction)} попыток</dd></div>
      </dl>
      <p className="field-hint">Координаты: строка:столбец. Ограждения: {environment.fences.map(coordinates).join(', ') || 'нет'}.</p>
      <p className="field-hint">Алгоритм: {model.algorithmVersion}. Генератор случайности: {model.prngVersion}.</p>
    </details>
  </article>;
}

export function ExperimentComparison({ first, second, secondFixed = true, onViewFirst, onViewSecond, onReset, explanation, onExplain, onObservation, title = 'Сравнение опытов', idPrefix = 'comparison', onCommit, needsCommit = false }: Props) {
  // Оба имени проверены до адаптации к узкому типу первоначального сравнения.
  const comparison = second && first.missionId === 'trap' && second.missionId === 'trap'
    ? compareExperiments({ ...first, missionId: 'trap' }, { ...second, missionId: 'trap' }) : null;
  const sameMission = !second || first.missionId === second.missionId;
  const comparable = sameMission && comparison?.comparable;
  const hasTreat = first.model.environment.treat !== undefined;
  const differences = comparison?.differences.map((difference) => difference.label) ?? [];
  if (!sameMission) differences.unshift('Миссия');
  return <section className="comparison-section" aria-labelledby={`${idPrefix}-title`}>
    <div className="section-topline"><h2 id={`${idPrefix}-title`}>{title}</h2>{onReset && <button type="button" className="text-button" onClick={onReset}>Начать заново</button>}</div>
    <p className="comparison-difference" data-testid="comparison-difference">{!second ? hasTreat ? 'Первый результат готов. Измени бонус и проведи второй опыт.' : 'Путь и записи первого опыта доступны ниже.' : !comparable ? 'Отличаются и другие условия. Причину нельзя приписать только бонусу.' : comparison!.bonusChanged ? `Изменено одно условие: бонус за лакомство +${first.model.environment.rewards.treat} → +${second.model.environment.rewards.treat}.` : 'Бонус не менялся. Это повторное обучение при тех же условиях.'}</p>
    {comparison && <p className="field-hint" data-testid="fixed-conditions">{comparable ? 'Совпадают площадка, seed, число попыток, лимиты, параметры обучения и остальные награды.' : differences.join(', ')}</p>}
    <div className="experience-pair"><ExperienceCard record={first} index={1} fixed onView={onViewFirst} onObservation={onObservation} idPrefix={idPrefix} />
      {second ? <ExperienceCard record={second} index={2} fixed={secondFixed} onView={onViewSecond} onObservation={onObservation} idPrefix={idPrefix} /> : hasTreat ? <div className="experience-placeholder"><b>Опыт 2</b><p>Другой бонус → новый прогноз → тренировка → проверка.</p></div> : null}
    </div>
    <label htmlFor={`${idPrefix}-explanation`}>Почему поведение изменилось или осталось прежним?</label>
    <textarea id={`${idPrefix}-explanation`} rows={3} maxLength={1500} disabled={!second} value={explanation} onChange={(event) => onExplain(event.target.value)} placeholder="Что в наградах объясняет поведение таксы?" />
    {needsCommit && onCommit && <button type="button" className="commit-pair" onClick={onCommit}>Заменить сохранённую пару</button>}
    <p className="field-hint">Твой вывод можно уточнять. Запись сама по себе не доказывает понимание.</p>
  </section>;
}
