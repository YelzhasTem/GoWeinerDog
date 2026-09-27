import { evaluate } from '../evaluation/evaluate';
import { trainEpisodes } from '../learning/train';
import type { TrainingProgress } from '../domain/types';
import type { WorkerRequest, WorkerResponse } from './protocol';

// Этот файл запускается в отдельном потоке, без доступа к React и странице.
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
  close: () => void;
};

scope.onmessage = ({ data: request }) => {
  const identity = { runId: request.runId, revision: request.revision };
  const reportError = (error: unknown) => {
    scope.postMessage({
      ...identity,
      type: 'error',
      message: error instanceof Error ? error.message : 'Не удалось выполнить расчёт. Попробуйте новую тренировку.',
    });
    scope.close();
  };

  try {
    if (request.type === 'evaluate') {
      const result = evaluate(request.environment, request.q, request.maxSteps);
      scope.postMessage({ ...identity, type: 'evaluated', result });
      scope.close();
      return;
    }

    const episodes = trainEpisodes(request.environment, request.config);
    const runBatch = () => {
      try {
        let progress: TrainingProgress | null = null;
        for (let index = 0; index < 20; index += 1) {
          const next = episodes.next();
          if (next.done) {
            scope.postMessage({ ...identity, type: 'trained', result: next.value });
            scope.close();
            return;
          }
          progress = next.value;
        }
        if (progress) scope.postMessage({ ...identity, type: 'progress', progress });
        // Пауза между пачками делает прогресс наблюдаемым. Математика зависит
        // только от номера эпизода и seed, а не от длительности этой паузы.
        setTimeout(runBatch, 12);
      } catch (error) {
        reportError(error);
      }
    };
    runBatch();
  } catch (error) {
    reportError(error);
  }
};
