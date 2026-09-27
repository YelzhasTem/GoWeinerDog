import type { Action, EnvironmentConfig, EvaluationRecord, TrainingConfig, TrainingRecord, TransitionRecord } from '../domain/types';
import type { ExperimentNotes } from './session';
import type { Mission, StorageLike } from './lesson';

// Не изменяем это имя и не записываем по нему: это исходные данные прежнего занятия.
export const LEGACY_STORAGE_KEY = 'goweinerdog.lesson.v1';
export const LEGACY_RULES_VERSION = 'repeat-treat-v1';
export const LEGACY_STATE_ENCODING_VERSION = 'cell-v1';
const MAX_STORAGE_LENGTH = 1_500_000;
const MAX_NOTE_LENGTH = 1500;
export interface LegacyExperience {
  readonly id: string;
  readonly missionId: Mission;
  readonly model: TrainingRecord;
  readonly result: EvaluationRecord;
  readonly evaluationMaxSteps: number;
  readonly notes: ExperimentNotes;
}
export interface LegacyExperiencePair { first: LegacyExperience; second: LegacyExperience; explanation: string }
export interface LegacyLesson {
  version: 1;
  mission: Mission;
  drafts: {
    home: { seedText: string; prediction: string; observation: string };
    trap: { bonus: number; prediction: string; observation: string };
  };
  current: LegacyExperience | null;
  home: LegacyExperience | null;
  working: { first: LegacyExperience | null; second: LegacyExperience | null; explanation: string };
  savedPair: LegacyExperiencePair | null;
}

// Снимки прежних пресетов: правка действующей миссии не меняет смысл архива.
const LEGACY_HOME_ENVIRONMENT: EnvironmentConfig = {
  width: 6, height: 6, start: 0, home: 35, fences: [3, 7, 9, 13, 21, 24, 25, 27],
  rewards: { step: -1, collision: -1, home: 20, treat: 0 },
};
const LEGACY_TRAP_ENVIRONMENT: EnvironmentConfig = {
  width: 6, height: 6, start: 0, home: 5, treat: 1,
  fences: Array.from({ length: 30 }, (_, index) => index + 6),
  rewards: { step: -1, collision: -1, home: 12, treat: 5 },
};
const LEGACY_HOME_TRAINING: TrainingConfig = {
  episodes: 800, maxSteps: 100, alpha: 0.2, gamma: 0.95,
  epsilonStart: 1, epsilonEnd: 0.05, decayFraction: 0.8, seed: 42,
};
const LEGACY_TRAP_TRAINING: TrainingConfig = { ...LEGACY_HOME_TRAINING, gamma: 0.9 };

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && same(a[key], b[key]));
}
function freezeDeep<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}
function invariant(condition: unknown, message = 'Данные занятия повреждены.'): asserts condition {
  if (!condition) throw new Error(message);
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  invariant(value !== null && typeof value === 'object' && !Array.isArray(value));
  const result = value as Record<string, unknown>;
  invariant(Object.keys(result).length === keys.length && keys.every((key) => Object.hasOwn(result, key)));
  return result;
}
function note(value: unknown): string {
  invariant(typeof value === 'string' && value.length <= MAX_NOTE_LENGTH);
  return value;
}
function mission(value: unknown): Mission { invariant(value === 'home' || value === 'trap'); return value; }
function bonus(value: unknown): number { invariant(Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10); return value as number; }
// Черновик поля может быть пока неверным: интерфейс покажет ошибку и запретит
// обучение. Строго проверяем seed уже завершённой модели, а не процесс ввода.
function seedText(value: unknown): string { invariant(typeof value === 'string' && value.length <= 32); return value; }
function validNotes(value: unknown): ExperimentNotes {
  const notes = record(value, ['prediction', 'observation']);
  return { prediction: note(notes.prediction), observation: note(notes.observation) };
}

