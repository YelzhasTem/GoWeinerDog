import { describe, expect, it } from 'vitest';
import { evaluate } from '../evaluation/evaluate';
import { DEFAULT_TRAINING, HOME_ENVIRONMENT, TRAP_ENVIRONMENT, TRAP_TRAINING } from '../missions';
import { RULES_VERSION, STATE_ENCODING_VERSION } from '../domain/state';
import { seededRandom } from './random';
import { train, trainEpisodes } from './train';

describe('Воспроизводимое настоящее обучение', () => {
  it('фиксирует последовательность Mulberry32 для seed 0', () => {
    const random = seededRandom(0);
    expect(Array.from({ length: 4 }, () => random())).toEqual([
      0.26642920868471265, 0.0003297457005828619, 0.2232720274478197, 0.1462021479383111,
    ]);
  });

  it.each([0, 42])('одинаковый seed %s даёт одинаковые Q, метрики и проверку', (seed) => {
    const config = { ...DEFAULT_TRAINING, seed };
    const first = train(HOME_ENVIRONMENT, config);
    const second = train(HOME_ENVIRONMENT, config);
    expect(first).toEqual(second);
    expect(first.updates).toBe(first.metrics.reduce((sum, episode) => sum + episode.steps, 0));
    expect(first.q.flat().some((value) => value !== 0)).toBe(true);
    expect(evaluate(first.environment, first.q, 100)).toEqual(evaluate(second.environment, second.q, 100));
  });

  it.each([0, 42])('вторая миссия воспроизводит Q, метрики и сбор лакомства при seed %s', (seed) => {
    const config = { ...TRAP_TRAINING, seed };
    const first = train(TRAP_ENVIRONMENT, config);
    const second = train(TRAP_ENVIRONMENT, config);
    expect(first.q).toHaveLength(72);
    expect(second.q).toEqual(first.q);
    expect(second.metrics).toEqual(first.metrics);
    expect(second.updates).toBe(first.updates);
    const firstCheck = evaluate(first.environment, first.q, config.maxSteps);
    const secondCheck = evaluate(second.environment, second.q, config.maxSteps);
    expect(secondCheck).toEqual(firstCheck);
    expect(firstCheck).toMatchObject({ outcome: 'goal', treatCollections: 1 });
    expect(firstCheck.states[0].treatCollected).toBe(false);
    expect(firstCheck.states.slice(1).every((state) => state.treatCollected)).toBe(true);
    // Сравниваем реально обученные строки после сбора, а не только нулевую половину.
    expect(first.q.slice(36).some((row) => row.some((value) => value !== 0))).toBe(true);
  });

  it('фиксирует версии правил и состояния в каждой новой модели', () => {
    const result = train(TRAP_ENVIRONMENT, { ...TRAP_TRAINING, episodes: 1 });
    expect(result).toMatchObject({ rulesVersion: RULES_VERSION, stateEncodingVersion: STATE_ENCODING_VERSION, algorithmVersion: 'tabular-q-learning-v2' });
    expect(result.q).toHaveLength(72);
  });

  it('каждая тренировочная попытка заново может собрать лакомство', () => {
    // Seed 14 при полном исследовании дважды выбирает вправо, по одному шагу за попытку.
    const result = train(TRAP_ENVIRONMENT, { ...TRAP_TRAINING, episodes: 2, maxSteps: 1, seed: 14, epsilonStart: 1, epsilonEnd: 1 });
    expect(result.metrics.map((metric) => metric.reward)).toEqual([4, 4]);
    expect(result.metrics.map((metric) => metric.outcome)).toEqual(['timeout', 'timeout']);
    expect(result.q[0][1]).toBeCloseTo(1.44);
  });

  it('timeout сохраняет bootstrap; следующая попытка отдельно начинается со старта', () => {
    const environment = {
      width: 1, height: 3, start: 0, home: 2, fences: [],
      rewards: { step: 3, collision: 0, home: 20, treat: 0 },
    };
    // Seed 0 при полном исследовании дважды выбирает вверх: столкновение со своей клеткой.
    const result = train(environment, { ...DEFAULT_TRAINING, episodes: 2, maxSteps: 1, seed: 0, alpha: 0.5, gamma: 0.9, epsilonStart: 1, epsilonEnd: 1 });
    expect(result.metrics).toEqual([
      { episode: 1, reward: 3, steps: 1, outcome: 'timeout' },
      { episode: 2, reward: 3, steps: 1, outcome: 'timeout' },
    ]);
    // После первого шага Q=1.5; после второго 1.5 + 0.5 × (3 + 0.9×1.5 − 1.5).
    expect(result.q[0][0]).toBeCloseTo(2.925);
    expect(result.q[1]).toEqual([0, 0, 0, 0]);
    expect(result.updates).toBe(2);
  });

  it('домик на последнем разрешённом шаге — goal, без лишнего шага', () => {
    const environment = { ...HOME_ENVIRONMENT, width: 2, height: 1, start: 0, home: 1, fences: [] };
    const result = train(environment, { ...DEFAULT_TRAINING, episodes: 1, maxSteps: 1, seed: 42, epsilonStart: 1, epsilonEnd: 1 });
    expect(result.metrics).toEqual([{ episode: 1, reward: 19, steps: 1, outcome: 'goal' }]);
    expect(result.updates).toBe(1);
    expect(result.q[1]).toEqual([0, 0, 0, 0]);
  });

  it('при timeout использует следующую клетку, не подменяя её стартом новой попытки', () => {
    const environment = {
      width: 3, height: 1, start: 0, home: 2, fences: [],
      rewards: { step: 3, collision: 0, home: 20, treat: 0 },
    };
    // Seed 14 дважды выбирает вправо. Каждая попытка начинается на 0 и кончается на 1.
    const result = train(environment, { ...DEFAULT_TRAINING, episodes: 2, maxSteps: 1, seed: 14, alpha: 0.5, gamma: 0.9, epsilonStart: 1, epsilonEnd: 1 });
    expect(result.metrics.map((metric) => metric.outcome)).toEqual(['timeout', 'timeout']);
    expect(result.q[0][1]).toBe(2.25); // max Q(1)=0, хотя на старте уже есть оценка 1.5.
    expect(result.q[1]).toEqual([0, 0, 0, 0]);
  });

  it('генератор и синхронный запуск дают один результат; условия сохранены отдельным снимком', () => {
    const environment = structuredClone(HOME_ENVIRONMENT);
    const config = { ...DEFAULT_TRAINING, episodes: 30 };
    const expected = train(environment, config);
    const generator = trainEpisodes(environment, config);
    let next = generator.next();
    environment.rewards.home = 999;
    environment.fences.push(1);
    config.seed = 99;
    while (!next.done) {
      // Получатель прогресса не может задним числом поменять метрики запуска.
      next.value.last.reward = 9999;
      next = generator.next();
    }
    expect(next.value).toEqual(expected);
  });

  it.each([0, 1, 7, 42, 2026, 65535])('отдельное обучение seed %s достигает домика на подготовленной площадке', (seed) => {
    const result = train(HOME_ENVIRONMENT, { ...DEFAULT_TRAINING, seed });
    const checked = evaluate(result.environment, result.q, DEFAULT_TRAINING.maxSteps);
    expect(checked.outcome).toBe('goal');
    expect(checked.steps).toBeLessThanOrEqual(100);
    expect(checked.positions.at(-1)).toBe(HOME_ENVIRONMENT.home);
  });

  it('не обучает на непроходимой площадке и отклоняет недопустимые настройки', () => {
    expect(() => train({ ...HOME_ENVIRONMENT, fences: [1, 6] }, DEFAULT_TRAINING)).toThrow('Домик отрезан');
    expect(() => train(HOME_ENVIRONMENT, { ...DEFAULT_TRAINING, alpha: 0 })).toThrow('Скорость обучения');
  });
});
