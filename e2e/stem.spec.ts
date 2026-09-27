import { expect, test, type Page } from '@playwright/test';

// Полный путь STEM-лаборатории настоящим интерфейсом: ученик сам выбирает
// решения, модель обучается в браузере, тест проходит без его участия.

type Move = 'ВЛЕВО' | 'ПРЯМО' | 'ВПРАВО';

/** Правило мира, как его понимает ученик: не в камень, к дому, иначе прямо, иначе в обход. */
function correct(key: string): Move {
  const [rocks, home] = key.split('-');
  const blocked = { left: rocks[0] === '1', straight: rocks[1] === '1', right: rocks[2] === '1' };
  const toward = home === 'ahead' ? 'straight' : home as 'left' | 'right';
  const names = { left: 'ВЛЕВО', straight: 'ПРЯМО', right: 'ВПРАВО' } as const;
  if (!blocked[toward]) return names[toward];
  if (!blocked.straight) return 'ПРЯМО';
  return blocked.left ? 'ВПРАВО' : 'ВЛЕВО';
}

async function teach(page: Page, count: number, answer: (key: string) => Move = correct) {
  const card = page.locator('.teach-card');
  for (let n = 0; n < count; n += 1) {
    const before = Number(await page.getByTestId('example-count').textContent());
    const key = await card.getByTestId('scene').getAttribute('data-situation');
    await card.getByRole('button', { name: new RegExp(answer(key!)) }).click();
    await expect(page.getByTestId('example-count')).toHaveText(String(before + 1));
  }
}