/** Архив проверяется только по правилам v1; текущий алгоритм сюда не импортируется. */
function validateModel(value: unknown, selected: Mission): TrainingRecord {
  const model = record(value, ['q', 'config', 'environment', 'metrics', 'updates', 'algorithmVersion', 'prngVersion']);
  const config = record(model.config, Object.keys(LEGACY_HOME_TRAINING));
  invariant(Number.isInteger(config.seed) && Number(config.seed) >= 0 && Number(config.seed) <= 0xffffffff);
  const expectedConfig = selected === 'home' ? { ...LEGACY_HOME_TRAINING, seed: config.seed } : LEGACY_TRAP_TRAINING;
  invariant(same(config, expectedConfig), 'Настройки сохранённой тренировки не соответствуют миссии.');
  const environment = model.environment as TrainingRecord['environment'] | undefined;
  invariant(environment && typeof environment === 'object' && environment.rewards);
  const expectedEnvironment = selected === 'home' ? LEGACY_HOME_ENVIRONMENT : {
    ...LEGACY_TRAP_ENVIRONMENT, rewards: { ...LEGACY_TRAP_ENVIRONMENT.rewards, treat: bonus(environment.rewards.treat) },
  };
  invariant(same(environment, expectedEnvironment), 'Сохранённая площадка не соответствует миссии.');
  invariant(model.algorithmVersion === 'tabular-q-learning-v1' && model.prngVersion === 'mulberry32-v1', 'Версия алгоритма сохранённого опыта не поддерживается.');
  invariant(Array.isArray(model.q) && model.q.length === 36);
  for (let cell = 0; cell < model.q.length; cell += 1) {
    const row: unknown = model.q[cell];
    invariant(Array.isArray(row) && row.length === 4 && row.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && Math.abs(entry) <= 2000));
    if (environment.fences.includes(cell) || cell === environment.home) invariant(row.every((entry) => entry === 0));
  }
  invariant(Array.isArray(model.metrics) && model.metrics.length === expectedConfig.episodes);
  let updates = 0;
  for (let index = 0; index < model.metrics.length; index += 1) {
    const metric = record(model.metrics[index], ['episode', 'reward', 'steps', 'outcome']);
    invariant(metric.episode === index + 1 && Number.isInteger(metric.steps) && Number(metric.steps) >= 1 && Number(metric.steps) <= expectedConfig.maxSteps);
    invariant(typeof metric.reward === 'number' && Number.isFinite(metric.reward) && Math.abs(metric.reward) <= 2000);
    invariant(metric.outcome === 'goal' || (metric.outcome === 'timeout' && metric.steps === expectedConfig.maxSteps));
    updates += metric.steps as number;
  }
  invariant(model.updates === updates, 'Число обновлений не соответствует завершённой тренировке.');
  return value as TrainingRecord;
}

/** Проверяем сохранённые переходы, но возвращаем ровно исходный результат.
 * Старый опыт не обучается и не пересчитывается новым алгоритмом. */
