// Мир STEM-лаборатории: такса смотрит вперёд (вверх на экране), вокруг могут
// лежать камни, а домик виден впереди слева, прямо или справа. Здесь только
// правила мира и проверка решений. Модель о них ничего не знает — она видит
// лишь обучающие примеры ученика.

export type Move = 'left' | 'straight' | 'right';
export type HomeSide = 'left' | 'ahead' | 'right';

export const MOVES: readonly Move[] = ['left', 'straight', 'right'];
export const HOME_SIDES: readonly HomeSide[] = ['left', 'ahead', 'right'];
export const MOVE_LABELS: Record<Move, string> = { left: 'ВЛЕВО', straight: 'ПРЯМО', right: 'ВПРАВО' };
export const MOVE_ARROWS: Record<Move, string> = { left: '←', straight: '↑', right: '→' };

export interface Situation {
  /** true — на клетке камень. */
  rockLeft: boolean;
  rockAhead: boolean;
  rockRight: boolean;
  home: HomeSide;
}

export const situationKey = (s: Situation) =>
  `${Number(s.rockLeft)}${Number(s.rockAhead)}${Number(s.rockRight)}-${s.home}`;

export function situationFromKey(key: string): Situation {
  const match = /^([01])([01])([01])-(left|ahead|right)$/.exec(key);
  if (!match) throw new Error(`Неизвестная ситуация: ${key}`);
  return { rockLeft: match[1] === '1', rockAhead: match[2] === '1', rockRight: match[3] === '1', home: match[4] as HomeSide };
}

export const isBlocked = (s: Situation, move: Move) =>
  move === 'left' ? s.rockLeft : move === 'right' ? s.rockRight : s.rockAhead;

/** Все ситуации, из которых есть хотя бы один свободный ход: 7 × 3 = 21. */
export const ALL_SITUATIONS: readonly Situation[] = HOME_SIDES.flatMap((home) =>
  [0, 1, 2, 3, 4, 5, 6].map((mask) => ({ rockLeft: !!(mask & 4), rockAhead: !!(mask & 2), rockRight: !!(mask & 1), home })));

export const homeMove = (home: HomeSide): Move => (home === 'ahead' ? 'straight' : home);

/**
 * Правило мира, по которому проверяется тест:
 * 1) не врезаться в камень; 2) если путь к домику свободен — идти к домику;
 * 3) иначе идти прямо, если можно; 4) иначе обойти камень любой свободной стороной.
 */
export function correctMoves(s: Situation): Move[] {
  const free = MOVES.filter((move) => !isBlocked(s, move));
  const toward = homeMove(s.home);
  if (free.includes(toward)) return [toward];
  if (free.includes('straight')) return ['straight'];
  return free;
}

export type Verdict = 'ok' | 'crash' | 'detour';

export function judge(s: Situation, move: Move): Verdict {
  if (isBlocked(s, move)) return 'crash';
  return correctMoves(s).includes(move) ? 'ok' : 'detour';
}

const SIDE_WORDS: Record<Move, string> = { left: 'слева', straight: 'впереди', right: 'справа' };
const HOME_WORDS: Record<HomeSide, string> = { left: 'дом слева', ahead: 'дом прямо', right: 'дом справа' };

export function describeRocks(s: Situation) {
  const rocks = MOVES.filter((move) => isBlocked(s, move)).map((move) => SIDE_WORDS[move]);
  if (!rocks.length) return 'свободный путь';
  if (rocks.length === 1) return `препятствие ${rocks[0]}`;
  return `препятствия ${rocks.slice(0, -1).join(', ')} и ${rocks[rocks.length - 1]}`;
}

export const describeSituation = (s: Situation) => `${describeRocks(s)}, ${HOME_WORDS[s.home]}`;
