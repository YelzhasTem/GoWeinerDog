import { describe, expect, it } from 'vitest';
import { DEFAULT_TRAINING, HOME_ENVIRONMENT } from '../missions';
import { validateEnvironment, validateTrainingConfig } from './validation';
import type { EnvironmentConfig, TrainingConfig } from './types';

describe('Проверка входных условий', () => {
  it('площадка миссии достижима; BFS возвращает только расстояние', () => {
    expect(validateEnvironment(HOME_ENVIRONMENT)).toEqual({ errors: [], warnings: [], shortestDistance: 10 });
  });

  it.each([
    { width: 0 }, { height: 1.5 }, { start: -1 }, { home: 36 },
    { home: 0 }, { treat: 0 }, { treat: Number.NaN }, { fences: [0] },
    { fences: [2, 2] }, { fences: [36] },
    { rewards: { step: -1, collision: -1, home: Number.POSITIVE_INFINITY, treat: 0 } },
    { rewards: { step: Number.NaN, collision: -1, home: 20, treat: 0 } },
  ] satisfies Partial<EnvironmentConfig>[])('отклоняет некорректную площадку: %o', (changes) => {
    expect(validateEnvironment({ ...HOME_ENVIRONMENT, ...changes }).errors.length).toBeGreaterThan(0);
  });

  it('объясняет отсутствие пути', () => {
    const invalid = { ...HOME_ENVIRONMENT, fences: [1, 6] };
    expect(validateEnvironment(invalid)).toMatchObject({ shortestDistance: null, errors: ['Домик отрезан ограждениями. Освободи проход.'] });
  });

  it('недоступное лакомство даёт предупреждение без запрета достижимого домика', () => {
    const map = { ...HOME_ENVIRONMENT, home: 1, treat: 5, fences: [4, 11] };
    const result = validateEnvironment(map);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.shortestDistance).toBe(1);
  });

  it('пресет допустим, включая seed 0 и верхнюю границу uint32', () => {
    for (const seed of [0, 42, 0xffffffff]) expect(validateTrainingConfig({ ...DEFAULT_TRAINING, seed })).toEqual([]);
  });

  it.each([
    { episodes: 0 }, { episodes: 1.5 }, { episodes: 100_001 }, { maxSteps: 0 }, { maxSteps: 10_001 },
    { episodes: 100_000, maxSteps: 1000 }, { alpha: 0 }, { alpha: 1.01 }, { alpha: Number.NaN },
    { gamma: -0.1 }, { gamma: 1 }, { gamma: Number.POSITIVE_INFINITY },
    { epsilonStart: 1.1 }, { epsilonEnd: -0.1 }, { epsilonEnd: Number.NaN },
    { epsilonStart: 0.1, epsilonEnd: 0.5 }, { decayFraction: 0 }, { decayFraction: 1.1 },
    { seed: -1 }, { seed: 0x100000000 }, { seed: 1.5 }, { seed: Number.NaN },
  ] satisfies Partial<TrainingConfig>[])('отклоняет некорректные настройки: %o', (changes) => {
    expect(validateTrainingConfig({ ...DEFAULT_TRAINING, ...changes }).length).toBeGreaterThan(0);
  });
});
