import type { EvaluationResult, TrainingResult } from '../domain/types';
import { evaluate } from '../evaluation/evaluate';
import { ALGORITHM_VERSION } from '../learning/qLearning';
import { PRNG_VERSION } from '../learning/random';
import { DEFAULT_TRAINING, HOME_ENVIRONMENT, TRAP_ENVIRONMENT, TRAP_TRAINING } from '../missions';
import type { ExperimentNotes } from './session';

export type Mission = 'home' | 'trap';
export interface Experience {
  readonly id: string;
  readonly missionId: Mission;
  readonly model: TrainingResult;
  readonly result: EvaluationResult;
  readonly evaluationMaxSteps: number;
  readonly notes: ExperimentNotes;
}
export interface ExperiencePair { first: Experience; second: Experience; explanation: string }
export interface LessonState {
  version: 1;
  mission: Mission;
  drafts: {
    home: { seedText: string; prediction: string; observation: string };
    trap: { bonus: number; prediction: string; observation: string };
  };
  current: Experience | null;
  home: Experience | null;
  working: { first: Experience | null; second: Experience | null; explanation: string };
  savedPair: ExperiencePair | null;
}
export type LessonAction =
  | { type: 'draft'; mission: 'home'; patch: Partial<LessonState['drafts']['home']> }
  | { type: 'draft'; mission: 'trap'; patch: Partial<LessonState['drafts']['trap']> }
  | { type: 'complete'; experience: Experience }
  | { type: 'observation'; id: string; value: string }
  | { type: 'explanation'; scope: 'working' | 'saved'; value: string }
  | { type: 'prepare'; mission?: Mission }
  | { type: 'changeBonus'; bonus: number }
  | { type: 'mission'; mission: Mission }
  | { type: 'seed'; seedText: string }
  | { type: 'commitPair' }
  | { type: 'restart' };

export const STORAGE_KEY = 'goweinerdog.lesson.v1';
export const MAX_STORAGE_LENGTH = 1_500_000;
const MAX_NOTE_LENGTH = 1500;
export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }
type StorageProvider = StorageLike | (() => StorageLike);

export function emptyLesson(): LessonState {
  return {
    version: 1, mission: 'home',
    drafts: {
      home: { seedText: String(DEFAULT_TRAINING.seed), prediction: '', observation: '' },
      trap: { bonus: TRAP_ENVIRONMENT.rewards.treat, prediction: '', observation: '' },
    },
    current: null, home: null, working: { first: null, second: null, explanation: '' }, savedPair: null,
  };
}

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

/** При восстановлении не обучаем заново: проверяем форму Q и пересчитываем её короткий проверочный путь. */
function validateModel(value: unknown, selected: Mission): TrainingResult {
  const model = record(value, ['q', 'config', 'environment', 'metrics', 'updates', 'algorithmVersion', 'prngVersion']);
  const config = record(model.config, Object.keys(DEFAULT_TRAINING));
  invariant(Number.isInteger(config.seed) && Number(config.seed) >= 0 && Number(config.seed) <= 0xffffffff);
  const expectedConfig = selected === 'home' ? { ...DEFAULT_TRAINING, seed: config.seed } : TRAP_TRAINING;
  invariant(same(config, expectedConfig), 'Настройки сохранённой тренировки не соответствуют миссии.');
  const environment = model.environment as TrainingResult['environment'] | undefined;
  invariant(environment && typeof environment === 'object' && environment.rewards);
  const expectedEnvironment = selected === 'home' ? HOME_ENVIRONMENT : {
    ...TRAP_ENVIRONMENT, rewards: { ...TRAP_ENVIRONMENT.rewards, treat: bonus(environment.rewards.treat) },
  };
  invariant(same(environment, expectedEnvironment), 'Сохранённая площадка не соответствует миссии.');
  invariant(model.algorithmVersion === ALGORITHM_VERSION && model.prngVersion === PRNG_VERSION, 'Версия алгоритма сохранённого опыта не поддерживается.');
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
  return value as TrainingResult;
}

