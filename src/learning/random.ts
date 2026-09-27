export const PRNG_VERSION = 'mulberry32-v1';

/** Один источник случайности на всю тренировку. Seed 0 тоже допустим. */
export function seededRandom(seed: number): () => number {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new Error('Seed должен быть целым числом от 0 до 4294967295.');
  }
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
