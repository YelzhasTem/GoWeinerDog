import { predict, type Example, type TrainedModel } from './model';
import { judge, situationKey, type Move, type Situation, type Verdict } from './situations';

export type ErrorCause = 'new-situation' | 'taught-this' | 'outweighed';

export interface TestItem {
  situation: Situation;
  move: Move;
  verdict: Verdict;
  probabilities: Record<Move, number>;
  /** Была ли ровно такая ситуация в обучающих примерах. */
  seen: boolean;
  cause?: ErrorCause;
}

export interface TestResult {
  items: TestItem[];
  correct: number;
  total: number;
  accuracy: number;
  examples: number;
  diversity: number;
}

export const diversity = (examples: readonly Example[]) => new Set(examples.map((example) => situationKey(example.situation))).size;

/** Бот сам решает каждую тестовую ситуацию. Процент считается только из его решений. */
export function runTest(model: TrainedModel, examples: readonly Example[], tests: readonly Situation[]): TestResult {
  const items = tests.map((situation): TestItem => {
    const prediction = predict(model, situation);
    const verdict = judge(situation, prediction.move);
    const same = examples.filter((example) => situationKey(example.situation) === situationKey(situation));
    const item: TestItem = { situation, move: prediction.move, verdict, probabilities: prediction.probabilities, seen: same.length > 0 };
    if (verdict !== 'ok') {
      item.cause = !same.length ? 'new-situation'
        : same.some((example) => example.move === prediction.move) ? 'taught-this' : 'outweighed';
    }
    return item;
  });
  const correct = items.filter((item) => item.verdict === 'ok').length;
  return { items, correct, total: items.length, accuracy: items.length ? correct / items.length : 0, examples: examples.length, diversity: diversity(examples) };
}
