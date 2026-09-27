import type { Action, EnvironmentConfig, Transition } from './types';

/** Один реальный шаг. Среда знает правила, но ничего не знает об обучении. */
export function step(environment: EnvironmentConfig, state: number, action: Action): Transition {
  if (!Number.isInteger(state) || state < 0 || state >= environment.width * environment.height || environment.fences.includes(state)) {
    throw new Error('Такса должна находиться на доступной клетке площадки.');
  }
  if (state === environment.home) {
    throw new Error('Прогулка завершена: из домика больше не выполняются шаги.');
  }
  if (![0, 1, 2, 3].includes(action)) throw new Error('Неизвестное направление движения.');

  const x = state % environment.width;
  const y = Math.floor(state / environment.width);
  const nextX = x + (action === 1 ? 1 : action === 3 ? -1 : 0);
  const nextY = y + (action === 2 ? 1 : action === 0 ? -1 : 0);
  const candidate = nextY * environment.width + nextX;
  const outside = nextX < 0 || nextX >= environment.width || nextY < 0 || nextY >= environment.height;
  const collision = outside || environment.fences.includes(candidate);
  const to = collision ? state : candidate;
  const moved = to !== state;
  const enteredTreat = moved && to === environment.treat;
  const terminated = moved && to === environment.home;
  const rewardParts = {
    step: environment.rewards.step,
    collision: collision ? environment.rewards.collision : 0,
    home: terminated ? environment.rewards.home : 0,
    treat: enteredTreat ? environment.rewards.treat : 0,
  };
  return {
    from: state, to, action, collision, moved, enteredTreat, terminated, rewardParts,
    reward: rewardParts.step + rewardParts.collision + rewardParts.home + rewardParts.treat,
  };
}
