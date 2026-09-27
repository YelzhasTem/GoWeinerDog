import { ACTIONS, type Action, type QTable, type ReadonlyQTable, type Transition } from '../domain/types';

export const ALGORITHM_VERSION = 'tabular-q-learning-v2';

export function createQTable(states: number): QTable {
  if (!Number.isInteger(states) || states < 1) throw new Error('Число состояний должно быть положительным целым.');
  return Array.from({ length: states }, () => [0, 0, 0, 0]);
}

/** Домик завершает задачу. Лимит шагов сюда не входит: будущая оценка остаётся. */
export function updateQ(q: QTable, transition: Transition, alpha: number, gamma: number): number {
  const previous = q[transition.fromState][transition.action];
  const future = transition.terminated ? 0 : gamma * Math.max(...q[transition.toState]);
  const next = previous + alpha * (transition.reward + future - previous);
  q[transition.fromState][transition.action] = next;
  return next;
}

/** В проверке равенства решаются фиксированным порядком: вверх, вправо, вниз, влево. */
export function greedyAction(q: ReadonlyQTable, state: number): Action {
  let best: Action = 0;
  for (const action of ACTIONS) {
    if (q[state][action] > q[state][best]) best = action;
  }
  return best;
}

/** В тренировке исследование и выбор при равенстве используют переданный PRNG. */
export function trainingAction(q: ReadonlyQTable, state: number, epsilon: number, random: () => number): Action {
  if (random() < epsilon) return ACTIONS[Math.floor(random() * ACTIONS.length)];
  const maximum = Math.max(...q[state]);
  const candidates = ACTIONS.filter((action) => q[state][action] === maximum);
  return candidates[Math.floor(random() * candidates.length)];
}
