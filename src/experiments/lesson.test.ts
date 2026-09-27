import { beforeAll, describe, expect, it } from 'vitest';
import { train } from '../learning/train';
import { evaluate } from '../evaluation/evaluate';
import { DEFAULT_TRAINING, HOME_ENVIRONMENT, TRAP_ENVIRONMENT, TRAP_TRAINING } from '../missions';
import {
  canStartTrap, captureLessonExperience, emptyLesson, lessonReducer, loadLesson,
  MAX_STORAGE_LENGTH, saveLesson, STORAGE_KEY,
  type Experience, type LessonState, type StorageLike,
} from './lesson';

let high: Experience;
let low: Experience;
let home: Experience;
beforeAll(() => {
  const highModel = train(TRAP_ENVIRONMENT, TRAP_TRAINING);
  const lowModel = train({ ...TRAP_ENVIRONMENT, rewards: { ...TRAP_ENVIRONMENT.rewards, treat: 1 } }, TRAP_TRAINING);
  const homeModel = train(HOME_ENVIRONMENT, DEFAULT_TRAINING);
  high = captureLessonExperience('first', 'trap', highModel, evaluate(highModel.environment, highModel.q, 100), { prediction: 'Будет возвращаться за лакомством', observation: '' });
  low = captureLessonExperience('second', 'trap', lowModel, evaluate(lowModel.environment, lowModel.q, 100), { prediction: 'Пойдёт домой', observation: 'Дошла до домика' });
  home = captureLessonExperience('home', 'home', homeModel, evaluate(homeModel.environment, homeModel.q, 100), { prediction: 'Обойдёт ограждения', observation: 'Дома' });
});
function trap(): LessonState { return lessonReducer(emptyLesson(), { type: 'mission', mission: 'trap' }); }
function pair(): LessonState {
  let state = lessonReducer(trap(), { type: 'complete', experience: high });
  state = lessonReducer(state, { type: 'changeBonus', bonus: 1 });
  state = lessonReducer(state, { type: 'complete', experience: low });
  return lessonReducer(state, { type: 'explanation', scope: 'working', value: 'Возвращаться за лакомством больше невыгодно' });
}
function cloneWithId(experience: Experience, id: string): Experience {
  return captureLessonExperience(id, experience.missionId, experience.model, experience.result, experience.notes);
}
function memoryStorage(initial?: string): StorageLike & { read(): string | null } {
  let stored = initial ?? null;
  return { getItem: (key) => key === STORAGE_KEY ? stored : null, setItem: (_key, value) => { stored = value; }, read: () => stored };
}
function storedMutation(mutator: (data: LessonState) => void): ReturnType<typeof loadLesson> {
  const data = structuredClone(pair());
  mutator(data);
  return loadLesson(memoryStorage(JSON.stringify(data)));
}

