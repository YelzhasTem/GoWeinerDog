import { beforeAll, describe, expect, it } from 'vitest';
import type { EvaluationResult, TrainingResult } from '../domain/types';
import { evaluate } from '../evaluation/evaluate';
import { train } from '../learning/train';
import { TRAP_ENVIRONMENT, TRAP_TRAINING } from '../missions';
import { captureExperiment, compareExperiments, type ExperimentSnapshot } from './session';

let highModel: TrainingResult;
let lowModel: TrainingResult;
let highResult: EvaluationResult;
let first: ExperimentSnapshot;
let second: ExperimentSnapshot;

beforeAll(() => {
  // Оба опыта действительно обучаются с нуля; нет готовой Q или заданного пути.
  highModel = train(TRAP_ENVIRONMENT, TRAP_TRAINING);
  lowModel = train({ ...TRAP_ENVIRONMENT, rewards: { ...TRAP_ENVIRONMENT.rewards, treat: 1 } }, TRAP_TRAINING);
  highResult = evaluate(highModel.environment, highModel.q, highModel.config.maxSteps);
  first = captureExperiment('first', highModel, highResult, { prediction: 'Проверю влияние лакомства', observation: 'Вижу повторные входы' });
  second = captureExperiment('second', lowModel, evaluate(lowModel.environment, lowModel.q, lowModel.config.maxSteps), { prediction: 'Проверю другой бонус', observation: '' });
});

describe('Снимки двух опытов в памяти', () => {
  it('сохраняет собственные условия, Q, настоящий путь и текст ученика', () => {
    expect(first).toMatchObject({ id: 'first', missionId: 'trap', model: highModel, result: highResult, evaluationMaxSteps: TRAP_TRAINING.maxSteps });
    expect(first.notes).toEqual({ prediction: 'Проверю влияние лакомства', observation: 'Вижу повторные входы' });
    expect(first.model).not.toBe(highModel);
    expect(first.model.q[0]).not.toBe(highModel.q[0]);
    expect(first.result.transitions[0]).not.toBe(highResult.transitions[0]);
  });

  it('изменения исходных условий, модели, пути и заметок не меняют первый опыт', () => {
    const model = structuredClone(highModel);
    const result = structuredClone(highResult);
    const notes = { prediction: 'Мой прогноз', observation: 'Моё наблюдение' };
    const captured = captureExperiment('saved', model, result, notes);
    const before = structuredClone(captured);
    model.environment.rewards.treat = 1;
    model.environment.fences.reverse();
    model.config.seed = 7;
    model.q[0][0] = 1234;
    model.metrics[0].reward = 1234;
    result.transitions[0].rewardParts.treat = 1234;
    result.positions[0] = 35;
    result.reward = 1234;
    notes.prediction = 'Подменённый прогноз';
    notes.observation = 'Подменённое наблюдение';
    expect(captured).toEqual(before);
  });

  it('защищает все вложенные данные от записи во время просмотра старого пути', () => {
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.model.environment.rewards)).toBe(true);
    expect(Object.isFrozen(first.result.transitions[0].rewardParts)).toBe(true);
    expect(() => { first.model.q[0][0] = 99; }).toThrow(TypeError);
    expect(() => { first.model.environment.rewards.treat = 0; }).toThrow(TypeError);
    expect(() => { first.result.positions.push(0); }).toThrow(TypeError);
    expect(() => { first.notes.observation = 'Перезапись'; }).toThrow(TypeError);
    expect(evaluate(first.model.environment, first.model.q, first.evaluationMaxSteps)).toEqual(first.result);
  });

  it('не принимает незавершённую тренировку', () => {
    const unfinished = structuredClone(highModel);
    unfinished.metrics.pop();
    expect(() => captureExperiment('incomplete', unfinished, highResult, { prediction: '', observation: '' })).toThrow('завершения всей тренировки');
  });

  it('не принимает неполный timeout, полученный с другим лимитом', () => {
    const shortResult = evaluate(highModel.environment, highModel.q, 2);
    expect(() => captureExperiment('short', highModel, shortResult, { prediction: '', observation: '' })).toThrow('не соответствует');
    const short = captureExperiment('short', highModel, shortResult, { prediction: '', observation: '' }, 2);
    expect(short.evaluationMaxSteps).toBe(2);
    expect(compareExperiments(first, short).comparable).toBe(false);
  });

  it.each([
    ['очки', (result: EvaluationResult) => { result.reward += 1; }],
    ['шаги', (result: EvaluationResult) => { result.steps -= 1; }],
    ['входы к лакомству', (result: EvaluationResult) => { result.treatEntries += 1; }],
    ['полученные лакомства', (result: EvaluationResult) => { result.treatCollections += 1; }],
    ['состояние лакомства на шаге', (result: EvaluationResult) => { result.states[1].treatCollected = false; }],
    ['причина окончания', (result: EvaluationResult) => { result.outcome = result.outcome === 'goal' ? 'timeout' : 'goal'; }],
    ['позиция на пути', (result: EvaluationResult) => { result.positions[1] = 35; }],
    ['состав награды', (result: EvaluationResult) => { result.transitions[0].rewardParts.treat += 1; }],
    ['направление', (result: EvaluationResult) => { result.transitions[0].action = (result.transitions[0].action + 1) % 4 as 0 | 1 | 2 | 3; }],
  ])('отклоняет несоответствие модели и пути: %s', (_label, mutate) => {
    const invalid = structuredClone(highResult);
    mutate(invalid);
    expect(() => captureExperiment('invalid', highModel, invalid, { prediction: '', observation: '' })).toThrow('не соответствует');
  });
});

