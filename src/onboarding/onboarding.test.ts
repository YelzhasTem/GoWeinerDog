import { describe, expect, it, vi } from 'vitest';
import {
  emptyOnboarding,
  isOnboardingArchivePaused,
  loadOnboarding,
  MAX_ONBOARDING_STORAGE_LENGTH,
  ONBOARDING_STORAGE_KEY,
  onboardingReducer,
  reconcileOnboarding,
  saveOnboarding,
  type OnboardingContext,
  type OnboardingState,
} from './onboarding';

const idle: OnboardingContext = { mission: 'home', viewingSaved: false, hasModel: false, hasResult: false, status: 'idle' };
const trained: OnboardingContext = { ...idle, hasModel: true, status: 'trained' };
const ready: OnboardingContext = { ...trained, hasResult: true, status: 'ready' };
function at(step: Exclude<OnboardingState['step'], 'welcome'>): OnboardingState {
  return { ...emptyOnboarding(), status: 'in-progress', step };
}
function memoryStorage(raw: string | null = null) {
  const entries = new Map<string, string>([['goweinerdog.lesson.v1', 'saved lesson remains unchanged']]);
  if (raw !== null) entries.set(ONBOARDING_STORAGE_KEY, raw);
  return {
    entries,
    getItem: vi.fn((key: string) => entries.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { entries.set(key, value); }),
  };
}

