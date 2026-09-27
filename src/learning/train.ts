import { step } from '../domain/environment';
import { encodeState, initialState, RULES_VERSION, STATE_ENCODING_VERSION, stateCount } from '../domain/state';
import type { EnvironmentConfig, EpisodeMetric, TrainingConfig, TrainingProgress, TrainingResult } from '../domain/types';
import { validateEnvironment, validateTrainingConfig } from '../domain/validation';
import { ALGORITHM_VERSION, createQTable, trainingAction, updateQ } from './qLearning';
import { PRNG_VERSION, seededRandom } from './random';

/** Паузы Worker между эпизодами не меняют порядок случайных решений. */
export function* trainEpisodes(environment: EnvironmentConfig, config: TrainingConfig): Generator<TrainingProgress, TrainingResult, void> {
  const errors = [...validateEnvironment(environment).errors, ...validateTrainingConfig(config)];
  if (errors.length > 0) throw new Error(errors.join(' '));
  // У запуска свои условия: последующие изменения исходных объектов ему не мешают.
  const snapshot = { ...environment, fences: [...environment.fences], rewards: { ...environment.rewards } };
  const settings = { ...config };
  const q = createQTable(stateCount(snapshot));
  const random = seededRandom(settings.seed);
  const metrics: EpisodeMetric[] = [];
  let updates = 0;
  let goalEpisodes = 0;
  const decayEpisodes = Math.max(1, Math.ceil(settings.episodes * settings.decayFraction));

  for (let episode = 0; episode < settings.episodes; episode += 1) {
    const decay = Math.min(1, episode / Math.max(1, decayEpisodes - 1));
    const epsilon = settings.epsilonStart + (settings.epsilonEnd - settings.epsilonStart) * decay;
    let state = initialState(snapshot);
    const metric: EpisodeMetric = { episode: episode + 1, reward: 0, steps: 0, outcome: 'timeout' };
    for (let index = 0; index < settings.maxSteps; index += 1) {
      const action = trainingAction(q, encodeState(snapshot, state), epsilon, random);
      const transition = step(snapshot, state, action);
      updateQ(q, transition, settings.alpha, settings.gamma);
      updates += 1;
      metric.reward += transition.reward;
      metric.steps += 1;
      state = transition.after;
      if (transition.terminated) {
        metric.outcome = 'goal';
        goalEpisodes += 1;
        break;
      }
      // При лимите шагов updateQ уже учёл будущую оценку фактической следующей клетки.
    }
    metrics.push(metric);
    yield { completed: episode + 1, total: settings.episodes, last: { ...metric }, goalEpisodes, updates };
  }
  return {
    q, environment: snapshot, config: settings, metrics, updates,
    algorithmVersion: ALGORITHM_VERSION, prngVersion: PRNG_VERSION,
    rulesVersion: RULES_VERSION, stateEncodingVersion: STATE_ENCODING_VERSION,
  };
}

/** Синхронная оболочка для тестов; интерфейс запускает генератор внутри Worker. */
export function train(environment: EnvironmentConfig, config: TrainingConfig, onProgress?: (progress: TrainingProgress) => void): TrainingResult {
  const episodes = trainEpisodes(environment, config);
  let current = episodes.next();
  while (!current.done) {
    onProgress?.(current.value);
    current = episodes.next();
  }
  return current.value;
}
