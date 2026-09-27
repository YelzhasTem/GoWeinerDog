import { MOVES, situationKey, type Move, type Situation } from './situations';

// Настоящая маленькая модель: многоклассовая логистическая регрессия (softmax).
// Бот видит 7 признаков ситуации и для каждого решения подбирает «веса» —
// насколько каждый признак говорит «иди сюда» или «не иди сюда».
// Веса находятся градиентным спуском только по примерам ученика.

export const FEATURES = ['привычка', 'камень слева', 'камень впереди', 'камень справа', 'дом слева', 'дом прямо', 'дом справа'] as const;

export function features(s: Situation): number[] {
  return [1, +s.rockLeft, +s.rockAhead, +s.rockRight, +(s.home === 'left'), +(s.home === 'ahead'), +(s.home === 'right')];
}

export interface Example {
  id: string;
  situation: Situation;
  move: Move;
}

export interface TrainedModel {
  /** weights[решение][признак] */
  weights: number[][];
  epochs: number;
  loss: number;
  /** Доля обучающих примеров, на которых модель отвечает так же, как ученик. */
  trainAccuracy: number;
  examples: number;
  datasetSignature: string;
}

export const TRAINING = { epochs: 300, learningRate: 0.6, l2: 0.01 } as const;

/** Подпись набора данных: меняется при любом добавлении или удалении примера. */
export function datasetSignature(examples: readonly Example[]) {
  return examples.map((example) => `${situationKey(example.situation)}>${example.move}`).sort().join('|');
}

function softmax(scores: number[]) {
  const max = Math.max(...scores);
  const exp = scores.map((score) => Math.exp(score - max));
  const sum = exp.reduce((a, b) => a + b, 0);
  return exp.map((value) => value / sum);
}

export function scores(weights: readonly (readonly number[])[], s: Situation) {
  const x = features(s);
  return weights.map((row) => row.reduce((sum, w, index) => sum + w * x[index], 0));
}

export interface Prediction {
  move: Move;
  probabilities: Record<Move, number>;
}

// При равных оценках бот выбирает «прямо», затем «влево», затем «вправо».
const TIE_ORDER: readonly Move[] = ['straight', 'left', 'right'];

export function predict(model: Pick<TrainedModel, 'weights'>, s: Situation): Prediction {
  const probs = softmax(scores(model.weights, s));
  let best: Move = TIE_ORDER[0];
  for (const move of TIE_ORDER) {
    if (probs[MOVES.indexOf(move)] > probs[MOVES.indexOf(best)] + 1e-9) best = move;
  }
  return { move: best, probabilities: { left: probs[0], straight: probs[1], right: probs[2] } };
}

export interface Trainer {
  /** Выполняет до count эпох и возвращает текущую эпоху и ошибку. */
  run(count: number): { epoch: number; loss: number; done: boolean };
  result(): TrainedModel;
}

/** Обучение с нуля по текущим примерам. Никаких заготовленных весов. */
export function createTrainer(examples: readonly Example[], options = TRAINING): Trainer {
  const weights = MOVES.map(() => FEATURES.map(() => 0));
  const data = examples.map((example) => ({ x: features(example.situation), y: MOVES.indexOf(example.move) }));
  let epoch = 0;
  let loss = Math.log(MOVES.length);
  const measure = () => {
    if (!data.length) return Math.log(MOVES.length);
    let total = 0;
    for (const { x, y } of data) {
      const p = softmax(weights.map((row) => row.reduce((sum, w, i) => sum + w * x[i], 0)));
      total -= Math.log(Math.max(p[y], 1e-12));
    }
    return total / data.length;
  };
  return {
    run(count) {
      for (let n = 0; n < count && epoch < options.epochs; n += 1, epoch += 1) {
        if (!data.length) continue;
        const gradient = weights.map((row) => row.map(() => 0));
        for (const { x, y } of data) {
          const p = softmax(weights.map((row) => row.reduce((sum, w, i) => sum + w * x[i], 0)));
          for (let k = 0; k < MOVES.length; k += 1) {
            const error = p[k] - (k === y ? 1 : 0);
            for (let i = 0; i < x.length; i += 1) gradient[k][i] += error * x[i] / data.length;
          }
        }
        for (let k = 0; k < MOVES.length; k += 1) {
          for (let i = 0; i < FEATURES.length; i += 1) {
            weights[k][i] -= options.learningRate * (gradient[k][i] + options.l2 * weights[k][i]);
          }
        }
      }
      loss = measure();
      return { epoch, loss, done: epoch >= options.epochs };
    },
    result() {
      const snapshot = weights.map((row) => [...row]);
      const hits = examples.filter((example) => predict({ weights: snapshot }, example.situation).move === example.move).length;
      return {
        weights: snapshot, epochs: epoch, loss: measure(),
        trainAccuracy: examples.length ? hits / examples.length : 0,
        examples: examples.length, datasetSignature: datasetSignature(examples),
      };
    },
  };
}

export function train(examples: readonly Example[]) {
  const trainer = createTrainer(examples);
  trainer.run(TRAINING.epochs);
  return trainer.result();
}

export interface Insight { feature: string; move: Move; strength: number }

/** Самые заметные закономерности: какой признак сильнее всего тянет к решению. */
export function insights(model: Pick<TrainedModel, 'weights'>, limit = 4): Insight[] {
  const list: Insight[] = [];
  for (let i = 1; i < FEATURES.length; i += 1) {
    const column = model.weights.map((row) => row[i]);
    const mean = column.reduce((a, b) => a + b, 0) / column.length;
    column.forEach((w, k) => list.push({ feature: FEATURES[i], move: MOVES[k], strength: w - mean }));
  }
  return list.filter((item) => item.strength > 0.25).sort((a, b) => b.strength - a.strength).slice(0, limit);
}
