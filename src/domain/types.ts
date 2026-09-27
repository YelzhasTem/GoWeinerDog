// Номер действия всегда означает одно и то же направление.
export type Action = 0 | 1 | 2 | 3;
export const ACTIONS: readonly Action[] = [0, 1, 2, 3];
export const ACTION_NAMES = ['вверх', 'вправо', 'вниз', 'влево'] as const;

export interface Rewards {
  step: number;
  collision: number;
  home: number;
  treat: number;
}

export interface EnvironmentConfig {
  width: number;
  height: number;
  start: number;
  home: number;
  fences: number[];
  treat?: number;
  rewards: Rewards;
}

export interface TrainingConfig {
  episodes: number;
  maxSteps: number;
  alpha: number;
  gamma: number;
  epsilonStart: number;
  epsilonEnd: number;
  decayFraction: number;
  seed: number;
}

export interface AgentState {
  cell: number;
  treatCollected: boolean;
}

/** Общие поля сохранённого перехода, включая архив старых правил. */
export interface TransitionRecord {
  from: number;
  to: number;
  action: Action;
  reward: number;
  collision: boolean;
  moved: boolean;
  enteredTreat: boolean;
  terminated: boolean;
  rewardParts: Rewards;
  collectedTreat?: boolean;
}

export interface Transition extends TransitionRecord {
  fromState: number;
  toState: number;
  before: AgentState;
  after: AgentState;
  collectedTreat: boolean;
}

export type QTable = number[][];
export type ReadonlyQTable = readonly (readonly number[])[];
export type Outcome = 'goal' | 'timeout';

export interface EpisodeMetric {
  episode: number;
  reward: number;
  steps: number;
  outcome: Outcome;
}

export interface TrainingProgress {
  completed: number;
  total: number;
  last: EpisodeMetric;
  goalEpisodes: number;
  updates: number;
}

export interface TrainingRecord {
  q: QTable;
  config: TrainingConfig;
  environment: EnvironmentConfig;
  metrics: EpisodeMetric[];
  updates: number;
  algorithmVersion: string;
  prngVersion: string;
  rulesVersion?: string;
  stateEncodingVersion?: string;
}

export interface TrainingResult extends TrainingRecord {
  rulesVersion: 'treat-once-v2';
  stateEncodingVersion: 'cell-treat-v2';
}

export interface EvaluationRecord {
  transitions: TransitionRecord[];
  positions: number[];
  reward: number;
  steps: number;
  outcome: Outcome;
  treatEntries: number;
  collisions: number;
  treatCollections?: number;
}

export interface EvaluationResult extends EvaluationRecord {
  transitions: Transition[];
  states: AgentState[];
  treatCollections: number;
}
