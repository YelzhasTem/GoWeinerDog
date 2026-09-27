import { describe, expect, it } from 'vitest';
import { initialStemState, levelComplete, modelIsFresh, phaseOf, stemReducer, teachSituation, type StemAction, type StemState } from './lab';
import { train } from './model';
import { runTest } from './evaluate';
import { LEVELS } from './levels';
import { correctMoves } from './situations';

const apply = (state: StemState, ...actions: StemAction[]) => actions.reduce(stemReducer, state);
function teach(state: StemState, count: number) {
  for (let n = 0; n < count; n += 1) {
    const situation = teachSituation(state);
    state = stemReducer(state, { type: 'add', situation, move: correctMoves(situation)[0], fromTeach: true });
  }
  return state;
}
function trainAndTest(state: StemState) {
  const level = state.levels[state.level];
  state = stemReducer(state, { type: 'trained', model: train(level.examples) });
  const fresh = state.levels[state.level];
  return stemReducer(state, { type: 'tested', result: runTest(fresh.model!, fresh.examples, LEVELS[state.level].tests) });
}

describe('цикл данные → обучение → тест → улучшение', () => {
  it('изменение данных делает модель устаревшей, пока её не переобучат', () => {
    let state = teach(apply(initialStemState(), { type: 'begin' }), 4);
    state = trainAndTest(state);
    expect(state.flags.tested).toBe(true);
    expect(modelIsFresh(state.levels[1])).toBe(true);
    state = teach(state, 1);
    expect(modelIsFresh(state.levels[1])).toBe(false);
    expect(state.flags.changedData).toBe(true);
    // Тест устаревшей модели не принимается.
    const stale = stemReducer(state, { type: 'tested', result: runTest(state.levels[1].model!, state.levels[1].examples, LEVELS[1].tests) });
    expect(stale).toBe(state);
    state = trainAndTest(state);
    expect(state.flags.retrained).toBe(true);
    expect(state.flags.compared).toBe(true);
    expect(levelComplete(state, 1)).toBe(true);
  });
  it('модель, обученная на старом наборе, не подменяет новую', () => {
    let state = teach(apply(initialStemState(), { type: 'begin' }), 4);
    const old = train(state.levels[1].examples);
    state = teach(state, 1);
    expect(stemReducer(state, { type: 'trained', model: old })).toBe(state);
  });
  it('уровень 2: сначала похожие примеры, затем разнообразные', () => {
    let state = apply(initialStemState(), { type: 'begin' }, { type: 'level', level: 2 });
    expect(phaseOf(state)).toBe('similar');
    state = trainAndTest(teach(state, 6));
    expect(phaseOf(state)).toBe('diverse');
    expect(levelComplete(state, 2)).toBe(false);
    state = trainAndTest(teach(state, 8));
    expect(levelComplete(state, 2)).toBe(true);
  });
  it('уровень 3 засчитывается только при 80% на всех ситуациях', () => {
    let state = apply(initialStemState(), { type: 'begin' }, { type: 'level', level: 3 });
    state = trainAndTest(teach(state, 2));
    const first = state.levels[3].tests[0];
    expect(first.total).toBe(21);
    expect(levelComplete(state, 3)).toBe(first.accuracy >= 0.8);
  });
});
