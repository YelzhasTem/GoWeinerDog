import type { EnvironmentConfig, TrainingConfig } from './types';

export const MAX_EPISODES = 100_000;
export const MAX_STEPS = 10_000;
export const MAX_TRAINING_STEPS = 10_000_000;

export interface EnvironmentValidation {
  errors: string[];
  warnings: string[];
  shortestDistance: number | null;
}

export function validateEnvironment(environment: EnvironmentConfig): EnvironmentValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const { width, height, start, home, treat, fences, rewards } = environment;
  if (![width, height].every((value) => Number.isInteger(value) && value >= 1 && value <= 20)) {
    return { errors: ['Размеры площадки должны быть целыми числами от 1 до 20.'], warnings, shortestDistance: null };
  }
  const cells = width * height;
  const validCell = (cell: number) => Number.isInteger(cell) && cell >= 0 && cell < cells;
  if (!validCell(start)) errors.push('Место начала прогулки должно находиться на площадке.');
  if (!validCell(home)) errors.push('Домик должен находиться на площадке.');
  if (treat !== undefined && !validCell(treat)) errors.push('Лакомство должно находиться на площадке.');
  const objects = treat === undefined ? [start, home] : [start, home, treat];
  if (new Set(objects).size !== objects.length) errors.push('Начало прогулки, домик и лакомство должны быть на разных клетках.');
  if (!Array.isArray(fences) || !fences.every(validCell)) errors.push('Все ограждения должны находиться на площадке.');
  else {
    if (new Set(fences).size !== fences.length) errors.push('Одна клетка ограждения указана несколько раз.');
    if (objects.some((cell) => fences.includes(cell))) errors.push('Ограждение перекрывает начало прогулки, домик или лакомство.');
  }
  if (!rewards || ![rewards.step, rewards.collision, rewards.home, rewards.treat].every((value) => Number.isFinite(value) && Math.abs(value) <= 1000)) {
    errors.push('Каждая награда должна быть конечным числом от −1000 до 1000.');
  }
  if (errors.length > 0) return { errors, warnings, shortestDistance: null };

  // BFS только проверяет достижимость. Его путь не передаётся обучению.
  const distances = new Map<number, number>([[start, 0]]);
  const queue = [start];
  const blocked = new Set(fences);
  for (let head = 0; head < queue.length; head += 1) {
    const cell = queue[head];
    if (cell === home) continue;
    const x = cell % width;
    const y = Math.floor(cell / width);
    const neighbors = [
      y > 0 ? cell - width : -1,
      x < width - 1 ? cell + 1 : -1,
      y < height - 1 ? cell + width : -1,
      x > 0 ? cell - 1 : -1,
    ];
    for (const next of neighbors) {
      if (next < 0 || blocked.has(next) || distances.has(next)) continue;
      distances.set(next, distances.get(cell)! + 1);
      queue.push(next);
    }
  }
  const shortestDistance = distances.get(home) ?? null;
  if (shortestDistance === null) errors.push('Домик отрезан ограждениями. Освободи проход.');
  if (treat !== undefined && !distances.has(treat)) warnings.push('До лакомства нельзя добраться до завершения прогулки.');
  return { errors, warnings, shortestDistance };
}

export function validateTrainingConfig(config: TrainingConfig): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(config.episodes) || config.episodes < 1 || config.episodes > MAX_EPISODES) {
    errors.push(`Число попыток должно быть целым от 1 до ${MAX_EPISODES}.`);
  }
  if (!Number.isInteger(config.maxSteps) || config.maxSteps < 1 || config.maxSteps > MAX_STEPS) {
    errors.push(`Лимит шагов должен быть целым от 1 до ${MAX_STEPS}.`);
  }
  if (config.episodes * config.maxSteps > MAX_TRAINING_STEPS) errors.push(`Предел вычислений — ${MAX_TRAINING_STEPS} шагов на тренировку.`);
  if (!Number.isFinite(config.alpha) || config.alpha <= 0 || config.alpha > 1) errors.push('Скорость обучения α должна быть больше 0 и не больше 1.');
  if (!Number.isFinite(config.gamma) || config.gamma < 0 || config.gamma >= 1) errors.push('Учёт будущих наград γ должен быть от 0 включительно до 1 исключительно.');
  if (![config.epsilonStart, config.epsilonEnd].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) errors.push('Вероятность исследования должна быть от 0 до 1.');
  if (config.epsilonEnd > config.epsilonStart) errors.push('В этом расписании исследование должно убывать или оставаться постоянным.');
  if (!Number.isFinite(config.decayFraction) || config.decayFraction <= 0 || config.decayFraction > 1) errors.push('Доля попыток для уменьшения исследования должна быть больше 0 и не больше 1.');
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) errors.push('Seed должен быть целым числом от 0 до 4294967295.');
  return errors;
}
