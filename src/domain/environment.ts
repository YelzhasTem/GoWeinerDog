import { encodeState } from './state';
import type { Action, AgentState, EnvironmentConfig, Transition } from './types';

/** Один реальный шаг. Среда знает правила, но ничего не знает об обучении. */
export function step(environment: EnvironmentConfig, state: AgentState, action: Action): Transition {
  const fromState = encodeState(environment, state);
  const cell = state.cell;
  if (environment.fences.includes(cell)) {
    throw new Error('Такса должна находиться на доступной клетке площадки.');
  }
  if (cell === environment.home) {
    throw new Error('Прогулка завершена: из домика больше не выполняются шаги.');
  }
  if (![0, 1, 2, 3].includes(action)) throw new Error('Неизвестное направление движения.');

  const x = cell % environment.width;
  const y = Math.floor(cell / environment.width);
  const nextX = x + (action === 1 ? 1 : action === 3 ? -1 : 0);
  const nextY = y + (action === 2 ? 1 : action === 0 ? -1 : 0);
  const candidate = nextY * environment.width + nextX;
  const outside = nextX < 0 || nextX >= environment.width || nextY < 0 || nextY >= environment.height;
  const collision = outside || environment.fences.includes(candidate);
  const to = collision ? cell : candidate;
  const moved = to !== cell;
  const enteredTreat = moved && to === environment.treat;
  const collectedTreat = enteredTreat && !state.treatCollected;
  const after: AgentState = { cell: to, treatCollected: state.treatCollected || collectedTreat };
  const terminated = moved && to === environment.home;
  const rewardParts = {
    step: environment.rewards.step,
    collision: collision ? environment.rewards.collision : 0,
    home: terminated ? environment.rewards.home : 0,
    treat: collectedTreat ? environment.rewards.treat : 0,
  };
  return {
    from: cell, to, fromState, toState: encodeState(environment, after),
    before: { ...state }, after, action, collision, moved, enteredTreat, collectedTreat, terminated, rewardParts,
    reward: rewardParts.step + rewardParts.collision + rewardParts.home + rewardParts.treat,
  };
}
