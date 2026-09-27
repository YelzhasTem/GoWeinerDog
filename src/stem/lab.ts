import { datasetSignature, type Example, type TrainedModel } from './model';
import type { TestResult } from './evaluate';
import { ALL_SITUATIONS, MOVES, situationKey, type Move, type Situation } from './situations';
import { CHALLENGE_TARGET, LEVEL1_TEACH, LEVEL2_DIVERSE, LEVEL2_SIMILAR, type LevelId } from './levels';

export type Screen = 'start' | 'intro' | 'level' | 'final' | 'sandbox';
export type Stage = 'data' | 'train' | 'test' | 'result';
export type Phase = 'similar' | 'diverse';

export interface TestRecord extends TestResult {
  attempt: number;
  level: LevelId;
  phase?: Phase;
  signature: string;
}

export interface LevelState {
  examples: Example[];
  model: TrainedModel | null;
  stage: Stage;
  tests: TestRecord[];
  /** Номер следующей подготовленной ситуации для обучения. */
  teachIndex: number;
  /** Данные менялись после последнего теста. */
  changedSinceTest: boolean;
}

export interface Flags {
  createdData: boolean;
  trained: boolean;
  tested: boolean;
  foundError: boolean;
  changedData: boolean;
  retrained: boolean;
  compared: boolean;
}

export interface StemState {
  version: 1;
  screen: Screen;
  level: LevelId;
  levels: Record<LevelId, LevelState>;
  flags: Flags;
  nextId: number;
}

const emptyLevel = (): LevelState => ({ examples: [], model: null, stage: 'data', tests: [], teachIndex: 0, changedSinceTest: false });

export const initialStemState = (): StemState => ({
  version: 1, screen: 'start', level: 1,
  levels: { 1: emptyLevel(), 2: emptyLevel(), 3: emptyLevel() },
  flags: { createdData: false, trained: false, tested: false, foundError: false, changedData: false, retrained: false, compared: false },
  nextId: 1,
});

export type StemAction =
  | { type: 'open'; screen: Screen }
  | { type: 'begin' }
  | { type: 'add'; situation: Situation; move: Move; fromTeach: boolean }
  | { type: 'remove'; id: string }
  | { type: 'skip' }
  | { type: 'stage'; stage: Stage }
  | { type: 'trained'; model: TrainedModel }
  | { type: 'tested'; result: TestResult }
  | { type: 'level'; level: LevelId }
  | { type: 'restart' };

export const phaseOf = (state: StemState, level = state.level): Phase | undefined =>
  level === 2 ? (state.levels[2].tests.length ? 'diverse' : 'similar') : undefined;

export function modelIsFresh(level: LevelState) {
  return !!level.model && level.model.datasetSignature === datasetSignature(level.examples);
}

// Простая детерминированная «случайность» для ситуаций: одинаковая на всех устройствах.
const scramble = (n: number) => ((n + 1) * 2654435761) >>> 0;

export function teachSituation(state: StemState): Situation {
  const level = state.levels[state.level];
  const index = level.teachIndex;
  if (state.level === 1 && index < LEVEL1_TEACH.length) return LEVEL1_TEACH[index];
  if (state.level === 2) return phaseOf(state) === 'similar' ? LEVEL2_SIMILAR : LEVEL2_DIVERSE[index % LEVEL2_DIVERSE.length];
  return ALL_SITUATIONS[scramble(index + state.level * 101) % ALL_SITUATIONS.length];
}

export function levelComplete(state: StemState, id: LevelId = state.level): boolean {
  const tests = state.levels[id].tests;
  if (id === 1) return tests.some((test) => test.accuracy === 1) || new Set(tests.map((test) => test.signature)).size >= 2;
  if (id === 2) {
    const similar = tests.filter((test) => test.phase === 'similar');
    const best = Math.max(0, ...similar.map((test) => test.accuracy));
    return similar.length > 0 && tests.some((test) => test.phase === 'diverse' && test.accuracy > best);
  }
  return tests.some((test) => test.accuracy >= CHALLENGE_TARGET);
}

function updateLevel(state: StemState, change: Partial<LevelState>): StemState {
  return { ...state, levels: { ...state.levels, [state.level]: { ...state.levels[state.level], ...change } } };
}

