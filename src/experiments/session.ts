import type { EvaluationResult, TrainingRecord, TrainingResult } from '../domain/types';
import { RULES_VERSION, STATE_ENCODING_VERSION } from '../domain/state';
import { LEGACY_RULES_VERSION, LEGACY_STATE_ENCODING_VERSION } from './legacy';
import { validateTrainingConfig } from '../domain/validation';
import { evaluate } from '../evaluation/evaluate';

export interface ExperimentNotes {
  prediction: string;
  observation: string;
}

export interface ExperimentSnapshot {
  readonly id: string;
  readonly missionId: 'trap';
  readonly model: TrainingResult;
  readonly result: EvaluationResult;
  readonly evaluationMaxSteps: number;
  readonly notes: ExperimentNotes;
}

type ConditionValue = number | string | readonly number[] | undefined;

export interface ConditionDifference {
  key: string;
  label: string;
  before: ConditionValue;
  after: ConditionValue;
}

export interface ExperimentComparison {
  comparable: boolean;
  bonusChanged: boolean;
  differences: ConditionDifference[];
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

/** Порядок полей объекта не имеет значения; порядок шагов пути имеет. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length
    && keys.every((key) => Object.hasOwn(rightRecord, key) && sameValue(leftRecord[key], rightRecord[key]));
}

/** Снимок принадлежит своему опыту: следующие настройки и заметки его не меняют. */
export function captureExperiment(
  id: string,
  model: TrainingResult,
  result: EvaluationResult,
  notes: ExperimentNotes,
  evaluationMaxSteps = model.config.maxSteps,
): ExperimentSnapshot {
  if (model.rulesVersion !== RULES_VERSION || model.stateEncodingVersion !== STATE_ENCODING_VERSION) {
    throw new Error('Старый опыт сохраняется в архиве своей версии правил и не становится новым опытом.');
  }
  const errors = validateTrainingConfig(model.config);
  if (errors.length > 0) throw new Error(errors.join(' '));
  if (model.metrics.length !== model.config.episodes
    || model.metrics.some((metric, index) => metric.episode !== index + 1)
    || model.updates !== model.metrics.reduce((total, metric) => total + metric.steps, 0)) {
    throw new Error('Сначала дождись завершения всей тренировки.');
  }
  if (model.environment.treat === undefined) throw new Error('Для опыта с ловушкой нужна клетка с лакомством.');

  // Быстрая проверка короткого пути: не запускает обучение, не меняет Q и
  // не использует случайность. Не даёт сохранить чужие или неполные метрики.
  const calculated = evaluate(model.environment, model.q, evaluationMaxSteps);
  if (!sameValue(calculated, result)) {
    throw new Error('Результат проверки не соответствует модели и условиям этого опыта.');
  }
  return freezeDeep(structuredClone({ id, missionId: 'trap' as const, model, result, notes, evaluationMaxSteps }));
}

interface ComparisonSnapshot {
  readonly missionId: 'home' | 'trap';
  readonly model: TrainingRecord;
  readonly evaluationMaxSteps: number;
}

interface Condition {
  key: string;
  label: string;
  read: (snapshot: ComparisonSnapshot) => ConditionValue;
}

// Сравниваем условия, а не Q: изменение Q и пути как раз и есть результат опыта.
const CONDITIONS: readonly Condition[] = [
  { key: 'missionId', label: 'Миссия', read: (s) => s.missionId },
  { key: 'rulesVersion', label: 'Версия правил', read: (s) => s.model.rulesVersion ?? LEGACY_RULES_VERSION },
  { key: 'stateEncodingVersion', label: 'Формат состояния', read: (s) => s.model.stateEncodingVersion ?? LEGACY_STATE_ENCODING_VERSION },
  { key: 'width', label: 'Ширина площадки', read: (s) => s.model.environment.width },
  { key: 'height', label: 'Высота площадки', read: (s) => s.model.environment.height },
  { key: 'start', label: 'Место начала прогулки', read: (s) => s.model.environment.start },
  { key: 'home', label: 'Положение домика', read: (s) => s.model.environment.home },
  { key: 'fences', label: 'Ограждения', read: (s) => [...s.model.environment.fences].sort((a, b) => a - b) },
  { key: 'treat', label: 'Положение лакомства', read: (s) => s.model.environment.treat },
  { key: 'bonus', label: 'Бонус за лакомство', read: (s) => s.model.environment.rewards.treat },
  { key: 'stepReward', label: 'Награда за шаг', read: (s) => s.model.environment.rewards.step },
  { key: 'collisionReward', label: 'Дополнительная награда за столкновение', read: (s) => s.model.environment.rewards.collision },
  { key: 'homeReward', label: 'Награда за возвращение домой', read: (s) => s.model.environment.rewards.home },
  { key: 'seed', label: 'Seed', read: (s) => s.model.config.seed },
  { key: 'episodes', label: 'Число попыток тренировки', read: (s) => s.model.config.episodes },
  { key: 'maxSteps', label: 'Лимит шагов одной попытки', read: (s) => s.model.config.maxSteps },
  { key: 'evaluationMaxSteps', label: 'Лимит шагов проверки', read: (s) => s.evaluationMaxSteps },
  { key: 'alpha', label: 'Скорость обучения α', read: (s) => s.model.config.alpha },
  { key: 'gamma', label: 'Учёт будущих наград γ', read: (s) => s.model.config.gamma },
  { key: 'epsilonStart', label: 'Исследование в начале', read: (s) => s.model.config.epsilonStart },
  { key: 'epsilonEnd', label: 'Исследование в конце', read: (s) => s.model.config.epsilonEnd },
  { key: 'decayFraction', label: 'Доля попыток для уменьшения исследования', read: (s) => s.model.config.decayFraction },
  { key: 'algorithmVersion', label: 'Версия алгоритма', read: (s) => s.model.algorithmVersion },
  { key: 'prngVersion', label: 'Версия случайной последовательности', read: (s) => s.model.prngVersion },
];

export function compareExperiments(first: ComparisonSnapshot, second: ComparisonSnapshot): ExperimentComparison {
  const differences: ConditionDifference[] = [];
  for (const condition of CONDITIONS) {
    const before = condition.read(first);
    const after = condition.read(second);
    if (!sameValue(before, after)) differences.push({ key: condition.key, label: condition.label, before, after });
  }
  return {
    comparable: differences.every((difference) => difference.key === 'bonus'),
    bonusChanged: differences.some((difference) => difference.key === 'bonus'),
    differences,
  };
}
