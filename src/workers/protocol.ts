import type {
  EnvironmentConfig,
  EvaluationResult,
  TrainingConfig,
  TrainingProgress,
  TrainingResult,
} from '../domain/types';

interface OperationId {
  runId: number;
  revision: number;
}

export type WorkerRequest = OperationId & (
  | { type: 'train'; environment: EnvironmentConfig; config: TrainingConfig }
  | { type: 'evaluate'; environment: EnvironmentConfig; q: number[][]; maxSteps: number }
);

export type WorkerResponse = OperationId & (
  | { type: 'progress'; progress: TrainingProgress }
  | { type: 'trained'; result: TrainingResult }
  | { type: 'evaluated'; result: EvaluationResult }
  | { type: 'error'; message: string }
);
