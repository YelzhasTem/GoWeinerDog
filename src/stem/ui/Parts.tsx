import type { ReactNode } from 'react';
import { MOVE_ARROWS, MOVE_LABELS, MOVES, describeSituation, situationKey, type Move } from '../situations';
import type { Example } from '../model';
import type { TestRecord } from '../lab';
import { CHALLENGE_TARGET } from '../levels';
import { SituationScene } from './Scene';

export const percent = (value: number) => `${Math.round(value * 100)}%`;

export function MoveButtons({ onChoose, disabled = false, chosen }: { onChoose: (move: Move) => void; disabled?: boolean; chosen?: Move | null }) {
  return <div className="move-buttons" role="group" aria-label="Выбери решение">
    {MOVES.map((move) => <button key={move} type="button" className={`move-button ${chosen === move ? 'chosen' : ''}`} disabled={disabled} onClick={() => onChoose(move)}>
      <span aria-hidden="true">{MOVE_ARROWS[move]}</span> {MOVE_LABELS[move]}
    </button>)}
  </div>;
}

const STEPS = [['data', 'DATA', 'Данные'], ['train', 'TRAIN', 'Обучение'], ['test', 'TEST', 'Тест'], ['result', 'IMPROVE', 'Улучшение']] as const;

export function Progress({ stage, onStage, enabled }: { stage: string; onStage: (stage: 'data' | 'train' | 'test' | 'result') => void; enabled: Record<string, boolean> }) {
  const active = STEPS.findIndex(([id]) => id === stage);
  return <ol className="ml-progress" aria-label="Цикл эксперимента">
    {STEPS.map(([id, code, name], index) => <li key={id} className={index === active ? 'active' : index < active ? 'done' : ''}>
      <button type="button" disabled={!enabled[id] || index === active} aria-current={index === active ? 'step' : undefined} onClick={() => onStage(id)}>
        <span className="ml-progress-number">0{index + 1}</span><span className="ml-progress-code">{code}</span><span className="ml-progress-name">{name}</span>
      </button>
    </li>)}
  </ol>;
}

/** Набор данных ученика: одинаковые примеры собраны в одну строку со счётчиком. */
export function Dataset({ examples, onRemove, onAdd, stale, canAdd, children }: { examples: readonly Example[]; onRemove: (id: string) => void; onAdd?: () => void; stale: boolean; canAdd: boolean; children?: ReactNode }) {
  const groups = new Map<string, { example: Example; ids: string[] }>();
  for (const example of examples) {
    const key = `${situationKey(example.situation)}>${example.move}`;
    const group = groups.get(key);
    if (group) group.ids.push(example.id); else groups.set(key, { example, ids: [example.id] });
  }
  const kinds = new Set(examples.map((example) => situationKey(example.situation))).size;
  return <section className="ml-card dataset" aria-labelledby="dataset-title" data-testid="dataset">
    <h2 id="dataset-title">🧠 МОИ ОБУЧАЮЩИЕ ПРИМЕРЫ</h2>
    <p className="dataset-meta"><b data-testid="example-count">{examples.length}</b> {plural(examples.length, 'пример', 'примера', 'примеров')} · <b data-testid="diversity">{kinds}</b> из 21 разных ситуаций</p>
    <div className="diversity-bar" aria-hidden="true"><span style={{ width: `${kinds / 21 * 100}%` }} /></div>
    {stale && <p className="stale-note" role="status">Данные изменились — бот ещё не знает о них. Переобучи модель.</p>}
    {!examples.length ? <p className="dataset-empty">Пока пусто. Каждый твой выбор станет обучающим примером — это и есть dataset.</p>
      : <ul className="dataset-list">{[...groups.values()].map(({ example, ids }) => <li key={ids[0]}>
        <SituationScene situation={example.situation} size="tiny" />
        <span className="dataset-text">{describeSituation(example.situation)} → <b>{MOVE_LABELS[example.move]}</b>{ids.length > 1 && <span className="dataset-count"> ×{ids.length}</span>}</span>
        <button type="button" className="dataset-remove" aria-label={`Удалить пример: ${describeSituation(example.situation)} → ${MOVE_LABELS[example.move]}`} onClick={() => onRemove(ids[ids.length - 1])}>−</button>
      </li>)}</ul>}
    {canAdd && onAdd && <button type="button" className="ml-secondary add-example" onClick={onAdd}>+ ДОБАВИТЬ ПРИМЕР</button>}
    {children}
  </section>;
}

export function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10; const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Простой график: каждый столбец — отдельный тест с реальной точностью модели. */
export function AccuracyChart({ tests, target, title = 'Как менялся результат' }: { tests: readonly TestRecord[]; target?: number; title?: string }) {
  if (!tests.length) return null;
  return <figure className="accuracy-chart" data-testid="accuracy-chart">
    <figcaption>{title}{target !== undefined && <span className="chart-legend"> · пунктир — цель {percent(target)}</span>}</figcaption>
    <div className="chart-area">
      {target !== undefined && <div className="chart-target" style={{ bottom: `${target * 100}%` }} />}
      {tests.map((test) => <div className="chart-column" key={test.attempt}>
        <span className="chart-value">{percent(test.accuracy)}</span>
        <div className={`chart-bar level-${test.level} ${test.accuracy >= (target ?? 2) ? 'hit' : ''}`} style={{ height: `${Math.max(test.accuracy * 100, 3)}%` }} />
      </div>)}
    </div>
    <div className="chart-labels" aria-hidden="true">{tests.map((test) => <span key={test.attempt}>{test.phase === 'similar' ? 'похож.' : test.phase === 'diverse' ? 'разн.' : `У${test.level}`}<br />{test.examples} пр.</span>)}</div>
    <ul className="sr-only">{tests.map((test) => <li key={test.attempt}>Тест {test.attempt}, уровень {test.level}: {percent(test.accuracy)}, примеров {test.examples}.</li>)}</ul>
  </figure>;
}

export function ProbabilityBars({ probabilities }: { probabilities: Record<Move, number> }) {
  return <div className="probability-bars">{MOVES.map((move) => <div key={move} className="probability-row">
    <span>{MOVE_ARROWS[move]} {MOVE_LABELS[move]}</span>
    <div className="probability-track"><span style={{ width: `${probabilities[move] * 100}%` }} /></div>
    <b>{percent(probabilities[move])}</b>
  </div>)}</div>;
}

export { CHALLENGE_TARGET };