describe('Одно изменённое условие в сравниваемой паре', () => {
  it('разрешает разницу только бонуса и называет её явно', () => {
    expect(compareExperiments(first, second)).toEqual({
      comparable: true,
      bonusChanged: true,
      differences: [{ key: 'bonus', label: 'Бонус за лакомство', before: 5, after: 1 }],
    });
    expect(first.model.q).not.toEqual(second.model.q);
    expect(first.result.outcome).toBe('goal');
    expect(first.result.positions).toEqual(second.result.positions);
    expect(first.result.treatCollections).toBe(1);
    expect(second.result.outcome).toBe('goal');
  });

  it('различает повтор без изменения бонуса и изменение одного условия', () => {
    const repeated = captureExperiment('repeated', highModel, highResult, { prediction: '', observation: 'Иная запись ученика' });
    expect(compareExperiments(first, repeated)).toEqual({ comparable: true, bonusChanged: false, differences: [] });
    expect(repeated.notes.prediction).toBe('');
  });

  it('порядок списка ограждений не выдаёт за другую карту и не меняет исходник', () => {
    const reordered = structuredClone(second);
    reordered.model.environment.fences.reverse();
    const order = [...reordered.model.environment.fences];
    expect(compareExperiments(first, reordered).differences.map((difference) => difference.key)).toEqual(['bonus']);
    expect(reordered.model.environment.fences).toEqual(order);
  });

  // Здесь намеренно меняются условия копии, чтобы проверить защиту сравнения.
  // Эти записи не используются как результаты обучения или демонстрация ловушки.
  it.each<[string, (snapshot: ExperimentSnapshot) => void]>([
    ['width', (s) => { s.model.environment.width += 1; }],
    ['height', (s) => { s.model.environment.height += 1; }],
    ['start', (s) => { s.model.environment.start = 2; }],
    ['home', (s) => { s.model.environment.home = 4; }],
    ['fences', (s) => { s.model.environment.fences.pop(); }],
    ['treat', (s) => { s.model.environment.treat = 3; }],
    ['stepReward', (s) => { s.model.environment.rewards.step = -2; }],
    ['collisionReward', (s) => { s.model.environment.rewards.collision = -3; }],
    ['homeReward', (s) => { s.model.environment.rewards.home = 20; }],
    ['seed', (s) => { s.model.config.seed = 7; }],
    ['episodes', (s) => { s.model.config.episodes += 1; }],
    ['maxSteps', (s) => { s.model.config.maxSteps += 1; }],
    ['alpha', (s) => { s.model.config.alpha = 0.3; }],
    ['gamma', (s) => { s.model.config.gamma = 0.95; }],
    ['epsilonStart', (s) => { s.model.config.epsilonStart = 0.9; }],
    ['epsilonEnd', (s) => { s.model.config.epsilonEnd = 0.1; }],
    ['decayFraction', (s) => { s.model.config.decayFraction = 0.5; }],
    ['algorithmVersion', (s) => { s.model.algorithmVersion = 'other-q-version'; }],
    ['prngVersion', (s) => { s.model.prngVersion = 'other-prng-version'; }],
  ])('отклоняет дополнительное изменение: %s', (key, mutate) => {
    const changed = structuredClone(second);
    mutate(changed);
    const comparison = compareExperiments(first, changed);
    expect(comparison.comparable).toBe(false);
    expect(comparison.bonusChanged).toBe(true);
    expect(comparison.differences.map((difference) => difference.key)).toContain(key);
  });

  it('проверяет лимит проверки отдельно от лимита обучения', () => {
    const changed = { ...second, evaluationMaxSteps: second.evaluationMaxSteps + 1 };
    const comparison = compareExperiments(first, changed);
    expect(comparison.comparable).toBe(false);
    expect(comparison.differences.map((difference) => difference.key)).toContain('evaluationMaxSteps');
  });
});
