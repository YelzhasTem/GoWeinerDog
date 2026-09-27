import type { AgentState, EnvironmentConfig } from './types';

export const RULES_VERSION = 'treat-once-v2';
export const STATE_ENCODING_VERSION = 'cell-treat-v2';

/** У каждой клетки две строки Q: до сбора лакомства и после него. */
export function stateCount(environment: EnvironmentConfig): number {
  return environment.width * environment.height * 2;
}

export function initialState(environment: EnvironmentConfig): AgentState {
  return { cell: environment.start, treatCollected: false };
}

export function encodeState(environment: EnvironmentConfig, state: AgentState): number {
  const cells = environment.width * environment.height;
  if (!state || !Number.isInteger(state.cell) || state.cell < 0 || state.cell >= cells || typeof state.treatCollected !== 'boolean') {
    throw new Error('Состояние должно содержать клетку площадки и признак сбора лакомства.');
  }
  return state.cell + (state.treatCollected ? cells : 0);
}

export function decodeState(environment: EnvironmentConfig, index: number): AgentState {
  const cells = environment.width * environment.height;
  if (!Number.isInteger(index) || index < 0 || index >= stateCount(environment)) {
    throw new Error('Номер состояния модели выходит за границы Q-таблицы.');
  }
  return { cell: index % cells, treatCollected: index >= cells };
}