describe('знакомство следует реальному эксперименту', () => {
  it('проходит полный цикл только после модели, результата и выбранного ответа', () => {
    let state = emptyOnboarding();
    state = onboardingReducer(state, { type: 'BEGIN' });
    expect(state).toEqual(at('ground'));
    state = onboardingReducer(state, { type: 'NEXT', context: idle });
    expect(state.step).toBe('prediction');
    // Прогноз не обязателен. У знакомства нет второго поля учебных записей.
    state = onboardingReducer(state, { type: 'NEXT', context: idle });
    expect(state.step).toBe('training');
    expect(onboardingReducer(state, { type: 'NEXT', context: idle })).toBe(state);
    state = onboardingReducer(state, { type: 'SYNC', context: trained });
    expect(state.step).toBe('check');
    expect(onboardingReducer(state, { type: 'NEXT', context: trained })).toBe(state);
    state = onboardingReducer(state, { type: 'SYNC', context: ready });
    expect(state.step).toBe('observation');
    state = onboardingReducer(state, { type: 'NEXT', context: ready });
    expect(state.step).toBe('question');
    expect(onboardingReducer(state, { type: 'NEXT', context: ready })).toBe(state);
    state = onboardingReducer(state, { type: 'NEXT', context: ready, answered: true });
    expect(state).toEqual(at('finish'));
    state = onboardingReducer(state, { type: 'FINISH' });
    expect(state).toEqual({ ...at('finish'), status: 'completed' });
  });

  it('не отмечает знакомство завершённым до завершающей карточки', () => {
    for (const state of [emptyOnboarding(), at('ground'), at('training'), at('question')]) {
      expect(onboardingReducer(state, { type: 'FINISH' })).toBe(state);
    }
  });

  it('не считает Worker с прогрессом или старым результатом завершённой тренировкой', () => {
    const state = at('training');
    const active: OnboardingContext = { ...ready, status: 'training' };
    expect(reconcileOnboarding(state, active)).toBe(state);
    expect(onboardingReducer(state, { type: 'NEXT', context: active })).toBe(state);
    expect(reconcileOnboarding(at('finish'), active).step).toBe('training');
  });

  it.each(['cancelled', 'error', 'idle'] as const)('при %s без модели остаётся доступен новый запуск', (status) => {
    const state = at('training');
    expect(reconcileOnboarding(state, { ...idle, status })).toBe(state);
    expect(reconcileOnboarding(state, trained).step).toBe('check');
  });

  it.each(['cancelled', 'error'] as const)('при %s проверки сохраняет шаг проверки и позволяет повторить её', (status) => {
    const state = at('check');
    expect(reconcileOnboarding(state, { ...trained, status })).toBe(state);
    expect(reconcileOnboarding(state, ready).step).toBe('observation');
  });

  it('повторная проверка ждёт нового результата, даже если передан прежний', () => {
    expect(reconcileOnboarding(at('observation'), { ...ready, status: 'evaluating' }).step).toBe('check');
  });

  it('не пропускает наблюдение при нажатии со старой подсказки', () => {
    const actual = onboardingReducer(at('check'), { type: 'NEXT', context: ready });
    expect(actual.step).toBe('observation');
  });

  it('с существующим опытом всё равно показывает площадку и прогноз, затем настоящий результат', () => {
    const initial = onboardingReducer(emptyOnboarding(), { type: 'BEGIN' });
    expect(reconcileOnboarding(initial, ready).step).toBe('ground');
    const prediction = onboardingReducer(initial, { type: 'NEXT', context: ready });
    expect(reconcileOnboarding(prediction, ready).step).toBe('prediction');
    expect(onboardingReducer(prediction, { type: 'NEXT', context: ready }).step).toBe('observation');
  });

  it('после перезагрузки возвращается к тренировке, если незавершённый Worker не восстановился', () => {
    for (const step of ['training', 'check', 'observation', 'question', 'finish'] as const) {
      const storage = memoryStorage(JSON.stringify(at(step)));
      const restored = loadOnboarding(storage).state;
      expect(reconcileOnboarding(restored, idle).step).toBe('training');
    }
  });

  it.each(['observation', 'question', 'finish'] as const)('архив v1 сохраняет поздний шаг %s без выдачи старого результата за новый', (step) => {
    const previous = at(step);
    const raw = JSON.stringify(previous);
    const storage = memoryStorage(raw);
    const restored = loadOnboarding(storage).state;
    const archived = { ...idle, hasArchivedHome: true };
    expect(isOnboardingArchivePaused(restored, archived)).toBe(true);
    expect(reconcileOnboarding(restored, archived)).toBe(restored);
    expect(onboardingReducer(restored, { type: 'SYNC', context: archived })).toBe(restored);
    expect(onboardingReducer(restored, { type: 'NEXT', context: archived, answered: true })).toBe(restored);
    // Просмотр и возврат не подменяют Q-таблицу и не сбрасывают знакомство.
    expect(reconcileOnboarding(restored, { ...archived, viewingSaved: true })).toBe(restored);
    expect(reconcileOnboarding(restored, archived)).toEqual(previous);
    expect(storage.entries.get(ONBOARDING_STORAGE_KEY)).toBe(raw);
    expect(storage.setItem).not.toHaveBeenCalled();
    // Только явный выбор разрешает перейти к повторному настоящему обучению.
    const continued = onboardingReducer(restored, { type: 'CONTINUE_WITH_NEW_TRAINING', context: archived });
    expect(continued).toEqual(at('training'));
    expect(isOnboardingArchivePaused(continued, archived)).toBe(false);
    expect(reconcileOnboarding(continued, archived)).toBe(continued);
    expect(reconcileOnboarding(continued, { ...trained, hasArchivedHome: true }).step).toBe('check');
    expect(reconcileOnboarding(at('check'), { ...ready, hasArchivedHome: true }).step).toBe('observation');
  });

  it('архив не блокирует обычное знакомство, новый опыт и восстановление прерванного Worker', () => {
    for (const step of ['ground', 'prediction', 'training', 'check'] as const) {
      const state = at(step);
      expect(isOnboardingArchivePaused(state, { ...idle, hasArchivedHome: true })).toBe(false);
      expect(reconcileOnboarding(state, { ...idle, hasArchivedHome: true })).toEqual(reconcileOnboarding(state, idle));
    }
    expect(isOnboardingArchivePaused(at('observation'), ready)).toBe(false);
    expect(isOnboardingArchivePaused(at('observation'), { ...ready, hasArchivedHome: true })).toBe(false);
    expect(isOnboardingArchivePaused(at('observation'), { ...idle, hasArchivedHome: true, status: 'training' })).toBe(false);
    const normal = at('question');
    expect(onboardingReducer(normal, { type: 'CONTINUE_WITH_NEW_TRAINING', context: idle })).toBe(normal);
  });

  it('после восстановления модели без результата просит проверку, а с результатом — наблюдение', () => {
    expect(reconcileOnboarding(at('observation'), trained).step).toBe('check');
    expect(reconcileOnboarding(at('training'), ready).step).toBe('observation');
  });

  it('наблюдение разрешено для любого рассчитанного результата, без проверки успешности', () => {
    // Контракту намеренно не передаётся reachedHome/outcome: timeout также повод исследовать путь.
    expect(reconcileOnboarding(at('check'), ready).step).toBe('observation');
    expect(onboardingReducer(at('observation'), { type: 'NEXT', context: ready }).step).toBe('question');
  });

  it.each([
    { ...ready, mission: 'trap' as const },
    { ...ready, viewingSaved: true },
  ])('чужая миссия или сохранённый просмотр приостанавливают переходы: %o', (context) => {
    for (const step of ['ground', 'prediction', 'training', 'check', 'observation', 'question', 'finish'] as const) {
      const state = at(step);
      expect(reconcileOnboarding(state, context)).toBe(state);
      expect(onboardingReducer(state, { type: 'NEXT', context, answered: true })).toBe(state);
    }
    expect(reconcileOnboarding(at('check'), ready).step).toBe('observation');
  });

  it('результат без соответствующей модели не открывает следующие шаги', () => {
    expect(reconcileOnboarding(at('training'), { ...ready, hasModel: false }).step).toBe('training');
  });

  it('не изменяет переданные состояние и контекст', () => {
    const state = Object.freeze(at('prediction'));
    const context = Object.freeze({ ...idle });
    expect(onboardingReducer(state, { type: 'NEXT', context }).step).toBe('training');
    expect(state.step).toBe('prediction');
    expect(context).toEqual(idle);
  });
});

