import { ALL_SITUATIONS, situationFromKey, type Situation } from './situations';

export type LevelId = 1 | 2 | 3;

export interface Level {
  id: LevelId;
  title: string;
  goal: string;
  /** Сколько примеров нужно, чтобы кнопка обучения стала доступна. */
  minExamples: number;
  /** Тестовые ситуации. Бот видит их только во время теста. */
  tests: readonly Situation[];
}

const keys = (list: string[]) => list.map(situationFromKey);

// Ситуации для обучения на первом уровне: сначала простые, затем случайные.
export const LEVEL1_TEACH = keys(['000-ahead', '010-right', '010-left', '100-ahead', '001-ahead']);
// Первый тест специально содержит ситуации, которых нет в стартовом наборе.
export const LEVEL1_TESTS = keys(['011-right', '100-left', '000-right', '010-ahead', '001-ahead', '110-left']);

// Второй уровень: сначала много одинаковых примеров, потом разнообразные.
export const LEVEL2_SIMILAR = situationFromKey('010-right');
export const LEVEL2_DIVERSE = keys(['000-ahead', '100-left', '001-right', '110-left', '011-right', '010-left', '000-left', '101-ahead', '000-right', '010-ahead', '110-ahead', '001-left']);
export const LEVEL2_TESTS = keys(['000-ahead', '100-ahead', '001-right', '011-left', '110-right', '010-left', '000-left', '101-right']);

export const LEVELS: Record<LevelId, Level> = {
  1: { id: 1, title: 'Первые примеры', goal: 'Научи бота, проверь его и исправь ошибку.', minExamples: 4, tests: LEVEL1_TESTS },
  2: { id: 2, title: 'Качество данных', goal: 'Больше данных ≠ всегда лучше. Сравни похожие и разнообразные примеры.', minExamples: 6, tests: LEVEL2_TESTS },
  // Финальный экзамен — все 21 возможная ситуация, поэтому «подогнать» под тест нельзя.
  3: { id: 3, title: 'Челлендж 80%', goal: 'Достигни 80% успешных решений на всех возможных ситуациях.', minExamples: 4, tests: ALL_SITUATIONS },
};

export const CHALLENGE_TARGET = 0.8;
