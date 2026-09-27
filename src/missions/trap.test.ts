import { describe, expect, it } from 'vitest';
import { step } from '../domain/environment';
import { initialState } from '../domain/state';
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
    expect(transition).toEqual(step(training.environment, checked.states[index], transition.action));
  }
  expect(checked.reward).toBe(checked.transitions.reduce((sum, transition) => sum + transition.reward, 0));
  expect(checked.treatEntries).toBe(checked.transitions.filter((transition) => transition.enteredTreat).length);
  expect(checked.states).toHaveLength(checked.steps + 1);
  expect(checked.treatCollections).toBe(checked.transitions.filter((transition) => transition.collectedTreat).length);
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

  it('даёт лакомство один раз, отделяя повторный вход и столкновение от сбора', () => {
    const first = step(TRAP_ENVIRONMENT, initialState(TRAP_ENVIRONMENT), 1);
    const fence = step(TRAP_ENVIRONMENT, first.after, 2);
    const boundary = step(TRAP_ENVIRONMENT, fence.after, 0);
    const leave = step(TRAP_ENVIRONMENT, boundary.after, 1);
    const returnToTreat = step(TRAP_ENVIRONMENT, leave.after, 3);
    expect([first, fence, boundary, leave, returnToTreat].map((transition) => transition.rewardParts.treat)).toEqual([5, 0, 0, 0, 0]);
    expect(fence).toMatchObject({ moved: false, enteredTreat: false, collectedTreat: false, collision: true, reward: -2 });
    expect(returnToTreat).toMatchObject({ enteredTreat: true, collectedTreat: false, reward: -1 });
  });

  const cases = Array.from({ length: 11 }, (_, bonus) => VALIDATION_SEEDS.map((seed) => ({ bonus, seed }))).flat();
  it.each(cases)('новое обучение: бонус $bonus, seed $seed — домик и один сбор', ({ bonus, seed }) => {
    const environment = { ...TRAP_ENVIRONMENT, rewards: { ...TRAP_ENVIRONMENT.rewards, treat: bonus } };
    const trained = train(environment, { ...TRAP_TRAINING, seed });
    const qBefore = structuredClone(trained.q);
    const checked = evaluate(trained.environment, trained.q, trained.config.maxSteps);
    checkCalculatedPath(trained, checked);
    expect(trained.q).toEqual(qBefore);
    expect(trained.q).toHaveLength(72);
    expect(trained.q.flat().some((value) => value !== 0)).toBe(true);
    expect(checked).toMatchObject({ outcome: 'goal', reward: 7 + bonus, steps: 5, treatEntries: 1, treatCollections: 1, collisions: 0 });
    expect(checked.positions.at(-1)).toBe(environment.home);
    expect(checked.positions.every((cell) => cell >= 0 && cell < 36)).toBe(true);
    expect(checked.transitions.reduce((sum, transition) => sum + transition.rewardParts.treat, 0)).toBe(bonus);
    expect(checked.states[0].treatCollected).toBe(false);
    expect(checked.states.slice(1).every((state) => state.treatCollected)).toBe(true);
  });

  it('отдельные обучения отличаются только бонусом; первый опыт неизменен, путь может совпасть', () => {
    const conditions: TrainingConfig = { ...TRAP_TRAINING, seed: 42 };
    const first = train(TRAP_ENVIRONMENT, conditions);
    const firstBeforeSecondRun = structuredClone(first);
    const changedEnvironment: EnvironmentConfig = {
      ...TRAP_ENVIRONMENT, fences: [...TRAP_ENVIRONMENT.fences],
      rewards: { ...TRAP_ENVIRONMENT.rewards, treat: 1 },
    };
    const second = train(changedEnvironment, conditions);
    expect(first.config).toEqual(second.config);
    expect({ ...first.environment, rewards: { ...first.environment.rewards, treat: 1 } }).toEqual(second.environment);
    expect(first.q).not.toBe(second.q);
    expect(first.q).not.toEqual(second.q);
    const firstChecked = evaluate(first.environment, first.q, first.config.maxSteps);
    const secondChecked = evaluate(second.environment, second.q, second.config.maxSteps);
    expect(firstChecked.positions).toEqual(secondChecked.positions);
    expect(firstChecked.reward).toBe(12);
    expect(secondChecked.reward).toBe(8);
    changedEnvironment.rewards.treat = 99;
    conditions.seed = 123;
    expect(first).toEqual(firstBeforeSecondRun);
    expect(evaluate(first.environment, first.q, first.config.maxSteps)).toEqual(firstChecked);
  });
});