export function stemReducer(state: StemState, action: StemAction): StemState {
  const level = state.levels[state.level];
  switch (action.type) {
    case 'open':
      return { ...state, screen: action.screen };
    case 'begin':
      return { ...state, screen: 'level' };
    case 'add': {
      const example: Example = { id: `e${state.nextId}`, situation: { ...action.situation }, move: action.move };
      const next = updateLevel(state, {
        examples: [...level.examples, example],
        teachIndex: level.teachIndex + (action.fromTeach ? 1 : 0),
        changedSinceTest: level.tests.length > 0,
        stage: 'data',
      });
      return { ...next, nextId: state.nextId + 1, flags: { ...state.flags, createdData: true, changedData: state.flags.changedData || level.tests.length > 0 } };
    }
    case 'remove': {
      if (!level.examples.some((example) => example.id === action.id)) return state;
      const next = updateLevel(state, { examples: level.examples.filter((example) => example.id !== action.id), changedSinceTest: level.tests.length > 0, stage: 'data' });
      return { ...next, flags: { ...state.flags, changedData: state.flags.changedData || level.tests.length > 0 } };
    }
    case 'skip':
      return updateLevel(state, { teachIndex: level.teachIndex + 1 });
    case 'stage':
      return updateLevel(state, { stage: action.stage });
    case 'trained': {
      // Модель от устаревших данных не принимаем: её обучали не на этом наборе.
      if (action.model.datasetSignature !== datasetSignature(level.examples)) return state;
      const next = updateLevel(state, { model: action.model });
      return { ...next, flags: { ...state.flags, trained: true, retrained: state.flags.retrained || level.changedSinceTest } };
    }
    case 'tested': {
      if (!modelIsFresh(level)) return state;
      const attempt = Object.values(state.levels).reduce((sum, item) => sum + item.tests.length, 0) + 1;
      const record: TestRecord = { ...action.result, attempt, level: state.level, phase: phaseOf(state), signature: datasetSignature(level.examples) };
      const becameDiverse = state.level === 2 && level.tests.length === 0;
      const next = updateLevel(state, { tests: [...level.tests, record], stage: 'result', changedSinceTest: false, teachIndex: becameDiverse ? 0 : level.teachIndex });
      return { ...next, flags: { ...state.flags, tested: true, foundError: state.flags.foundError || action.result.correct < action.result.total, compared: attempt >= 2 } };
    }
    case 'level':
      return { ...state, level: action.level, screen: 'level', levels: { ...state.levels, [action.level]: { ...state.levels[action.level], stage: 'data' } } };
    case 'restart':
      return initialStemState();
  }
}

export const STEM_KEY = 'goweinerdog.stem.v1';

const isSituation = (value: unknown): value is Situation => {
  const s = value as Situation;
  return !!s && typeof s.rockLeft === 'boolean' && typeof s.rockAhead === 'boolean' && typeof s.rockRight === 'boolean'
    && ['left', 'ahead', 'right'].includes(s.home) && ALL_SITUATIONS.some((item) => situationKey(item) === situationKey(s));
};

function isState(value: unknown): value is StemState {
  const state = value as StemState;
  if (!state || state.version !== 1 || ![1, 2, 3].includes(state.level)) return false;
  if (!['start', 'intro', 'level', 'final', 'sandbox'].includes(state.screen)) return false;
  return [1, 2, 3].every((id) => {
    const level = state.levels?.[id as LevelId];
    return !!level && Array.isArray(level.examples) && Array.isArray(level.tests)
      && level.examples.every((example) => typeof example.id === 'string' && isSituation(example.situation) && MOVES.includes(example.move))
      && ['data', 'train', 'test', 'result'].includes(level.stage);
  });
}

export function loadStem(): StemState {
  try {
    const raw = localStorage.getItem(STEM_KEY);
    if (!raw) return initialStemState();
    const parsed = JSON.parse(raw);
    return isState(parsed) ? parsed : initialStemState();
  } catch {
    return initialStemState();
  }
}

export function saveStem(state: StemState) {
  try { localStorage.setItem(STEM_KEY, JSON.stringify(state)); return true; } catch { return false; }
}