export function captureLessonExperience(
  id: string, selected: Mission, model: TrainingResult, result: EvaluationResult, notes: ExperimentNotes,
): Experience {
  invariant(typeof id === 'string' && id.length > 0 && id.length <= 120);
  mission(selected);
  validateModel(model, selected);
  const checkedNotes = validNotes(notes);
  const calculated = evaluate(model.environment, model.q, model.config.maxSteps);
  invariant(same(calculated, result), 'Результат проверки не соответствует модели этого опыта.');
  return freezeDeep(structuredClone({ id, missionId: selected, model, result, evaluationMaxSteps: model.config.maxSteps, notes: checkedNotes }));
}

function completePair(pair: LessonState['working']): pair is ExperiencePair { return !!pair.first && !!pair.second; }
function samePair(a: LessonState['working'], b: ExperiencePair | null): boolean {
  return !!b && a.first?.id === b.first.id && a.second?.id === b.second.id;
}
export function canStartTrap(state: LessonState): boolean {
  return !completePair(state.working) || samePair(state.working, state.savedPair);
}
function prepare(state: LessonState, selected: Mission): LessonState {
  const next = { ...state, current: null, drafts: { ...state.drafts, [selected]: { ...state.drafts[selected], prediction: '', observation: '' } } };
  if (selected === 'trap' && completePair(state.working) && samePair(state.working, state.savedPair)) {
    return { ...next, working: { first: null, second: null, explanation: '' } };
  }
  return next;
}
function allExperiences(state: LessonState): Experience[] {
  return [state.current, state.home, state.working.first, state.working.second, state.savedPair?.first, state.savedPair?.second].filter((item): item is Experience => !!item);
}

/** Здесь меняются записи занятия, но никогда — уже рассчитанные условия, модель или путь. */
export function lessonReducer(state: LessonState, action: LessonAction): LessonState {
  switch (action.type) {
    case 'draft': {
      const draft = { ...state.drafts[action.mission], ...action.patch };
      note(draft.prediction); note(draft.observation);
      if ('bonus' in draft) bonus(draft.bonus);
      if ('seedText' in draft) seedText(draft.seedText);
      return { ...state, drafts: { ...state.drafts, [action.mission]: draft } };
    }
    case 'complete': {
      const experience = action.experience;
      if (experience.missionId !== state.mission) return state;
      // Дополнительная защита слоя занятия: запоздавший результат с прежними
      // условиями не должен становиться текущим после сброса контроллера.
      if (experience.missionId === 'trap' ? experience.model.environment.rewards.treat !== state.drafts.trap.bonus
        : !/^\d+$/.test(state.drafts.home.seedText) || experience.model.config.seed !== Number(state.drafts.home.seedText)) return state;
      const existing = allExperiences(state).find((item) => item.id === experience.id);
      if (existing) return state;
      const drafts = { ...state.drafts, [experience.missionId]: { ...state.drafts[experience.missionId], ...experience.notes } };
      if (experience.missionId === 'home') return { ...state, drafts, current: experience, home: experience };
      if (!canStartTrap(state)) return state;
      const working = completePair(state.working) ? { first: experience, second: null, explanation: '' }
        : state.working.first ? { ...state.working, second: experience }
          : { first: experience, second: null, explanation: '' };
      return { ...state, drafts, current: experience, working, savedPair: state.savedPair ?? (completePair(working) ? working : null) };
    }
    case 'observation': {
      note(action.value);
      const existing = allExperiences(state).find((item) => item.id === action.id);
      if (!existing) return state;
      const updated = Object.freeze({ ...existing, notes: Object.freeze({ ...existing.notes, observation: action.value }) });
      const replace = (item: Experience | null) => item?.id === action.id ? updated : item;
      return {
        ...state, current: replace(state.current), home: replace(state.home),
        drafts: state.current?.id === action.id ? { ...state.drafts, [existing.missionId]: { ...state.drafts[existing.missionId], observation: action.value } } : state.drafts,
        working: { ...state.working, first: replace(state.working.first), second: replace(state.working.second) },
        savedPair: state.savedPair ? { ...state.savedPair, first: replace(state.savedPair.first)!, second: replace(state.savedPair.second)! } : null,
      };
    }
    case 'explanation': {
      note(action.value);
      const synchronized = samePair(state.working, state.savedPair);
      return {
        ...state,
        working: action.scope === 'working' || synchronized ? { ...state.working, explanation: action.value } : state.working,
        savedPair: state.savedPair && (action.scope === 'saved' || synchronized) ? { ...state.savedPair, explanation: action.value } : state.savedPair,
      };
    }
    case 'prepare': return prepare(state, action.mission ?? state.mission);
    case 'changeBonus': {
      bonus(action.bonus);
      if (state.drafts.trap.bonus === action.bonus) return state;
      const next = prepare(state, 'trap');
      return { ...next, drafts: { ...next.drafts, trap: { ...next.drafts.trap, bonus: action.bonus } } };
    }
    case 'mission': return state.mission === action.mission ? state : { ...state, mission: action.mission, current: null };
    case 'seed': {
      seedText(action.seedText);
      return { ...state, current: state.mission === 'home' ? null : state.current, drafts: { ...state.drafts, home: { ...state.drafts.home, seedText: action.seedText, observation: '' } } };
    }
    case 'commitPair': return completePair(state.working) ? { ...state, savedPair: { ...state.working } } : state;
    case 'restart': return { ...emptyLesson(), mission: state.mission };
  }
}

