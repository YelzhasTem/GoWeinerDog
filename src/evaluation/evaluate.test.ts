import { afterEach, describe, expect, it, vi } from 'vitest';
import { step } from '../domain/environment';
import { stateCount } from '../domain/state';
import { createQTable } from '../learning/qLearning';
import { train } from '../learning/train';
import * as randomModule from '../learning/random';
import { DEFAULT_TRAINING, HOME_ENVIRONMENT, TRAP_ENVIRONMENT } from '../missions';
import { evaluate } from './evaluate';

afterEach(() => vi.restoreAllMocks());

describe('Отдельная проверка стратегии', () => {
  it('не изменяет даже замороженную Q и не вызывает Math.random', () => {
    const { q } = train(HOME_ENVIRONMENT, DEFAULT_TRAINING);
    const before = structuredClone(q);
    const frozen = Object.freeze(q.map((row) => Object.freeze(row)));
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('Случайность запрещена в проверке'); });
    vi.spyOn(randomModule, 'seededRandom').mockImplementation(() => { throw new Error('PRNG запрещён в проверке'); });
    const first = evaluate(HOME_ENVIRONMENT, frozen, 100);
    const second = evaluate(HOME_ENVIRONMENT, frozen, 100);
    expect(frozen).toEqual(before);
    expect(second).toEqual(first);
    expect(first.outcome).toBe('goal');
  });

  it('отделяет посещения от сбора; каждая отдельная проверка снова начинает с лакомством', () => {
    // Только тестовая заведомо циклическая политика проверяет правила; в приложении Q обучается.
    const q = createQTable(stateCount(TRAP_ENVIRONMENT));
    q[0][1] = 1;
    q[37][1] = 1;
    q[38][3] = 1;
    const frozen = Object.freeze(q.map((row) => Object.freeze(row)));
    const first = evaluate(TRAP_ENVIRONMENT, frozen, 5);
    const second = evaluate(TRAP_ENVIRONMENT, frozen, 5);
    expect(first).toMatchObject({ positions: [0, 1, 2, 1, 2, 1], outcome: 'timeout', treatEntries: 3, treatCollections: 1, reward: 0 });
    expect(first.transitions.map((transition) => transition.rewardParts.treat)).toEqual([5, 0, 0, 0, 0]);
    expect(first.states.map((state) => state.treatCollected)).toEqual([false, true, true, true, true, true]);
    expect(first.reward).toBe(first.transitions.reduce((sum, transition) => sum + transition.reward, 0));
    expect(first.positions).toEqual(first.states.map((state) => state.cell));
    expect(second).toEqual(first);
    expect(q[0][1]).toBe(1);
    expect(q[37][1]).toBe(1);
    expect(q[38][3]).toBe(1);
  });

  it('нулевая Q честно даёт столкновения и timeout; хороший маршрут не подставляется', () => {
    const result = evaluate(HOME_ENVIRONMENT, createQTable(stateCount(HOME_ENVIRONMENT)), 3);
    expect(result).toMatchObject({ positions: [0, 0, 0, 0], outcome: 'timeout', steps: 3, collisions: 3, reward: -6 });
    expect(result.transitions.every((transition) => transition.action === 0)).toBe(true);
  });

  it('каждый переход соответствует правилам; очки и метрики складываются из переходов', () => {
    const trained = train(HOME_ENVIRONMENT, DEFAULT_TRAINING);
    const result = evaluate(trained.environment, trained.q, 100);
    result.transitions.forEach((transition, index) => {
      expect(transition).toEqual(step(trained.environment, result.states[index], transition.action));
      expect(result.positions[index]).toBe(transition.from);
      expect(result.positions[index + 1]).toBe(transition.to);
    });
    expect(result.reward).toBe(result.transitions.reduce((sum, transition) => sum + transition.reward, 0));
    expect(result.steps).toBe(result.transitions.length);
    expect(result.positions).toHaveLength(result.steps + 1);
  });

  it('домик на границе лимита имеет приоритет перед timeout', () => {
    const environment = { ...HOME_ENVIRONMENT, width: 2, height: 1, start: 0, home: 1, fences: [] };
    expect(evaluate(environment, [[0, 1, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 1)).toMatchObject({ outcome: 'goal', steps: 1, reward: 19 });
  });

  it('лимит меньше необходимого расстояния ограничивает честный путь без лишних шагов', () => {
    const trained = train(HOME_ENVIRONMENT, DEFAULT_TRAINING);
    expect(evaluate(trained.environment, trained.q, 1)).toMatchObject({ outcome: 'timeout', steps: 1 });
    expect(evaluate(trained.environment, trained.q, 10)).toMatchObject({ outcome: 'goal', steps: 10 });
  });

  it('отклоняет старую таблицу из 36 строк вместо молчаливого применения новых правил', () => {
    expect(() => evaluate(HOME_ENVIRONMENT, createQTable(36), 100)).toThrow('для каждого состояния');
  });

  it('отклоняет неверный лимит и испорченную Q', () => {
    expect(() => evaluate(HOME_ENVIRONMENT, createQTable(stateCount(HOME_ENVIRONMENT)), 0)).toThrow('Лимит проверки');
    expect(() => evaluate(HOME_ENVIRONMENT, [[0, 0, 0, 0]], 100)).toThrow('Q-таблица');
    const invalid = createQTable(stateCount(HOME_ENVIRONMENT));
    invalid[0][0] = Number.NaN;
    expect(() => evaluate(HOME_ENVIRONMENT, invalid, 100)).toThrow('Q-таблица');
  });
});
