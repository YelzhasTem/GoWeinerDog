import type { EnvironmentConfig, TrainingConfig } from '../domain/types';

// Здесь только условия площадки. Готового пути для алгоритма нет.
export const HOME_ENVIRONMENT: EnvironmentConfig = {
  width: 6,
  height: 6,
  start: 0,
  home: 35,
  fences: [3, 7, 9, 13, 21, 24, 25, 27],
  rewards: { step: -1, collision: -1, home: 20, treat: 0 },
};

export const DEFAULT_TRAINING: TrainingConfig = {
  episodes: 800,
  maxSteps: 100,
  alpha: 0.2,
  gamma: 0.95,
  epsilonStart: 1,
  epsilonEnd: 0.05,
  decayFraction: 0.8,
  seed: 42,
};

// Подготовленная площадка для одного контролируемого изменения: размера бонуса.
// Верхняя дорожка открыта; остальные клетки огорожены. Путь здесь не хранится.
export const TRAP_ENVIRONMENT: EnvironmentConfig = {
  width: 6,
  height: 6,
  start: 0,
  home: 5,
  treat: 1,
  fences: Array.from({ length: 30 }, (_, index) => index + 6),
  rewards: { step: -1, collision: -1, home: 12, treat: 5 },
};

// Отдельный пресет: настройка ловушки не меняет первую миссию.
export const TRAP_TRAINING: TrainingConfig = {
  episodes: 800,
  maxSteps: 100,
  alpha: 0.2,
  gamma: 0.9,
  epsilonStart: 1,
  epsilonEnd: 0.05,
  decayFraction: 0.8,
  seed: 42,
};

// Выбраны до проверки пресета. Это отдельные обучения, а не повторы одного пути.
export const VALIDATION_SEEDS = [0, 1, 7, 42, 2026, 65535] as const;
