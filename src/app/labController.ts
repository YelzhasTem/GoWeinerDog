import type {
  EnvironmentConfig,
  EvaluationResult,
  TrainingConfig,
  TrainingProgress,
  TrainingResult,
} from '../domain/types';
import type { WorkerRequest, WorkerResponse } from '../workers/protocol';

export interface LabState {
  readonly status: 'idle' | 'training' | 'trained' | 'evaluating' | 'ready' | 'cancelled' | 'error';
  readonly runId: number;
  readonly revision: number;
  readonly progress: TrainingProgress | null;
  readonly model: TrainingResult | null;
  readonly evaluation: EvaluationResult | null;
  readonly error: string | null;
}

// Небольшой контракт позволяет проверить гонки и остановку без браузера.
export interface LabWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(message: WorkerRequest): void;
  terminate(): void;
}

export type WorkerFactory = () => LabWorker;

const defaultWorkerFactory: WorkerFactory = () => new Worker(
  new URL('../workers/lab.worker.ts', import.meta.url),
  { type: 'module' },
);

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function createLabController(workerFactory: WorkerFactory = defaultWorkerFactory) {
  let state: LabState = Object.freeze({
    status: 'idle', runId: 0, revision: 0,
    progress: null, model: null, evaluation: null, error: null,
  });
  let worker: LabWorker | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: LabState) => {
    state = Object.freeze(next);
    for (const listener of [...listeners]) listener();
  };

  const terminateWorker = () => {
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  };

  const launch = (request: WorkerRequest, expectedStatus: 'training' | 'evaluating') => {
    // Подписчик мог отменить операцию сразу после публикации нового состояния.
    if (state.runId !== request.runId || state.status !== expectedStatus) return;
    let operationWorker: LabWorker | null = null;
    const isCurrent = () => state.runId === request.runId
      && state.revision === request.revision
      && state.status === expectedStatus
      && worker === operationWorker;
    const fail = (message: string) => {
      if (!isCurrent()) return;
      terminateWorker();
      publish({ ...state, status: 'error', error: message });
    };

    try {
      operationWorker = workerFactory();
      worker = operationWorker;
      operationWorker.onmessage = ({ data }) => {
        // terminate() останавливает расчёт; эти проверки отсеивают уже
        // отправленное сообщение старого запуска или старых условий.
        if (!isCurrent() || data.runId !== state.runId || data.revision !== state.revision) return;
        if (data.type === 'error') {
          fail(data.message);
        } else if (data.type === 'progress' && expectedStatus === 'training') {
          publish({ ...state, progress: freezeDeep(data.progress) });
        } else if (data.type === 'trained' && expectedStatus === 'training') {
          terminateWorker();
          publish({ ...state, status: 'trained', model: freezeDeep(data.result), error: null });
        } else if (data.type === 'evaluated' && expectedStatus === 'evaluating') {
          terminateWorker();
          publish({ ...state, status: 'ready', evaluation: freezeDeep(data.result), error: null });
        }
      };
      operationWorker.onerror = (event) => {
        event.preventDefault();
        fail('Расчёт прервался из-за ошибки. Попробуйте запустить тренировку заново.');
      };
      operationWorker.onmessageerror = () => {
        fail('Не удалось прочитать результат расчёта. Попробуйте запустить тренировку заново.');
      };
      operationWorker.postMessage(request);
    } catch {
      // Здесь оказываемся и при ошибке создания Worker, и при postMessage.
      fail('Не удалось запустить расчёт в браузере. Обновите страницу и попробуйте снова.');
    }
  };

  return {
    // Один и тот же объект между изменениями нужен useSyncExternalStore.
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    train: (environment: EnvironmentConfig, config: TrainingConfig) => {
      terminateWorker();
      const runId = state.runId + 1;
      const revision = state.revision + 1;
      publish({ status: 'training', runId, revision, progress: null, model: null, evaluation: null, error: null });
      launch({ type: 'train', runId, revision, environment: structuredClone(environment), config: structuredClone(config) }, 'training');
    },
    evaluate: () => {
      const model = state.model;
      if (!model || state.status === 'training' || state.status === 'evaluating') return;
      terminateWorker();
      const runId = state.runId + 1;
      const revision = state.revision;
      publish({ ...state, runId, status: 'evaluating', evaluation: null, error: null });
      launch({ type: 'evaluate', runId, revision, environment: structuredClone(model.environment), q: structuredClone(model.q), maxSteps: model.config.maxSteps }, 'evaluating');
    },
    cancel: () => {
      if (state.status !== 'training' && state.status !== 'evaluating') return;
      terminateWorker();
      publish({ ...state, runId: state.runId + 1, status: 'cancelled', evaluation: null, error: null });
    },
    reset: () => {
      terminateWorker();
      publish({ status: 'idle', runId: state.runId + 1, revision: state.revision + 1, progress: null, model: null, evaluation: null, error: null });
    },
    dispose: () => {
      terminateWorker();
      listeners.clear();
      // Не оставляем ссылку на старую операцию при повторном mount в StrictMode.
      state = Object.freeze({ status: 'idle', runId: state.runId + 1, revision: state.revision + 1, progress: null, model: null, evaluation: null, error: null });
    },
  };
}
