import { describe, expect, it, vi } from 'vitest';
import type { EnvironmentConfig, EvaluationResult, TrainingConfig, TrainingProgress, TrainingResult } from '../domain/types';
import type { WorkerRequest, WorkerResponse } from '../workers/protocol';
import { createLabController, type LabWorker } from './labController';
import { step } from '../domain/environment';
import { initialState, RULES_VERSION, STATE_ENCODING_VERSION } from '../domain/state';

class FakeWorker implements LabWorker {
  onmessage: LabWorker['onmessage'] = null;
  onerror: LabWorker['onerror'] = null;
  onmessageerror: LabWorker['onmessageerror'] = null;
  requests: WorkerRequest[] = [];
  terminate = vi.fn();
  postMessage(message: WorkerRequest) { this.requests.push(message); }
  emit(message: WorkerResponse) { this.onmessage?.({ data: message } as MessageEvent<WorkerResponse>); }
}

function fixture() {
  const environment: EnvironmentConfig = {
    width: 2, height: 1, start: 0, home: 1, fences: [],
    rewards: { step: -1, collision: -1, home: 20, treat: 0 },
  };
  const config: TrainingConfig = {
    episodes: 40, maxSteps: 10, seed: 42, alpha: 0.2, gamma: 0.95,
    epsilonStart: 1, epsilonEnd: 0.05, decayFraction: 0.8,
  };
  const result: TrainingResult = {
    environment, config, q: [[0, 19, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
    metrics: [{ episode: 1, reward: 19, steps: 1, outcome: 'goal' }],
    updates: 1, algorithmVersion: 'test', prngVersion: 'test',
    rulesVersion: RULES_VERSION, stateEncodingVersion: STATE_ENCODING_VERSION,
  };
  const evaluation: EvaluationResult = {
    transitions: [step(environment, initialState(environment), 1)],
    positions: [0, 1], reward: 19, steps: 1, outcome: 'goal', treatEntries: 0, collisions: 0,
    states: [initialState(environment), { cell: 1, treatCollected: false }], treatCollections: 0,
  };
  const progress: TrainingProgress = {
    completed: 20, total: 40, last: { episode: 20, reward: 19, steps: 1, outcome: 'goal' },
    goalEpisodes: 17, updates: 50,
  };
  const workers: FakeWorker[] = [];
  const controller = createLabController(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const identify = () => ({ runId: controller.getSnapshot().runId, revision: controller.getSnapshot().revision });
  return { controller, workers, environment, config, result, evaluation, progress, identify };
}

describe('управление расчётами и остановкой', () => {
  it('держит стабильный снимок, уведомляет подписчика и корректно отписывает', () => {
    const { controller, environment, config } = fixture();
    const initial = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(initial);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);
    controller.train(environment, config);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).not.toBe(initial);
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
    const training = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(training);
    unsubscribe();
    controller.cancel();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('останавливает настоящий Worker и игнорирует уже отправленные progress/done', () => {
    const { controller, environment, config, workers, result, progress, identify } = fixture();
    controller.train(environment, config);
    const identity = identify();
    const lateHandler = workers[0].onmessage!;
    workers[0].emit({ ...identity, type: 'progress', progress });
    expect(controller.getSnapshot().progress?.completed).toBe(20);
    controller.cancel();
    const cancelled = controller.getSnapshot();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.model).toBeNull();
    lateHandler({ data: { ...identity, type: 'progress', progress } } as MessageEvent<WorkerResponse>);
    lateHandler({ data: { ...identity, type: 'trained', result } } as MessageEvent<WorkerResponse>);
    expect(controller.getSnapshot()).toBe(cancelled);
  });

  it('после stop запускает новую тренировку с нуля, старый done не заменяет её', () => {
    const { controller, environment, config, workers, result, identify } = fixture();
    controller.train(environment, config);
    const oldIdentity = identify();
    const lateHandler = workers[0].onmessage!;
    controller.cancel();
    controller.train(environment, { ...config, seed: 7 });
    expect(workers).toHaveLength(2);
    expect(workers[1].requests[0]).toMatchObject({ type: 'train', config: { seed: 7 } });
    expect(workers[1].requests[0]).not.toHaveProperty('q');
    lateHandler({ data: { ...oldIdentity, type: 'trained', result } } as MessageEvent<WorkerResponse>);
    expect(controller.getSnapshot().status).toBe('training');
    expect(controller.getSnapshot().model).toBeNull();
    workers[1].emit({ ...identify(), type: 'trained', result: { ...result, config: { ...config, seed: 7 } } });
    expect(controller.getSnapshot().status).toBe('trained');
    expect(controller.getSnapshot().model?.config.seed).toBe(7);
  });

  it('новый train без stop завершает старый Worker и изолирует условия от внешних правок', () => {
    const { controller, environment, config, workers } = fixture();
    controller.train(environment, config);
    config.seed = 99;
    environment.rewards.home = 8;
    expect(workers[0].requests[0]).toMatchObject({ config: { seed: 42 }, environment: { rewards: { home: 20 } } });
    controller.train(environment, config);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(workers[1].requests[0]).toMatchObject({ config: { seed: 99 } });
    expect(controller.getSnapshot().model).toBeNull();
  });

  it('отдельная проверка получает копию Q, завершает Worker и сохраняет неизменную модель', () => {
    const { controller, environment, config, workers, result, evaluation, identify } = fixture();
    controller.train(environment, config);
    workers[0].emit({ ...identify(), type: 'trained', result });
    const model = controller.getSnapshot().model;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(Object.isFrozen(model!.q[0])).toBe(true);
    controller.evaluate();
    expect(controller.getSnapshot().status).toBe('evaluating');
    const request = workers[1].requests[0];
    expect(request.type).toBe('evaluate');
    if (request.type !== 'evaluate') throw new Error('Ожидалась проверка');
    expect(request.q).toEqual(model!.q);
    expect(request.q).not.toBe(model!.q);
    request.q[0][1] = -999;
    expect(model!.q[0][1]).toBe(19);
    workers[1].emit({ ...identify(), type: 'evaluated', result: evaluation });
    expect(controller.getSnapshot().status).toBe('ready');
    expect(controller.getSnapshot().model).toBe(model);
    expect(controller.getSnapshot().evaluation).toEqual(evaluation);
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });

  it('отмена проверки сохраняет модель и позволяет проверить снова', () => {
    const { controller, environment, config, workers, result, evaluation, identify } = fixture();
    controller.train(environment, config);
    workers[0].emit({ ...identify(), type: 'trained', result });
    controller.evaluate();
    const oldIdentity = identify();
    const lateHandler = workers[1].onmessage!;
    controller.cancel();
    expect(workers[1].terminate).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().model).toBe(result);
    lateHandler({ data: { ...oldIdentity, type: 'evaluated', result: evaluation } } as MessageEvent<WorkerResponse>);
    expect(controller.getSnapshot().evaluation).toBeNull();
    controller.evaluate();
    expect(workers).toHaveLength(3);
    expect(controller.getSnapshot().status).toBe('evaluating');
  });

  it('reset меняет версию условий, убирает старый опыт и завершает текущую проверку', () => {
    const { controller, environment, config, workers, result, evaluation, identify } = fixture();
    controller.train(environment, config);
    workers[0].emit({ ...identify(), type: 'trained', result });
    controller.evaluate();
    const beforeReset = identify();
    const lateHandler = workers[1].onmessage!;
    controller.reset();
    const idle = controller.getSnapshot();
    expect(idle.revision).toBeGreaterThan(beforeReset.revision);
    expect(idle).toMatchObject({ status: 'idle', model: null, evaluation: null, progress: null });
    expect(workers[1].terminate).toHaveBeenCalledOnce();
    lateHandler({ data: { ...beforeReset, type: 'evaluated', result: evaluation } } as MessageEvent<WorkerResponse>);
    expect(controller.getSnapshot()).toBe(idle);
    controller.evaluate();
    expect(workers).toHaveLength(2);
  });

  it('отсеивает неверную revision и сообщения другого вида, даже если runId совпадает', () => {
    const { controller, environment, config, workers, progress, evaluation, identify } = fixture();
    controller.train(environment, config);
    const current = controller.getSnapshot();
    workers[0].emit({ ...identify(), revision: current.revision - 1, type: 'progress', progress });
    workers[0].emit({ ...identify(), type: 'evaluated', result: evaluation });
    expect(controller.getSnapshot()).toBe(current);
  });

  it('ошибка Worker завершает операцию и показывает понятную причину', () => {
    const { controller, environment, config, workers, identify } = fixture();
    controller.train(environment, config);
    workers[0].emit({ ...identify(), type: 'error', message: 'Домик недоступен: проверьте ограждения.' });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', model: null, error: 'Домик недоступен: проверьте ограждения.' });
  });

  it('ловит ошибки создания Worker и отправки сообщения', () => {
    const { environment, config } = fixture();
    const missingWorker = createLabController(() => { throw new Error('no worker'); });
    expect(() => missingWorker.train(environment, config)).not.toThrow();
    expect(missingWorker.getSnapshot().status).toBe('error');
    const worker = new FakeWorker();
    worker.postMessage = () => { throw new Error('post failed'); };
    const failedPost = createLabController(() => worker);
    expect(() => failedPost.train(environment, config)).not.toThrow();
    expect(failedPost.getSnapshot().status).toBe('error');
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('ловит ошибку загрузки и ошибку десериализации Worker', () => {
    const { controller, environment, config, workers } = fixture();
    controller.train(environment, config);
    const preventDefault = vi.fn();
    workers[0].onerror!({ preventDefault } as unknown as ErrorEvent);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(controller.getSnapshot().status).toBe('error');
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    controller.train(environment, config);
    workers[1].onmessageerror!({} as MessageEvent);
    expect(controller.getSnapshot().status).toBe('error');
    expect(workers[1].terminate).toHaveBeenCalledOnce();
  });

  it('dispose очищает подписки и Worker, затем допускает повторный mount StrictMode', () => {
    const { controller, environment, config, workers, result, identify } = fixture();
    const listener = vi.fn();
    controller.subscribe(listener);
    controller.train(environment, config);
    const oldIdentity = identify();
    const lateHandler = workers[0].onmessage!;
    controller.dispose();
    controller.dispose();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    lateHandler({ data: { ...oldIdentity, type: 'trained', result } } as MessageEvent<WorkerResponse>);
    expect(controller.getSnapshot().status).toBe('idle');
    const newListener = vi.fn();
    controller.subscribe(newListener);
    controller.train(environment, config);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(newListener).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
  });
});
