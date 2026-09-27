import { step } from '../domain/environment';
import { encodeState, initialState, stateCount } from '../domain/state';
import type { EnvironmentConfig, EvaluationResult, ReadonlyQTable } from '../domain/types';
import { MAX_STEPS, validateEnvironment } from '../domain/validation';
import { greedyAction } from '../learning/qLearning';

/** Проверка только читает Q. Нет ни случайного исследования, ни обновлений. */
export function evaluate(environment: EnvironmentConfig, q: ReadonlyQTable, maxSteps: number): EvaluationResult {
  const errors = validateEnvironment(environment).errors;
  if (errors.length > 0) throw new Error(errors.join(' '));
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_STEPS) throw new Error(`Лимит проверки должен быть целым от 1 до ${MAX_STEPS}.`);
  if (q.length !== stateCount(environment) || q.some((row) => row.length !== 4 || row.some((value) => !Number.isFinite(value)))) {
    throw new Error('Q-таблица должна содержать четыре конечные оценки для каждого состояния: клетки и признака сбора лакомства.');
  }
  let state = initialState(environment);
  const result: EvaluationResult = {
    transitions: [], positions: [state.cell], states: [{ ...state }], reward: 0, steps: 0,
    outcome: 'timeout', treatEntries: 0, treatCollections: 0, collisions: 0,
  };
  for (let index = 0; index < maxSteps; index += 1) {
    const transition = step(environment, state, greedyAction(q, encodeState(environment, state)));
    result.transitions.push(transition);
    result.positions.push(transition.to);
    result.states.push({ ...transition.after });
    result.reward += transition.reward;
    result.steps += 1;
    if (transition.collectedTreat) result.treatCollections += 1;
    if (transition.enteredTreat) result.treatEntries += 1;
    if (transition.collision) result.collisions += 1;
    state = transition.after;
    if (transition.terminated) {
      result.outcome = 'goal';
      break;
    }
  }
  return result;
}