describe('bounded lesson and immutable experiences', () => {
  it('captures real completed results independently from the training input', () => {
    const model = structuredClone(high.model);
    const notes = { prediction: 'Мой прогноз', observation: 'Моё наблюдение' };
    const experience = captureLessonExperience('copy', 'trap', model, high.result, notes);
    model.q[0][0] = 999;
    model.environment.rewards.treat = 0;
    notes.observation = 'Поменял исходную строку';
    expect(experience.model.q).toEqual(high.model.q);
    expect(experience.model.environment.rewards.treat).toBe(5);
    expect(experience.notes.observation).toBe('Моё наблюдение');
    expect(Object.isFrozen(experience.model.q[0])).toBe(true);
    expect(Object.isFrozen(experience.result.transitions[0])).toBe(true);
    expect(() => { experience.result.reward = 0; }).toThrow();
  });
  it('automatically saves the first completed result before any manual fixation', () => {
    const completed = lessonReducer(trap(), { type: 'complete', experience: high });
    const changed = lessonReducer(completed, { type: 'changeBonus', bonus: 1 });
    expect(changed.current).toBeNull();
    expect(changed.working.first).toBe(high);
    expect(changed.working.first?.notes.prediction).toBe(high.notes.prediction);
    expect(changed.working.first?.result).toEqual({ ...high.result, reward: 12, steps: 5, treatEntries: 1, treatCollections: 1, outcome: 'goal' });
    expect(changed.drafts.trap).toEqual({ bonus: 1, prediction: '', observation: '' });
    expect(changed.savedPair).toBeNull();
  });
  it('does not invent a first experience when bonus changes before training', () => {
    const state = lessonReducer(trap(), { type: 'changeBonus', bonus: 1 });
    expect(state.working.first).toBeNull();
    expect(state.savedPair).toBeNull();
  });
  it('deduplicates repeated completion instead of creating a pair with the same run twice', () => {
    const once = lessonReducer(trap(), { type: 'complete', experience: high });
    const twice = lessonReducer(once, { type: 'complete', experience: high });
    expect(twice).toBe(once);
    expect(twice.working.second).toBeNull();
  });
  it('does not resurrect a prepared-away experience if its completion is delivered again', () => {
    const completed = lessonReducer(trap(), { type: 'complete', experience: high });
    const prepared = lessonReducer(completed, { type: 'prepare' });
    expect(lessonReducer(prepared, { type: 'complete', experience: high })).toBe(prepared);
    expect(prepared.current).toBeNull();
  });
  it('ignores completed results with stale bonus or seed conditions', () => {
    const changedBonus = lessonReducer(trap(), { type: 'changeBonus', bonus: 1 });
    expect(lessonReducer(changedBonus, { type: 'complete', experience: high })).toBe(changedBonus);
    const changedSeed = lessonReducer(emptyLesson(), { type: 'seed', seedText: '7' });
    expect(lessonReducer(changedSeed, { type: 'complete', experience: home })).toBe(changedSeed);
  });
  it('keeps learned conditions and metrics immutable while observation can be completed later', () => {
    const state = lessonReducer(trap(), { type: 'complete', experience: high });
    const next = lessonReducer(state, { type: 'observation', id: high.id, value: 'Ходит туда и обратно' });
    expect(next.current).toBe(next.working.first);
    expect(next.current).not.toBe(high);
    expect(next.current?.model).toBe(high.model);
    expect(next.current?.result).toBe(high.result);
    expect(next.current?.notes.observation).toBe('Ходит туда и обратно');
    expect(next.drafts.trap.observation).toBe('Ходит туда и обратно');
    expect(high.notes.observation).toBe('');
    expect(Object.isFrozen(next.current?.notes)).toBe(true);
  });
  it('saves the initial complete pair and synchronizes explanations for that same pair', () => {
    const state = pair();
    expect(state.savedPair?.first).toBe(high);
    expect(state.savedPair?.second).toBe(low);
    expect(state.savedPair?.explanation).toBe(state.working.explanation);
    const updated = lessonReducer(state, { type: 'explanation', scope: 'saved', value: 'Дополняю вывод из «Моих опытов»' });
    expect(updated.working.explanation).toBe(updated.savedPair?.explanation);
    expect(state.savedPair?.explanation).not.toBe(updated.savedPair?.explanation);
  });
  it('preserves the full pair, second observation and explanation during a new attempt or cancellation', () => {
    const completed = pair();
    const started = lessonReducer(completed, { type: 'changeBonus', bonus: 3 });
    expect(started.savedPair).toBe(completed.savedPair);
    expect(started.savedPair?.second.notes.observation).toBe('Дошла до домика');
    expect(started.savedPair?.explanation).toBe('Возвращаться за лакомством больше невыгодно');
    expect(started.working).toEqual({ first: null, second: null, explanation: '' });
    // Worker cancellation has no completed result to dispatch into the lesson.
    expect(loadLesson(memoryStorage(JSON.stringify(started))).state.savedPair).toEqual(completed.savedPair);
  });
  it('requires explicit confirmation to replace the last saved pair', () => {
    const saved = pair();
    let state = lessonReducer(saved, { type: 'changeBonus', bonus: 5 });
    const nextFirst = cloneWithId(high, 'next-first');
    const nextSecond = cloneWithId(low, 'next-second');
    state = lessonReducer(state, { type: 'complete', experience: nextFirst });
    state = lessonReducer(state, { type: 'changeBonus', bonus: 1 });
    state = lessonReducer(state, { type: 'complete', experience: nextSecond });
    state = lessonReducer(state, { type: 'explanation', scope: 'working', value: 'Новый вывод' });
    expect(state.savedPair).toBe(saved.savedPair);
    expect(state.working.explanation).toBe('Новый вывод');
    expect(canStartTrap(state)).toBe(false);
    const prepared = lessonReducer(state, { type: 'prepare' });
    expect(prepared.working).toBe(state.working);
    expect(prepared.savedPair).toBe(saved.savedPair);
    expect(lessonReducer(prepared, { type: 'complete', experience: cloneWithId(high, 'not-allowed-third') })).toBe(prepared);
    const replaced = lessonReducer(prepared, { type: 'commitPair' });
    expect(replaced.savedPair).toEqual(replaced.working);
    expect(replaced.savedPair?.first.id).toBe('next-first');
    expect(canStartTrap(replaced)).toBe(true);
    expect(saved.savedPair?.first.id).toBe('first');
  });
  it('updates observation in every shared view without changing the old pair data', () => {
    const state = pair();
    const updated = lessonReducer(state, { type: 'observation', id: low.id, value: 'Домик достигнут за 5 шагов' });
    expect(updated.current).toBe(updated.working.second);
    expect(updated.current).toBe(updated.savedPair?.second);
    expect(updated.current?.model).toBe(low.model);
    expect(updated.current?.result).toBe(low.result);
    expect(state.savedPair?.second.notes.observation).toBe('Дошла до домика');
  });
  it('preserves saved observations while a different working pair is being prepared', () => {
    const saved = pair();
    const next = lessonReducer(lessonReducer(saved, { type: 'prepare' }), { type: 'observation', id: high.id, value: 'Дополняю старый опыт' });
    expect(next.savedPair?.first.notes.observation).toBe('Дополняю старый опыт');
    expect(next.working.first).toBeNull();
    expect(next.current).toBeNull();
    expect(next.drafts.trap.observation).toBe('');
  });
  it('mission switching clears only the current view and keeps all completed experiences and drafts', () => {
    let state = lessonReducer(emptyLesson(), { type: 'complete', experience: home });
    state = lessonReducer(state, { type: 'draft', mission: 'home', patch: { prediction: 'Незаконченный текст' } });
    const trapState = lessonReducer(state, { type: 'mission', mission: 'trap' });
    const trainedTrap = lessonReducer(trapState, { type: 'complete', experience: high });
    const back = lessonReducer(trainedTrap, { type: 'mission', mission: 'home' });
    expect(back.current).toBeNull();
    expect(back.home).toBe(home);
    expect(back.working.first).toBe(high);
    expect(back.drafts.home.prediction).toBe('Незаконченный текст');
    expect(lessonReducer(back, { type: 'complete', experience: low })).toBe(back);
  });
  it('seed changes preserve the home forecast and saved home result', () => {
    let state = lessonReducer(emptyLesson(), { type: 'complete', experience: home });
    state = lessonReducer(state, { type: 'draft', mission: 'home', patch: { prediction: 'Мой прогноз', observation: 'Заметка' } });
    const changed = lessonReducer(state, { type: 'seed', seedText: '7' });
    expect(changed.drafts.home).toEqual({ seedText: '7', prediction: 'Мой прогноз', observation: '' });
    expect(changed.home).toBe(home);
    expect(changed.current).toBeNull();
  });
  it.each(['', '-1', '3.5', 'не число', '4294967296'])('keeps invalid seed draft %s without crashing or changing the completed model', (seedText) => {
    const completed = lessonReducer(emptyLesson(), { type: 'complete', experience: home });
    const changed = lessonReducer(completed, { type: 'seed', seedText });
    expect(changed.drafts.home.seedText).toBe(seedText);
    expect(changed.home?.model.config.seed).toBe(42);
    const restored = loadLesson(memoryStorage(JSON.stringify(changed)));
    expect(restored.warning).toBeNull();
    expect(restored.state.drafts.home.seedText).toBe(seedText);
  });
  it('only explicit restart removes the saved pair', () => {
    const state = lessonReducer(pair(), { type: 'restart' });
    expect(state).toEqual({ ...emptyLesson(), mission: 'trap' });
  });
});