function parseLesson(value: unknown): LessonState {
  const input = record(value, ['version', 'mission', 'drafts', 'current', 'home', 'working', 'savedPair']);
  invariant(input.version === 1, 'Версия сохранённого занятия не поддерживается.');
  const selected = mission(input.mission);
  const drafts = record(input.drafts, ['home', 'trap']);
  const homeDraft = record(drafts.home, ['seedText', 'prediction', 'observation']);
  const trapDraft = record(drafts.trap, ['bonus', 'prediction', 'observation']);
  const records = new Map<string, Experience>();
  function experience(value: unknown, expected?: Mission): Experience | null {
    if (value === null) return null;
    const input = record(value, ['id', 'missionId', 'model', 'result', 'evaluationMaxSteps', 'notes']);
    const selected = mission(input.missionId);
    invariant(!expected || selected === expected);
    invariant(input.evaluationMaxSteps === 100);
    invariant(typeof input.id === 'string');
    const previous = records.get(input.id);
    if (previous) { invariant(same(previous, input), 'Один опыт содержит противоречивые копии.'); return previous; }
    const restored = captureLessonExperience(input.id, selected, input.model as TrainingResult, input.result as EvaluationResult, input.notes as ExperimentNotes);
    records.set(restored.id, restored);
    return restored;
  }
  const workingInput = record(input.working, ['first', 'second', 'explanation']);
  const first = experience(workingInput.first, 'trap');
  const second = experience(workingInput.second, 'trap');
  invariant(!second || (first && first.id !== second.id));
  let savedPair: ExperiencePair | null = null;
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
function storageFrom(provider?: StorageProvider): StorageLike {
  // Доступ к самому свойству localStorage тоже может бросить SecurityError.
  return typeof provider === 'function' ? provider() : provider ?? globalThis.localStorage;
}
export function loadLesson(provider?: StorageProvider): { state: LessonState; warning: string | null } {
  try {
    const raw = storageFrom(provider).getItem(STORAGE_KEY);
    if (raw === null) return { state: emptyLesson(), warning: null };
    invariant(raw.length <= MAX_STORAGE_LENGTH, 'Сохранённое занятие слишком большое.');
    return { state: parseLesson(JSON.parse(raw)), warning: null };
  } catch {
    return { state: emptyLesson(), warning: 'Не удалось восстановить занятие: хранилище недоступно или данные повреждены. Можно начать новое занятие.' };
  }
}
export function saveLesson(state: LessonState, provider?: StorageProvider): { ok: true } | { ok: false; error: string } {
  try {
    const raw = JSON.stringify(state);
    invariant(raw.length <= MAX_STORAGE_LENGTH);
    storageFrom(provider).setItem(STORAGE_KEY, raw);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Не удалось сохранить занятие на устройстве. Результаты доступны в этой вкладке, но могут потеряться после перезагрузки.' };
  }
}
