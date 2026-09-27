import { describe, expect, it } from 'vitest';
import { createTrainer, datasetSignature, predict, train, type Example } from './model';
import { runTest } from './evaluate';
import { ALL_SITUATIONS, correctMoves, judge, situationFromKey, situationKey, type Move, type Situation } from './situations';
import { LEVEL1_TESTS, LEVEL2_DIVERSE, LEVEL2_SIMILAR, LEVEL2_TESTS } from './levels';

const label = (list: readonly Situation[], move?: Move): Example[] =>
  list.map((situation, index) => ({ id: `t${index}`, situation, move: move ?? correctMoves(situation)[0] }));

describe('мир STEM-лаборатории', () => {
  it('содержит 21 ситуацию, и из каждой есть правильный ход', () => {
    expect(ALL_SITUATIONS).toHaveLength(21);
    expect(new Set(ALL_SITUATIONS.map(situationKey)).size).toBe(21);
    for (const situation of ALL_SITUATIONS) expect(correctMoves(situation).length).toBeGreaterThan(0);
  });
  it('проверяет решение по правилам: камень — ошибка, путь к дому важнее прямого', () => {
    const s = situationFromKey('010-right');
    expect(judge(s, 'straight')).toBe('crash');
    expect(judge(s, 'right')).toBe('ok');
    expect(judge(s, 'left')).toBe('detour');
    expect(correctMoves(situationFromKey('010-ahead'))).toEqual(['left', 'right']);
  });
});

describe('модель учится только на примерах ученика', () => {
  it('без примеров ничего не знает и не выдумывает веса', () => {
    const model = train([]);
    expect(model.weights.flat().every((w) => w === 0)).toBe(true);
  });
  it('ошибка на примерах падает во время обучения', () => {
    const trainer = createTrainer(label(LEVEL2_DIVERSE));
    const start = trainer.run(0).loss;
    const end = trainer.run(300).loss;
    expect(end).toBeLessThan(start / 3);
    expect(trainer.result().trainAccuracy).toBe(1);
  });
  it('разные данные дают разные решения в одной и той же ситуации', () => {
    const s = situationFromKey('000-ahead');
    expect(predict(train(label([s], 'left')), s).move).toBe('left');
    expect(predict(train(label([s], 'right')), s).move).toBe('right');
  });
  it('процент теста зависит от данных, а не задан заранее', () => {
    const results = [
      label(LEVEL1_TESTS, 'left'),
      label(Array(6).fill(LEVEL2_SIMILAR)),
      label(LEVEL2_DIVERSE.slice(0, 4)),
      label(ALL_SITUATIONS),
    ].map((examples) => runTest(train(examples), examples, ALL_SITUATIONS).accuracy);
    expect(new Set(results).size).toBeGreaterThanOrEqual(3);
    expect(results[0]).toBeLessThan(results[2]);
    expect(results[2]).toBeLessThan(results[3]);
    expect(results[3]).toBe(1);
  });
  it('много похожих примеров хуже, чем разнообразные (уровень 2)', () => {
    const similar = label(Array(6).fill(LEVEL2_SIMILAR));
    const diverse = [...similar, ...label(LEVEL2_DIVERSE.slice(0, 8))];
    const before = runTest(train(similar), similar, LEVEL2_TESTS);
    const after = runTest(train(diverse), diverse, LEVEL2_TESTS);
    expect(before.accuracy).toBeLessThan(0.5);
    expect(after.accuracy).toBeGreaterThan(before.accuracy);
    expect(after.diversity).toBeGreaterThan(before.diversity);
  });
  it('объясняет ошибку: новая ситуация или выученный неверный пример', () => {
    const wrong = label([situationFromKey('010-right')], 'straight');
    const result = runTest(train(wrong), wrong, [situationFromKey('010-right'), situationFromKey('011-left')]);
    expect(result.items[0].cause).toBe('taught-this');
    expect(result.items[1].seen).toBe(false);
  });
  it('подпись набора данных меняется при любом изменении', () => {
    const a = label(LEVEL2_DIVERSE.slice(0, 3));
    expect(datasetSignature(a)).not.toBe(datasetSignature(a.slice(1)));
    expect(datasetSignature(a)).toBe(datasetSignature([...a].reverse()));
  });
});
