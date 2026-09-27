import { describe, expect, it } from 'vitest';
import { step } from '../domain/environment';
import type { EnvironmentConfig, EvaluationResult, TrainingConfig, TrainingResult } from '../domain/types';
import { validateEnvironment } from '../domain/validation';
import { evaluate } from '../evaluation/evaluate';
import { train } from '../learning/train';
import { DEFAULT_TRAINING, HOME_ENVIRONMENT, TRAP_ENVIRONMENT, TRAP_TRAINING, VALIDATION_SEEDS } from './index';

function checkCalculatedPath(training: TrainingResult, checked: EvaluationResult) {
  expect(checked.positions[0]).toBe(training.environment.start);
  expect(checked.steps).toBe(checked.transitions.length);
  expect(checked.positions).toHaveLength(checked.steps + 1);
  for (const [index, transition] of checked.transitions.entries()) {
    expect(transition.from).toBe(checked.positions[index]);
    expect(transition.to).toBe(checked.positions[index + 1]);
    expect(transition).toEqual(step(training.environment, transition.from, transition.action));
  }
  expect(checked.reward).toBe(checked.transitions.reduce((sum, transition) => sum + transition.reward, 0));
  expect(checked.treatEntries).toBe(checked.transitions.filter((transition) => transition.enteredTreat).length);
  expect(checked.collisions).toBe(checked.transitions.filter((transition) => transition.collision).length);
  expect(training.updates).toBe(training.metrics.reduce((sum, metric) => sum + metric.steps, 0));
}

describe('Подготовленная миссия «Ловушка лакомства»', () => {
  it('домик и лакомство доступны; пресеты первой миссии сохраняют свои условия', () => {
    expect(validateEnvironment(TRAP_ENVIRONMENT)).toEqual({ errors: [], warnings: [], shortestDistance: 5 });
    expect(TRAP_ENVIRONMENT).toMatchObject({ width: 6, height: 6, start: 0, treat: 1, home: 5 });
    expect(TRAP_ENVIRONMENT.rewards).not.toBe(HOME_ENVIRONMENT.rewards);
    expect(TRAP_ENVIRONMENT.fences).not.toBe(HOME_ENVIRONMENT.fences);
    expect(TRAP_TRAINING).not.toBe(DEFAULT_TRAINING);
    expect(HOME_ENVIRONMENT).toEqual({
      width: 6, height: 6, start: 0, home: 35,
      fences: [3, 7, 9, 13, 21, 24, 25, 27],
      rewards: { step: -1, collision: -1, home: 20, treat: 0 },
    });
    expect(DEFAULT_TRAINING).toEqual({
      episodes: 800, maxSteps: 100, alpha: 0.2, gamma: 0.95,
      epsilonStart: 1, epsilonEnd: 0.05, decayFraction: 0.8, seed: 42,
    });
  });

  it('даёт лакомство при первом и повторном входе, но не при столкновении на нём', () => {
    const first = step(TRAP_ENVIRONMENT, TRAP_ENVIRONMENT.start, 1);
    const fence = step(TRAP_ENVIRONMENT, first.to, 2);
    const boundary = step(TRAP_ENVIRONMENT, first.to, 0);
    const leave = step(TRAP_ENVIRONMENT, first.to, 1);
    const returnToTreat = step(TRAP_ENVIRONMENT, leave.to, 3);
    expect([first, fence, boundary, leave, returnToTreat].map((transition) => transition.rewardParts.treat)).toEqual([5, 0, 0, 0, 5]);
    expect(fence).toMatchObject({ moved: false, enteredTreat: false, collision: true, reward: -2 });
    expect(boundary).toMatchObject({ moved: false, enteredTreat: false, collision: true, reward: -2 });
    expect(returnToTreat).toMatchObject({ enteredTreat: true, reward: 4 });
  });

  it.each(VALIDATION_SEEDS)('два настоящих обучения seed %s: бонус 5 создаёт цикл, бонус 1 приводит домой', (seed) => {
    const conditions: TrainingConfig = { ...TRAP_TRAINING, seed };
    const first = train(TRAP_ENVIRONMENT, conditions);
    const firstBeforeSecondRun = structuredClone(first);
    const changedEnvironment: EnvironmentConfig = {
      ...TRAP_ENVIRONMENT,
      fences: [...TRAP_ENVIRONMENT.fences],
      rewards: { ...TRAP_ENVIRONMENT.rewards, treat: 1 },
    };
    const second = train(changedEnvironment, conditions);

    // Пара отличается ровно одним условием. Каждое обучение само создаёт Q.
    expect(first.config).toEqual(second.config);
    expect({ ...first.environment, rewards: { ...first.environment.rewards, treat: 1 } }).toEqual(second.environment);
    expect(first.q).not.toBe(second.q);
    expect(first.q).not.toEqual(second.q);
    expect(first.q.flat().some((value) => value !== 0)).toBe(true);
    expect(second.q.flat().some((value) => value !== 0)).toBe(true);
    expect(first).toEqual(firstBeforeSecondRun);

    const firstQ = structuredClone(first.q);
    const secondQ = structuredClone(second.q);
    const trapped = evaluate(first.environment, first.q, first.config.maxSteps);
    const corrected = evaluate(second.environment, second.q, second.config.maxSteps);
    expect(first.q).toEqual(firstQ);
    expect(second.q).toEqual(secondQ);
    checkCalculatedPath(first, trapped);
    checkCalculatedPath(second, corrected);

    expect(trapped).toMatchObject({ outcome: 'timeout', reward: 150, steps: 100, treatEntries: 50, collisions: 0 });
    expect(trapped.positions).not.toContain(first.environment.home);
    expect(corrected).toMatchObject({ outcome: 'goal', reward: 8, steps: 5, treatEntries: 1, collisions: 0 });
    expect(corrected.positions.at(-1)).toBe(second.environment.home);

    // Изменения источника второго опыта не переписывают первый или его проверку.
    changedEnvironment.rewards.treat = 99;
    conditions.seed = 123;
    expect(first).toEqual(firstBeforeSecondRun);
    expect(evaluate(first.environment, first.q, first.config.maxSteps)).toEqual(trapped);
  });
});
