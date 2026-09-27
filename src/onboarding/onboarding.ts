import type { LabState } from '../app/labController';

export type OnboardingStep =
  | 'welcome' | 'ground' | 'prediction' | 'training'
  | 'check' | 'observation' | 'question' | 'finish';
export interface OnboardingState {
  readonly version: 1;
  readonly status: 'new' | 'in-progress' | 'skipped' | 'completed';
  readonly step: OnboardingStep;
  readonly trapHintDismissed: boolean;
}
export interface OnboardingContext {
  readonly mission: 'home' | 'trap';
  readonly viewingSaved: boolean;
  readonly hasModel: boolean;
  readonly hasResult: boolean;
  readonly status: LabState['status'];
}
export type OnboardingAction =
  | { type: 'BEGIN' | 'RESTART' | 'SKIP' | 'FINISH' | 'DISMISS_TRAP_HINT' }
  | { type: 'NEXT'; context: OnboardingContext; answered?: boolean }
  | { type: 'SYNC'; context: OnboardingContext };

export const ONBOARDING_STORAGE_KEY = 'goweinerdog.onboarding.v1';
export const MAX_ONBOARDING_STORAGE_LENGTH = 4096;
export interface OnboardingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
type StorageProvider = OnboardingStorage | (() => OnboardingStorage);
export type OnboardingStorageIssue = 'unavailable' | 'invalid' | null;

export function emptyOnboarding(): OnboardingState {
  return { version: 1, status: 'new', step: 'welcome', trapHintDismissed: false };
}

function isPracticalContext(context: OnboardingContext): boolean {
  return context.mission === 'home' && !context.viewingSaved;
}

/** Подсказка следует реальным данным, а не проценту прогресса или таймеру. */
export function reconcileOnboarding(state: OnboardingState, context: OnboardingContext): OnboardingState {
  if (state.status !== 'in-progress' || !isPracticalContext(context)
    || state.step === 'welcome' || state.step === 'ground' || state.step === 'prediction') return state;

  // После перезагрузки незавершённый Worker не существует. Отсутствие модели
  // требует настоящей тренировки, даже если раньше была открыта поздняя подсказка.
  if (!context.hasModel || context.status === 'training') {
    return state.step === 'training' ? state : { ...state, step: 'training' };
  }
  if (!context.hasResult || context.status === 'evaluating') {
    return state.step === 'check' ? state : { ...state, step: 'check' };
  }
  // Успех и timeout одинаково подходят для наблюдения: вывод делает ученик.
  if (state.step === 'training' || state.step === 'check') return { ...state, step: 'observation' };
  return state;
}

/** Не запускает Worker и не изменяет занятие, награды, прогноз или наблюдение. */
export function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'BEGIN':
      return state.step === 'welcome' && (state.status === 'new' || state.status === 'in-progress')
        ? { ...state, status: 'in-progress', step: 'ground' } : state;
    case 'RESTART':
      return { ...state, status: 'in-progress', step: 'welcome' };
    case 'SKIP':
      return state.status === 'completed' || state.status === 'skipped' ? state : { ...state, status: 'skipped' };
    case 'FINISH':
      return state.status === 'in-progress' && state.step === 'finish' ? { ...state, status: 'completed' } : state;
    case 'DISMISS_TRAP_HINT':
      return state.trapHintDismissed ? state : { ...state, trapHintDismissed: true };
    case 'SYNC':
      return reconcileOnboarding(state, action.context);
    case 'NEXT': {
      if (state.status !== 'in-progress' || !isPracticalContext(action.context)) return state;
      const actual = reconcileOnboarding(state, action.context);
      // При смене реального состояния сначала показываем соответствующую
      // подсказку. Старое нажатие не должно проскочить ещё один этап.
      if (actual !== state) return actual;
      switch (state.step) {
        case 'ground': return { ...state, step: 'prediction' };
        case 'prediction': return reconcileOnboarding({ ...state, step: 'training' }, action.context);
        case 'observation': return { ...state, step: 'question' };
        case 'question': return action.answered ? { ...state, step: 'finish' } : state;
        default: return state;
      }
    }
  }
}

const STEPS: readonly OnboardingStep[] = ['welcome', 'ground', 'prediction', 'training', 'check', 'observation', 'question', 'finish'];
function validateOnboarding(value: unknown): OnboardingState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = ['version', 'status', 'step', 'trapHintDismissed'];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => Object.hasOwn(record, key))
    || record.version !== 1 || typeof record.trapHintDismissed !== 'boolean'
    || typeof record.status !== 'string' || !['new', 'in-progress', 'skipped', 'completed'].includes(record.status)
    || !STEPS.includes(record.step as OnboardingStep)) return null;
  if ((record.status === 'new' && record.step !== 'welcome')
    || (record.status === 'completed' && record.step !== 'finish')) return null;
  return { version: 1, status: record.status as OnboardingState['status'], step: record.step as OnboardingStep, trapHintDismissed: record.trapHintDismissed };
}

const browserStorage = (): OnboardingStorage => globalThis.localStorage;
function getStorage(provider: StorageProvider): OnboardingStorage {
  return typeof provider === 'function' ? provider() : provider;
}

/** Читать один раз при создании состояния UI, затем хранить его в памяти React. */
export function loadOnboarding(provider: StorageProvider = browserStorage): { state: OnboardingState; issue: OnboardingStorageIssue } {
  let raw: string | null;
  try {
    raw = getStorage(provider).getItem(ONBOARDING_STORAGE_KEY);
  } catch {
    return { state: emptyOnboarding(), issue: 'unavailable' };
  }
  if (raw === null) return { state: emptyOnboarding(), issue: null };
  if (raw.length > MAX_ONBOARDING_STORAGE_LENGTH) return { state: emptyOnboarding(), issue: 'invalid' };
  try {
    const state = validateOnboarding(JSON.parse(raw));
    return state ? { state, issue: null } : { state: emptyOnboarding(), issue: 'invalid' };
  } catch {
    return { state: emptyOnboarding(), issue: 'invalid' };
  }
}

/** Ошибка записи не заменяет состояние UI и не затрагивает сохранённое занятие. */
export function saveOnboarding(state: OnboardingState, provider: StorageProvider = browserStorage): { saved: boolean; issue: OnboardingStorageIssue } {
  const checked = validateOnboarding(state);
  if (!checked) return { saved: false, issue: 'invalid' };
  try {
    getStorage(provider).setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(checked));
    return { saved: true, issue: null };
  } catch {
    return { saved: false, issue: 'unavailable' };
  }
}