describe('restoring the last lesson safely', () => {
  it('restores completed pair, notes, drafts and old route with canonical immutable references', () => {
    const storage = memoryStorage();
    const state = pair();
    expect(saveLesson(state, storage)).toEqual({ ok: true });
    const restored = loadLesson(storage);
    expect(restored.warning).toBeNull();
    expect(restored.state).toEqual(state);
    expect(restored.state.current).toBe(restored.state.savedPair?.second);
    expect(restored.state.working.first).toBe(restored.state.savedPair?.first);
    expect(Object.isFrozen(restored.state.savedPair?.first.model.q[1])).toBe(true);
    expect(restored.state.savedPair?.first.model.environment.rewards.treat).toBe(5);
    expect(restored.state.savedPair?.second.model.environment.rewards.treat).toBe(1);
    expect(evaluate(restored.state.savedPair!.first.model.environment, restored.state.savedPair!.first.model.q, 100)).toEqual(high.result);
  });
  it('restores a pending replacement independently from the saved pair', () => {
    let state = lessonReducer(pair(), { type: 'changeBonus', bonus: 5 });
    state = lessonReducer(state, { type: 'complete', experience: cloneWithId(high, 'next-first') });
    state = lessonReducer(state, { type: 'changeBonus', bonus: 1 });
    state = lessonReducer(state, { type: 'complete', experience: cloneWithId(low, 'next-second') });
    const loaded = loadLesson(memoryStorage(JSON.stringify(state)));
    expect(loaded.warning).toBeNull();
    expect(loaded.state.savedPair?.first.id).toBe('first');
    expect(loaded.state.working.first?.id).toBe('next-first');
    expect(canStartTrap(loaded.state)).toBe(false);
  });
  it('accepts an empty lesson and no saved data', () => {
    expect(loadLesson(memoryStorage())).toEqual({ state: emptyLesson(), warning: null });
    expect(loadLesson(memoryStorage(JSON.stringify(emptyLesson())))).toEqual({ state: emptyLesson(), warning: null });
  });
  it('restores completed home notes and accepts a matching seed with leading zeros', () => {
    const configured = lessonReducer(emptyLesson(), { type: 'seed', seedText: '0042' });
    const completed = lessonReducer(configured, { type: 'complete', experience: home });
    expect(completed.drafts.home.prediction).toBe(home.notes.prediction);
    expect(completed.drafts.home.observation).toBe(home.notes.observation);
    expect(loadLesson(memoryStorage(JSON.stringify(completed)))).toEqual({ state: completed, warning: null });
  });
  it.each(['7', '', '-1'])('rejects a current home result inconsistent with seed draft %s', (seedText) => {
    const completed = lessonReducer(emptyLesson(), { type: 'complete', experience: home });
    const corrupted = structuredClone(completed);
    corrupted.drafts.home.seedText = seedText;
    const loaded = loadLesson(memoryStorage(JSON.stringify(corrupted)));
    expect(loaded.state).toEqual(emptyLesson());
    expect(loaded.warning).not.toBeNull();
  });
  it.each(['{broken JSON', 'null', '[]', '{}', '"lesson"'])('rejects malformed storage %s', (raw) => {
    const loaded = loadLesson(memoryStorage(raw));
    expect(loaded.state).toEqual(emptyLesson());
    expect(loaded.warning).toMatch(/повреждены/);
  });
  it('rejects oversize data before parsing', () => {
    expect(loadLesson(memoryStorage(' '.repeat(MAX_STORAGE_LENGTH + 1))).warning).not.toBeNull();
  });
  it.each([
    ['version', (data: LessonState) => { (data as { version: number }).version = 99; }],
    ['mission', (data: LessonState) => { (data as { mission: string }).mission = 'third'; }],
    ['bonus', (data: LessonState) => { data.drafts.trap.bonus = 100; }],
    ['current bonus differs from draft', (data: LessonState) => { data.drafts.trap.bonus = 5; }],
    ['current forecast differs from draft', (data: LessonState) => { data.drafts.trap.prediction = 'Изменённый прогноз'; }],
    ['current observation differs from draft', (data: LessonState) => { data.drafts.trap.observation = 'Несогласованное наблюдение'; }],
    ['notes length', (data: LessonState) => { data.drafts.home.prediction = 'a'.repeat(1501); }],
    ['environment', (data: LessonState) => { data.working.first!.model.environment.home = 35; }],
    ['training seed', (data: LessonState) => { data.working.first!.model.config.seed = 7; }],
    ['gamma', (data: LessonState) => { data.working.first!.model.config.gamma = 0.95; }],
    ['Q shape', (data: LessonState) => { data.working.first!.model.q[0].pop(); }],
    ['Q nonfinite', (data: LessonState) => { data.working.first!.model.q[0][0] = Infinity; }],
    ['Q invalid blocked state', (data: LessonState) => { data.working.first!.model.q[35][0] = 1; }],
    ['Q invalid collected blocked state', (data: LessonState) => { data.working.first!.model.q[71][0] = 1; }],
    ['Q invalid collected home state', (data: LessonState) => { data.working.first!.model.q[41][0] = 1; }],
    ['Q changes route', (data: LessonState) => { data.working.first!.model.q[0][0] = 1999; }],
    ['trace', (data: LessonState) => { data.working.first!.result.transitions[0].to = 0; }],
    ['metric total', (data: LessonState) => { data.working.first!.result.reward = 151; }],
    ['partial training', (data: LessonState) => { data.working.first!.model.metrics.pop(); }],
    ['training totals', (data: LessonState) => { data.working.first!.model.updates += 1; }],
    ['algorithm version', (data: LessonState) => { data.working.first!.model.algorithmVersion = 'other'; }],
    ['rules version', (data: LessonState) => { (data.working.first!.model as { rulesVersion: string }).rulesVersion = 'repeat-treat-v1'; }],
    ['state encoding version', (data: LessonState) => { (data.working.first!.model as { stateEncodingVersion: string }).stateEncodingVersion = 'cell-v1'; }],
    ['old Q shape', (data: LessonState) => { data.working.first!.model.q.splice(36); }],
    ['collected reward count', (data: LessonState) => { data.working.first!.result.treatCollections += 1; }],
    ['collection state', (data: LessonState) => { data.working.first!.result.states[1].treatCollected = false; }],
    ['mismatched duplicate notes', (data: LessonState) => { data.current = structuredClone(data.current); data.current!.notes.observation = 'Несогласованная копия'; }],
    ['mismatched explanation', (data: LessonState) => { data.savedPair!.explanation = 'Другой текст у той же пары'; }],
    ['same experience twice', (data: LessonState) => { data.working.second = data.working.first; }],
  ])('rejects corrupted %s without crashing', (_name, mutate) => {
    const loaded = storedMutation(mutate);
    expect(loaded.state).toEqual(emptyLesson());
    expect(loaded.warning).not.toBeNull();
  });
  it('handles blocked localStorage property access, getItem and quota failures honestly', () => {
    const blocked = () => { throw new DOMException('Denied', 'SecurityError'); };
    expect(loadLesson(blocked).warning).toMatch(/недоступно/);
    expect(saveLesson(emptyLesson(), blocked).ok).toBe(false);
    expect(loadLesson({ getItem: blocked, setItem: () => {} }).warning).not.toBeNull();
    const full: StorageLike = { getItem: () => null, setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); } };
    const saved = saveLesson(pair(), full);
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.error).toMatch(/Не удалось сохранить/);
  });
  it('does not overwrite broken stored data during loading', () => {
    const storage = memoryStorage('broken');
    loadLesson(storage);
    expect(storage.read()).toBe('broken');
  });
  it('rejects bogus completion data before it can be saved', () => {
    expect(() => captureLessonExperience('fake', 'trap', high.model, { ...high.result, reward: 999 }, high.notes)).toThrow(/Результат проверки/);
    expect(() => captureLessonExperience('wrong-mission', 'home', high.model, high.result, high.notes)).toThrow(/Настройки/);
    const partial = { ...high.model, metrics: high.model.metrics.slice(0, -1) };
    expect(() => captureLessonExperience('partial', 'trap', partial, high.result, high.notes)).toThrow();
  });
});
