import { describe, expect, it, vi } from 'vitest';
import * as currentEvaluation from '../evaluation/evaluate';
import { RULES_VERSION, STATE_ENCODING_VERSION } from '../domain/state';
import type { TrainingResult } from '../domain/types';
import { train } from '../learning/train';
import { TRAP_ENVIRONMENT, TRAP_TRAINING } from '../missions';
import legacyFixture from './fixtures/lesson-v1.json';
import { LEGACY_STORAGE_KEY, loadLegacyLesson, type LegacyLesson } from './legacy';
import { captureLessonExperience, emptyLesson, lessonReducer, loadLesson, saveLesson, STORAGE_KEY, type Experience, type StorageLike } from './lesson';
import { captureExperiment, compareExperiments } from './session';

// Получен настоящим train/evaluate из b355217: старые правила и 36 строк Q.
// В fixture сохранены оба результата +5/+1, первая миссия и исходные заметки.
const golden = JSON.stringify(legacyFixture);
function storageWithLegacy(raw = golden) {
  const data = new Map<string, string>([[LEGACY_STORAGE_KEY, raw]]);
  const writes: string[] = [];
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); data.set(key, value); },
  };
  return { storage, data, writes };
}
function newExperience(): Experience {
  const model = train(TRAP_ENVIRONMENT, TRAP_TRAINING);
  return captureLessonExperience('new-rules', 'trap', model, currentEvaluation.evaluate(model.environment, model.q, model.config.maxSteps), { prediction: 'Мой новый прогноз', observation: 'Моё новое наблюдение' });
}

describe('Архив исходных опытов по прежним правилам v1', () => {
  it('возвращает исходные условия, модели, результаты и записи без пересчёта текущим алгоритмом', () => {
    const { storage, data, writes } = storageWithLegacy();
    const evaluate = vi.spyOn(currentEvaluation, 'evaluate');
    const loaded = loadLegacyLesson(storage);
    expect(loaded.warning).toBeNull();
    expect(loaded.state).toEqual(legacyFixture);
    expect(loaded.state?.savedPair?.first.model.q).toHaveLength(36);
    expect(loaded.state?.savedPair?.first.result).toMatchObject({ reward: 150, steps: 100, treatEntries: 50, outcome: 'timeout' });
    expect(loaded.state?.savedPair?.second.result).toMatchObject({ reward: 8, steps: 5, treatEntries: 1, outcome: 'goal' });
    expect(loaded.state?.home?.result).toMatchObject({ reward: 10, steps: 10, outcome: 'goal' });
    expect(loaded.state?.savedPair?.explanation).toBe(legacyFixture.savedPair.explanation);
    expect(evaluate).not.toHaveBeenCalled();
    evaluate.mockRestore();
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(golden);
    expect(writes).toEqual([]);
    expect(Object.isFrozen(loaded.state?.savedPair?.first.model.q[0])).toBe(true);
    expect(Object.isFrozen(loaded.state?.savedPair?.first.notes)).toBe(true);
    expect(loaded.state?.current).toBe(loaded.state?.savedPair?.second);
  });

  it('не принимает повреждённый архив и оставляет его строку в хранилище без изменений', () => {
    const changed = structuredClone(legacyFixture);
    changed.savedPair.first.result.transitions[0].rewardParts.treat = 0;
    const raw = JSON.stringify(changed);
    const { storage, data, writes } = storageWithLegacy(raw);
    const loaded = loadLegacyLesson(storage);
    expect(loaded.state).toBeNull();
    expect(loaded.warning).toMatch(/Исходная запись не изменена/);
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(raw);
    expect(writes).toEqual([]);
  });

  it('не допускает подмены версии, числа строк Q или маршрута старого опыта', () => {
    for (const mutate of [
      (data: LegacyLesson) => { (data as { version: number }).version = 2; },
      (data: LegacyLesson) => { data.savedPair!.first.model.q.push([0, 0, 0, 0]); },
      (data: LegacyLesson) => { data.savedPair!.first.result.positions[0] = 1; },
      (data: LegacyLesson) => { data.savedPair!.first.model.rulesVersion = RULES_VERSION; },
    ]) {
      const changed = structuredClone(legacyFixture) as unknown as LegacyLesson;
      mutate(changed);
      expect(loadLegacyLesson(storageWithLegacy(JSON.stringify(changed)).storage).state).toBeNull();
    }
  });

  it('понятно сообщает о закрытом хранилище и принимает отсутствие архива', () => {
    expect(loadLegacyLesson({ getItem: () => null, setItem: () => {} })).toEqual({ state: null, warning: null });
    expect(loadLegacyLesson(() => { throw new DOMException('Denied', 'SecurityError'); }).warning).toMatch(/недоступно/);
  });
});