function validateLegacyTrace(model: TrainingRecord, value: unknown): EvaluationRecord {
  const result = record(value, ['transitions', 'positions', 'reward', 'steps', 'outcome', 'treatEntries', 'collisions']);
  const environment = model.environment;
  invariant(Array.isArray(result.transitions) && result.transitions.length > 0 && result.transitions.length <= model.config.maxSteps);
  invariant(Array.isArray(result.positions) && result.positions.length === result.transitions.length + 1 && result.positions[0] === environment.start);
  let cell = environment.start;
  let reward = 0;
  let entries = 0;
  let collisions = 0;
  for (let index = 0; index < result.transitions.length; index += 1) {
    const stored = record(result.transitions[index], ['from', 'to', 'action', 'reward', 'collision', 'moved', 'enteredTreat', 'terminated', 'rewardParts']);
    invariant(cell !== environment.home);
    let action: Action = 0;
    for (const candidate of [1, 2, 3] as const) if (model.q[cell][candidate] > model.q[cell][action]) action = candidate;
    const x = cell % environment.width;
    const y = Math.floor(cell / environment.width);
    const nextX = x + (action === 1 ? 1 : action === 3 ? -1 : 0);
    const nextY = y + (action === 2 ? 1 : action === 0 ? -1 : 0);
    const candidate = nextY * environment.width + nextX;
    const collision = nextX < 0 || nextX >= environment.width || nextY < 0 || nextY >= environment.height || environment.fences.includes(candidate);
    const to = collision ? cell : candidate;
    const moved = to !== cell;
    const enteredTreat = moved && to === environment.treat;
    const terminated = moved && to === environment.home;
    const rewardParts = {
      step: environment.rewards.step, collision: collision ? environment.rewards.collision : 0,
      home: terminated ? environment.rewards.home : 0, treat: enteredTreat ? environment.rewards.treat : 0,
    };
    const expected: TransitionRecord = {
      from: cell, to, action, collision, moved, enteredTreat, terminated, rewardParts,
      reward: rewardParts.step + rewardParts.collision + rewardParts.home + rewardParts.treat,
    };
    invariant(same(stored, expected), 'Сохранённый путь не соответствует прежним правилам.');
    invariant(result.positions[index + 1] === to);
    reward += expected.reward;
    entries += Number(enteredTreat);
    collisions += Number(collision);
    cell = to;
  }
  invariant(result.steps === result.transitions.length && result.reward === reward && result.treatEntries === entries && result.collisions === collisions);
  invariant(result.outcome === (cell === environment.home ? 'goal' : 'timeout'));
  invariant(result.outcome === 'goal' || result.steps === model.config.maxSteps);
  return value as EvaluationRecord;
}
function captureLegacyExperience(id: string, selected: Mission, model: TrainingRecord, result: EvaluationRecord, notes: ExperimentNotes): LegacyExperience {
  invariant(typeof id === 'string' && id.length > 0 && id.length <= 120);
  validateModel(model, selected);
  validNotes(notes);
  validateLegacyTrace(model, result);
  return freezeDeep(structuredClone({ id, missionId: selected, model, result, evaluationMaxSteps: model.config.maxSteps, notes }));
}
function completePair(pair: LegacyLesson['working']): pair is LegacyExperiencePair { return !!pair.first && !!pair.second; }
function samePair(a: LegacyLesson['working'], b: LegacyExperiencePair | null): boolean {
  return !!b && a.first?.id === b.first.id && a.second?.id === b.second.id;
}
function parseLegacyLesson(value: unknown): LegacyLesson {
  const input = record(value, ['version', 'mission', 'drafts', 'current', 'home', 'working', 'savedPair']);
  invariant(input.version === 1, 'Версия сохранённого занятия не поддерживается.');
  const selected = mission(input.mission);
  const drafts = record(input.drafts, ['home', 'trap']);
  const homeDraft = record(drafts.home, ['seedText', 'prediction', 'observation']);
  const trapDraft = record(drafts.trap, ['bonus', 'prediction', 'observation']);
  const records = new Map<string, LegacyExperience>();
  function experience(value: unknown, expected?: Mission): LegacyExperience | null {
    if (value === null) return null;
    const input = record(value, ['id', 'missionId', 'model', 'result', 'evaluationMaxSteps', 'notes']);
    const selected = mission(input.missionId);
    invariant(!expected || selected === expected);
    invariant(input.evaluationMaxSteps === 100);
    invariant(typeof input.id === 'string');
    const previous = records.get(input.id);
    if (previous) { invariant(same(previous, input), 'Один опыт содержит противоречивые копии.'); return previous; }
    const restored = captureLegacyExperience(input.id, selected, input.model as TrainingRecord, input.result as EvaluationRecord, input.notes as ExperimentNotes);
    records.set(restored.id, restored);
    return restored;
  }
  const workingInput = record(input.working, ['first', 'second', 'explanation']);
  const first = experience(workingInput.first, 'trap');
  const second = experience(workingInput.second, 'trap');
  invariant(!second || (first && first.id !== second.id));
  let savedPair: LegacyExperiencePair | null = null;
  if (input.savedPair !== null) {
    const saved = record(input.savedPair, ['first', 'second', 'explanation']);
    const first = experience(saved.first, 'trap');
    const second = experience(saved.second, 'trap');
    invariant(first && second && first.id !== second.id);
    savedPair = { first, second, explanation: note(saved.explanation) };
  }
  const home = experience(input.home, 'home');
  const current = experience(input.current, selected);
  invariant(!current || [home, first, second, savedPair?.first, savedPair?.second].some((item) => item?.id === current.id));
  const working = { first, second, explanation: note(workingInput.explanation) };
  invariant(!completePair(working) || savedPair);
  invariant(!samePair(working, savedPair) || working.explanation === savedPair?.explanation);
  if (current) {
    const currentDraft = selected === 'home' ? homeDraft : trapDraft;
    invariant(current.notes.prediction === currentDraft.prediction && current.notes.observation === currentDraft.observation,
      'Записи текущего опыта не совпадают с его черновиком.');
    invariant(selected === 'trap' ? current.model.environment.rewards.treat === trapDraft.bonus
      : typeof homeDraft.seedText === 'string' && /^\d+$/.test(homeDraft.seedText) && current.model.config.seed === Number(homeDraft.seedText),
      'Условия текущего опыта не совпадают с выбранными настройками.');
  }
  return {
    version: 1, mission: selected,
    drafts: {
      home: { seedText: seedText(homeDraft.seedText), prediction: note(homeDraft.prediction), observation: note(homeDraft.observation) },
      trap: { bonus: bonus(trapDraft.bonus), prediction: note(trapDraft.prediction), observation: note(trapDraft.observation) },
    },
    current, home, working, savedPair,
  };
}
export function loadLegacyLesson(provider?: StorageLike | (() => StorageLike)): { state: LegacyLesson | null; warning: string | null } {
  try {
    const storage = typeof provider === 'function' ? provider() : provider ?? globalThis.localStorage;
    const raw = storage.getItem(LEGACY_STORAGE_KEY);
    if (raw === null) return { state: null, warning: null };
    invariant(raw.length <= MAX_STORAGE_LENGTH);
    return { state: freezeDeep(parseLegacyLesson(JSON.parse(raw))), warning: null };
  } catch {
    return { state: null, warning: 'Не удалось открыть архив правил v1: хранилище недоступно или данные повреждены. Исходная запись не изменена.' };
  }
}