describe('пропуск, завершение и повторный просмотр', () => {
  it('различает новый визит, процесс, пропуск и завершение', () => {
    expect(emptyOnboarding().status).toBe('new');
    expect(onboardingReducer(emptyOnboarding(), { type: 'BEGIN' }).status).toBe('in-progress');
    expect(onboardingReducer(emptyOnboarding(), { type: 'SKIP' }).status).toBe('skipped');
    expect(onboardingReducer(at('finish'), { type: 'FINISH' }).status).toBe('completed');
  });

  it.each(['welcome', 'ground', 'prediction', 'training', 'check', 'observation', 'question', 'finish'] as const)('выход доступен на шаге %s', (step) => {
    const state = step === 'welcome' ? emptyOnboarding() : at(step);
    const skipped = onboardingReducer(state, { type: 'SKIP' });
    expect(skipped.status).toBe('skipped');
    expect(onboardingReducer(skipped, { type: 'SYNC', context: ready })).toBe(skipped);
  });

  it.each(['skipped', 'completed'] as const)('после %s повторный визит не запускает знакомство автоматически', (status) => {
    const stored = { ...at('finish'), status };
    const storage = memoryStorage(JSON.stringify(stored));
    const restored = loadOnboarding(storage).state;
    expect(restored).toEqual(stored);
    expect(onboardingReducer(restored, { type: 'BEGIN' })).toBe(restored);
    expect(reconcileOnboarding(restored, idle)).toBe(restored);
    const replay = onboardingReducer(restored, { type: 'RESTART' });
    expect(replay).toEqual({ ...emptyOnboarding(), status: 'in-progress' });
    expect(onboardingReducer(replay, { type: 'BEGIN' })).toEqual(at('ground'));
  });

  it('подсказка лакомства скрывается отдельно и не стирается при повторном знакомстве', () => {
    const dismissed = onboardingReducer(at('finish'), { type: 'DISMISS_TRAP_HINT' });
    expect(dismissed.step).toBe('finish');
    expect(dismissed.trapHintDismissed).toBe(true);
    expect(onboardingReducer(dismissed, { type: 'DISMISS_TRAP_HINT' })).toBe(dismissed);
    expect(onboardingReducer(dismissed, { type: 'RESTART' })).toEqual({ ...emptyOnboarding(), status: 'in-progress', trapHintDismissed: true });
  });

  it('явно запрошенное повторное приветствие восстанавливается после перезагрузки', () => {
    const storage = memoryStorage();
    const replay = onboardingReducer({ ...at('finish'), status: 'completed' }, { type: 'RESTART' });
    expect(saveOnboarding(replay, storage).saved).toBe(true);
    const restored = loadOnboarding(storage).state;
    expect(restored).toEqual({ ...emptyOnboarding(), status: 'in-progress' });
    expect(reconcileOnboarding(restored, ready)).toBe(restored);
    expect(onboardingReducer(restored, { type: 'BEGIN' })).toEqual(at('ground'));
  });
});

