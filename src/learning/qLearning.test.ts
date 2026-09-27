import { describe, expect, it } from 'vitest';
import { createQTable, greedyAction, trainingAction, updateQ } from './qLearning';
import type { Transition } from '../domain/types';
import { step } from '../domain/environment';
import { initialState, stateCount } from '../domain/state';
import { TRAP_ENVIRONMENT } from '../missions';

const transition: Transition = {
  from: 0, to: 1, fromState: 0, toState: 1,
  before: { cell: 0, treatCollected: false }, after: { cell: 1, treatCollected: false }, collectedTreat: false,
  action: 1, reward: 3, moved: true, collision: false,
  enteredTreat: false, terminated: false,
  rewardParts: { step: 3, collision: 0, home: 0, treat: 0 },
};

describe('Q — оценки действий, полученные по опыту', () => {
  it('считает 2 + 0.5 × (3 + 0.9 × 4 − 2) = 4.3; меняет только одно действие', () => {
    const q = [[0, 2, -1, 0], [1, 4, 2, 0]];
    expect(updateQ(q, transition, 0.5, 0.9)).toBeCloseTo(4.3);
    expect(q).toEqual([[0, 4.3, -1, 0], [1, 4, 2, 0]]);
  });

  it('в домике не учитывает будущие оценки: 2 + 0.5 × (3 − 2) = 2.5', () => {
    const q = [[0, 2, 0, 0], [1_000_000, 4, 2, 0]];
    expect(updateQ(q, { ...transition, terminated: true }, 0.5, 0.9)).toBe(2.5);
  });

  it('при gamma=0 учитывает только награду текущего шага', () => {
    const q = [[0, 2, 0, 0], [100, 100, 100, 100]];
    expect(updateQ(q, transition, 1, 0)).toBe(3);
  });

  it('новая таблица имеет независимые строки и нулевой опыт', () => {
    const q = createQTable(3);
    q[0][0] = 7;
    expect(q[1]).toEqual([0, 0, 0, 0]);
    expect(createQTable(3)[0]).toEqual([0, 0, 0, 0]);
  });

  it('оценки одной клетки до и после сбора обновляются независимо', () => {
    const q = createQTable(stateCount(TRAP_ENVIRONMENT));
    const first = step(TRAP_ENVIRONMENT, initialState(TRAP_ENVIRONMENT), 1);
    updateQ(q, first, 1, 0);
    const returning = step(TRAP_ENVIRONMENT, first.after, 3);
    updateQ(q, returning, 1, 0);
    const repeated = step(TRAP_ENVIRONMENT, returning.after, 1);
    updateQ(q, repeated, 1, 0);
    expect(first.from).toBe(repeated.from);
    expect(first.fromState).not.toBe(repeated.fromState);
    expect(q[first.fromState][1]).toBe(4);
    expect(q[repeated.fromState][1]).toBe(-1);
    expect(q[first.toState][3]).toBe(-1);
    expect(q[first.to][3]).toBe(0);
  });

  it('равенство в проверке разрешается порядком действий', () => {
    expect(greedyAction([[0, 0, 0, 0]], 0)).toBe(0);
    expect(greedyAction([[-1, 2, 2, 0]], 0)).toBe(1);
  });

  it('при обучении выбор среди равных лучших использует только переданный PRNG', () => {
    expect(trainingAction([[0, 2, 2, 0]], 0, 0, () => 0.9)).toBe(2);
    expect(trainingAction([[0, 9, 0, 0]], 0, 1, () => 0.9)).toBe(3);
  });
});