async function trainAndTest(page: Page) {
  await page.getByRole('button', { name: 'Дальше: обучение →' }).click();
  await page.getByRole('button', { name: '🚀 ОБУЧИТЬ БОТА' }).click();
  await expect(page.getByTestId('trained-summary')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Дальше: тест →' }).click();
  await expect(page.getByText('Теперь не помогай боту. Посмотрим, чему он научился.')).toBeVisible();
  // Во время теста нет кнопок выбора направления.
  await expect(page.locator('.move-buttons')).toHaveCount(0);
  await page.getByRole('button', { name: '▶ ЗАПУСТИТЬ БОТА' }).click();
  await expect(page.getByTestId('result')).toBeVisible({ timeout: 30_000 });
  return Number((await page.getByTestId('accuracy').textContent())!.replace('%', ''));
}

async function expectNoOverflow(page: Page) {
  const size = await page.evaluate(() => ({ page: document.documentElement.scrollWidth, viewport: innerWidth }));
  expect(size.page).toBeLessThanOrEqual(size.viewport);
}

test('START → INTRO → DATA → TRAIN → TEST → ERROR → IMPROVE → уровни 2 и 3 → FINAL', async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const shot = async (name: string) => { await expectNoOverflow(page); await page.screenshot({ path: info.outputPath(`${info.project.name}-${name}.png`), fullPage: true }); };
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'GO WEINER DOG' })).toBeVisible();
  await expect(page.getByText('Ты не управляешь собакой. Ты обучаешь её принимать решения.')).toBeVisible();
  await shot('01-start');
  await page.getByRole('button', { name: '▶ НАЧАТЬ ЭКСПЕРИМЕНТ' }).click();
  await expect(page.getByText(/Научишь меня\?/)).toBeVisible();
  await shot('02-intro');
  await page.getByRole('button', { name: 'ПОПРОБОВАТЬ' }).click();

  // Уровень 1: примеры → обучение → тест → ошибка → улучшение → переобучение.
  await teach(page, 4);
  await expect(page.getByTestId('added-toast')).toContainText('✓ Обучающий пример добавлен');
  await shot('03-data');
  const first = await trainAndTest(page);
  await expect(page.getByTestId('error-box')).toContainText('❌ БОТ ОШИБСЯ');
  await expect(page.getByTestId('error-box')).toContainText('Попробуй добавить больше разнообразных примеров');
  await shot('04-error');
  await page.getByRole('button', { name: '🔬 УЛУЧШИТЬ МОДЕЛЬ' }).click();
  // Своя ситуация: камень впереди и справа, дом справа — такой был в тесте.
  await page.getByRole('button', { name: 'Своя ситуация' }).click();
  await page.getByRole('button', { name: 'Камень справа' }).click();
  await page.getByRole('button', { name: 'Домик справа' }).click();
  await expect(page.locator('.teach-card').getByTestId('scene')).toHaveAttribute('data-situation', '011-right');
  await teach(page, 1);
  await page.getByRole('button', { name: 'Подготовленная ситуация' }).click();
  await teach(page, 5);
  await expect(page.getByText('Данные изменились — бот ещё не знает о них. Переобучи модель.')).toBeVisible();
  const second = await trainAndTest(page);
  expect(second).toBeGreaterThan(first);
  await expect(page.getByTestId('result-compare')).toContainText(`${first}%`);
  await shot('05-retest');

  // Уровень 2: много похожих примеров, затем разнообразные.
  await page.getByRole('button', { name: 'Уровень 2 →' }).click();
  await expect(page.getByTestId('phase-hint')).toContainText('6 похожих примеров');
  await teach(page, 6);
  const similar = await trainAndTest(page);
  await shot('06-similar');
  await page.getByRole('button', { name: '🔬 УЛУЧШИТЬ МОДЕЛЬ' }).click();
  await expect(page.getByTestId('phase-hint')).toContainText('разнообразные');
  await teach(page, 8);
  const diverse = await trainAndTest(page);
  expect(diverse).toBeGreaterThan(similar);
  await expect(page.getByTestId('lesson-box')).toContainText('важно не только количество данных, но и их разнообразие');
  await shot('07-diverse');

  // Уровень 3: ученик сам решает, что добавить, пока не достигнет 80%.
  await page.getByRole('button', { name: 'Уровень 3 →' }).click();
  await teach(page, 4);
  let score = await trainAndTest(page);
  const scores = [score];
  for (let round = 0; score < 80 && round < 6; round += 1) {
    await page.getByRole('button', { name: '🔬 УЛУЧШИТЬ МОДЕЛЬ' }).click();
    await teach(page, 3);
    score = await trainAndTest(page);
    scores.push(score);
  }
  expect(score).toBeGreaterThanOrEqual(80);
  expect(new Set(scores).size).toBeGreaterThan(1);
  await shot('08-challenge');
  await page.getByRole('button', { name: /Цель достигнута/ }).click();

  await expect(page.getByRole('heading', { name: '🧠 ТЫ ПРОШЁЛ ЭКСПЕРИМЕНТ' })).toBeVisible();
  for (const item of ['Создал обучающие данные', 'Обучил модель', 'Проверил её на новых данных', 'Нашёл ошибку', 'Изменил данные', 'Переобучил модель', 'Сравнил результаты']) {
    await expect(page.locator('.final-checklist li.done').getByText(`✓ ${item}`, { exact: true })).toBeVisible();
  }
  await shot('09-final');
  await page.getByRole('button', { name: '🔬 ИССЛЕДОВАТЬ НОВУЮ СИТУАЦИЮ' }).click();
  await expect(page.getByTestId('sandbox-verdict')).toContainText('Бот выбирает');
  await shot('10-sandbox');
});

test('обучающие данные реально меняют решения бота', async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '▶ НАЧАТЬ ЭКСПЕРИМЕНТ' }).click();
  await page.getByRole('button', { name: 'ПОПРОБОВАТЬ' }).click();
  // Ученик учит «всегда влево»: бот повторяет эту привычку.
  await teach(page, 4, () => 'ВЛЕВО');
  const wrong = await trainAndTest(page);
  await page.getByRole('button', { name: '🔬 УЛУЧШИТЬ МОДЕЛЬ' }).click();
  // Удаляем неверные примеры и даём правильные: тот же тест, другой результат.
  for (let n = 0; n < 4; n += 1) await page.locator('.dataset-remove').first().click();
  await expect(page.getByTestId('example-count')).toHaveText('0');
  await teach(page, 6);
  const fixed = await trainAndTest(page);
  expect(fixed).toBeGreaterThan(wrong);
  // Данные и результат сохраняются после перезагрузки.
  await page.reload();
  await expect(page.getByTestId('example-count')).toHaveText('6');
  await expect(page.getByTestId('accuracy')).toHaveText(`${fixed}%`);
});