describe('отдельное безопасное хранение знакомства', () => {
  it('сохраняет версию и восстанавливает процесс, не читая и не меняя занятие', () => {
    const storage = memoryStorage();
    const before = storage.entries.get('goweinerdog.lesson.v1');
    expect(loadOnboarding(storage)).toEqual({ state: emptyOnboarding(), issue: null });
    expect(saveOnboarding(at('check'), storage)).toEqual({ saved: true, issue: null });
    expect(loadOnboarding(storage)).toEqual({ state: at('check'), issue: null });
    expect(storage.entries.get('goweinerdog.lesson.v1')).toBe(before);
    expect(storage.getItem.mock.calls.every(([key]) => key === ONBOARDING_STORAGE_KEY)).toBe(true);
    expect(storage.setItem.mock.calls.every(([key]) => key === ONBOARDING_STORAGE_KEY)).toBe(true);
  });

  it.each([
    '{broken', 'null', '[]', 'true', '42', '{}',
    JSON.stringify({ ...emptyOnboarding(), version: 2 }),
    JSON.stringify({ ...emptyOnboarding(), status: 'unknown' }),
    JSON.stringify({ ...emptyOnboarding(), status: ['new'] }),
    JSON.stringify({ ...emptyOnboarding(), status: { value: 'new' } }),
    JSON.stringify({ ...emptyOnboarding(), step: 'unknown' }),
    JSON.stringify({ ...emptyOnboarding(), trapHintDismissed: 'false' }),
    JSON.stringify({ ...emptyOnboarding(), secretExtra: 'unexpected' }),
    JSON.stringify({ ...emptyOnboarding(), status: 'completed' }),
    JSON.stringify({ ...emptyOnboarding(), step: 'finish' }),
    ' '.repeat(MAX_ONBOARDING_STORAGE_LENGTH + 1),
  ])('повреждённые или неподдерживаемые данные не ломают приложение: %s', (raw) => {
    expect(loadOnboarding(memoryStorage(raw))).toEqual({ state: emptyOnboarding(), issue: 'invalid' });
  });

  it('отказ доступа к localStorage безопасен, включая getter самого хранилища', () => {
    const denied = () => { throw new DOMException('Access denied', 'SecurityError'); };
    expect(loadOnboarding(denied)).toEqual({ state: emptyOnboarding(), issue: 'unavailable' });
    expect(saveOnboarding(at('prediction'), denied)).toEqual({ saved: false, issue: 'unavailable' });
    expect(loadOnboarding({ getItem: denied, setItem: vi.fn() }).issue).toBe('unavailable');
  });

  it('при переполненном хранилище знакомство продолжается в памяти без повторного приветствия', () => {
    const denied = { getItem: () => null, setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); } };
    let state = loadOnboarding(denied).state;
    state = onboardingReducer(state, { type: 'BEGIN' });
    expect(saveOnboarding(state, denied).saved).toBe(false);
    state = onboardingReducer(state, { type: 'NEXT', context: idle });
    expect(saveOnboarding(state, denied).issue).toBe('unavailable');
    expect(state.step).toBe('prediction');
    state = onboardingReducer(state, { type: 'SKIP' });
    expect(saveOnboarding(state, denied).saved).toBe(false);
    expect(reconcileOnboarding(state, ready).status).toBe('skipped');
  });

  it('не записывает некорректное состояние поверх сохранённого', () => {
    const storage = memoryStorage(JSON.stringify(at('check')));
    expect(saveOnboarding({ ...at('check'), version: 2 } as unknown as OnboardingState, storage)).toEqual({ saved: false, issue: 'invalid' });
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(loadOnboarding(storage).state).toEqual(at('check'));
  });
});