describe('Отдельное занятие v2 и совместимость сохранений', () => {
  it('переносит только выбранные условия в новый черновик и сохраняет прогнозы с результатами в архиве', () => {
    const { storage, data, writes } = storageWithLegacy();
    const loaded = loadLesson(storage);
    expect(loaded.warning).toBeNull();
    expect(loaded.state).toEqual({
      ...emptyLesson(), mission: 'trap',
      drafts: {
        home: { seedText: '42', prediction: '', observation: '' },
        trap: { bonus: 1, prediction: '', observation: '' },
      },
    });
    expect(loaded.state.current).toBeNull();
    expect(loaded.state.working.first).toBeNull();
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(golden);
    expect(writes).toEqual([]);
  });

  it('сохраняет и восстанавливает новую модель с 72 состояниями, не перезаписывая v1 или прогресс знакомства', () => {
    const { storage, data, writes } = storageWithLegacy();
    const onboardingKey = 'goweinerdog.onboarding.v1';
    data.set(onboardingKey, 'untouched-onboarding-state');
    const completed = lessonReducer({ ...emptyLesson(), mission: 'trap' }, { type: 'complete', experience: newExperience() });
    expect(completed.current?.model.q).toHaveLength(72);
    expect(completed.current?.model.rulesVersion).toBe(RULES_VERSION);
    expect(completed.current?.model.stateEncodingVersion).toBe(STATE_ENCODING_VERSION);
    expect(completed.current?.result.treatCollections).toBe(1);
    expect(completed.current?.result.states[0].treatCollected).toBe(false);
    expect(completed.current?.result.states[1].treatCollected).toBe(true);
    expect(saveLesson(completed, storage)).toEqual({ ok: true });
    expect(loadLesson(storage)).toEqual({ state: completed, warning: null });
    expect(writes).toEqual([STORAGE_KEY]);
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(golden);
    expect(data.get(onboardingKey)).toBe('untouched-onboarding-state');
    expect(loadLegacyLesson(storage).state).toEqual(legacyFixture);
    const reset = lessonReducer(completed, { type: 'restart' });
    saveLesson(reset, storage);
    expect(loadLesson(storage).state).toEqual(reset);
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(golden);
    expect(data.get(onboardingKey)).toBe('untouched-onboarding-state');
  });

  it('повреждённая v2-запись не подменяется прежним результатом и загрузка ничего не перезаписывает', () => {
    const { storage, data, writes } = storageWithLegacy();
    data.set(STORAGE_KEY, '{broken v2');
    const loaded = loadLesson(storage);
    expect(loaded.warning).toMatch(/повреждены/);
    expect(loaded.state).toEqual(emptyLesson());
    expect(data.get(STORAGE_KEY)).toBe('{broken v2');
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(golden);
    expect(writes).toEqual([]);
    expect(loadLegacyLesson(storage).state).toEqual(legacyFixture);
  });

  it('не считает старый и новый опыт парой с изменением только бонуса', () => {
    const old = loadLegacyLesson(storageWithLegacy().storage).state!.savedPair!;
    const current = newExperience();
    const comparison = compareExperiments(old.first, current);
    expect(comparison.comparable).toBe(false);
    expect(comparison.bonusChanged).toBe(false);
    expect(comparison.differences).toEqual([
      { key: 'rulesVersion', label: 'Версия правил', before: 'repeat-treat-v1', after: RULES_VERSION },
      { key: 'stateEncodingVersion', label: 'Формат состояния', before: 'cell-v1', after: STATE_ENCODING_VERSION },
      { key: 'algorithmVersion', label: 'Версия алгоритма', before: 'tabular-q-learning-v1', after: 'tabular-q-learning-v2' },
    ]);
    expect(compareExperiments(old.first, old.second)).toMatchObject({ comparable: true, bonusChanged: true });
  });

  it('отклоняет попытку сохранить старую модель как новый опыт даже если тип принудительно подменён', () => {
    const { storage, data } = storageWithLegacy();
    const old = loadLegacyLesson(storage).state!.savedPair!.first;
    const disguised = old as unknown as Experience;
    expect(() => captureLessonExperience('old-as-new', 'trap', disguised.model, disguised.result, disguised.notes)).toThrow();
    expect(() => captureExperiment('old-as-new', old.model as TrainingResult, disguised.result, old.notes)).toThrow(/Старый опыт/);
    const state = { ...emptyLesson(), mission: 'trap' as const };
    expect(lessonReducer(state, { type: 'complete', experience: disguised })).toBe(state);
    expect(saveLesson({ ...state, current: disguised }, storage).ok).toBe(false);
    expect(data.has(STORAGE_KEY)).toBe(false);
    expect(data.get(LEGACY_STORAGE_KEY)).toBe(golden);
  });
});
