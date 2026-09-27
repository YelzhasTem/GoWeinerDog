import { describe, expect, it } from 'vitest';
import { HOME_ENVIRONMENT, TRAP_ENVIRONMENT } from '../missions';
import { decodeState, encodeState, initialState, stateCount } from './state';

describe('Клетка и состояние модели — разные понятия', () => {
  it('создаёт две строки Q на клетку; кодирование обратимо для всех состояний', () => {
    expect(stateCount(TRAP_ENVIRONMENT)).toBe(72);
    expect(stateCount(HOME_ENVIRONMENT)).toBe(72);
    for (let index = 0; index < stateCount(TRAP_ENVIRONMENT); index += 1) {
      const state = decodeState(TRAP_ENVIRONMENT, index);
      expect(state.cell).toBe(index % 36);
      expect(encodeState(TRAP_ENVIRONMENT, state)).toBe(index);
    }
    expect(encodeState(TRAP_ENVIRONMENT, { cell: 1, treatCollected: false })).toBe(1);
    expect(encodeState(TRAP_ENVIRONMENT, { cell: 1, treatCollected: true })).toBe(37);
  });

  it('новое состояние независимо и начинается без собранного лакомства', () => {
    const first = initialState(TRAP_ENVIRONMENT);
    first.treatCollected = true;
    expect(initialState(TRAP_ENVIRONMENT)).toEqual({ cell: 0, treatCollected: false });
  });

  it.each([-1, 72, 0.5, Number.NaN])('не выдаёт клетку для несуществующего состояния %s', (index) => {
    expect(() => decodeState(TRAP_ENVIRONMENT, index)).toThrow('Номер состояния');
  });

  it.each([-1, 36, 0.5, Number.NaN])('не принимает несуществующую клетку %s', (cell) => {
    expect(() => encodeState(TRAP_ENVIRONMENT, { cell, treatCollected: false })).toThrow('Состояние');
  });
});
