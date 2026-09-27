import { expect, test, type Page } from '@playwright/test';


async function arrangeStopAfterProgress(page: Page) {
  // Нажимаем настоящую кнопку на первом реальном прогрессе Worker. Это исключает
  // гонку 0,5-секундного расчёта с ожиданием прокрутки внутри Playwright.click().
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const progress = document.querySelector('[data-testid="run-status"]')?.textContent?.match(/Тренировка: (\d+) из/);
      const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === 'Остановить тренировку');
      if (!progress || Number(progress[1]) <= 0 || !button) return;
      observer.disconnect();
      button.click();
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  });
}

async function trainAndEvaluate(page: Page) {
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await expect(page.getByTestId('episode-count')).toHaveText('800 / 800');
  await page.getByRole('button', { name: 'Посмотреть путь' }).click();
  await expect(page.getByTestId('run-status')).toContainText('такса добралась домой');
}

async function expectNoOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    ground: document.querySelector('[data-testid="ground"]')!.getBoundingClientRect().toJSON() as { left: number; right: number; width: number },
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.ground.left).toBeGreaterThanOrEqual(0);
  expect(dimensions.ground.right).toBeLessThanOrEqual(dimensions.viewport);
  expect(dimensions.ground.width).toBeGreaterThan(200);
}

test.beforeEach(async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  // Проверяем ошибки каждой страницы, включая завершение Worker и анимации.
  test.info().annotations.push({ type: 'browser', description: `Installed Google Chrome ${browser.version()}; production Vite preview; real Workers` });
  await page.exposeFunction('getBrowserErrorsForTest', () => errors);
});

test.afterEach(async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const windowWithErrors = window as typeof window & { getBrowserErrorsForTest(): Promise<string[]> };
    return windowWithErrors.getBrowserErrorsForTest();
  });
  expect(errors).toEqual([]);
});

test('прогноз → настоящее обучение → проверка → управляемый путь → объяснение', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Дорога домой/ })).toBeVisible();
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await expect(page.getByLabel('Совпал ли путь с твоим прогнозом? Почему?')).toHaveCount(0);
  await expectNoOverflow(page);
  await page.getByLabel('Как такса найдёт дорогу домой?').fill('Думаю, такса найдёт проход вдоль ограждений и дойдёт домой.');
  await trainAndEvaluate(page);
  await page.getByRole('button', { name: 'Пауза' }).click();
  await expect(page.getByTestId('goal-result')).toHaveText('Да, дома!');
  await expect(page.getByTestId('reward-result')).toHaveText('10');
  await expect(page.getByTestId('steps-result')).toHaveText('10');
  await expect(page.getByLabel('Как такса найдёт дорогу домой?')).toBeDisabled();
  expect(workers).toHaveLength(2);
  for (const url of workers) expect(url).toMatch(/\/assets\/lab\.worker-[\w-]+\.js$/);

  await page.getByRole('button', { name: 'Сначала', exact: true }).click();
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 10');
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '0');
  await page.getByText('Посмотреть расчёт по шагам', { exact: true }).click();
  const trace = page.getByTestId('trace-list').locator('li');
  await expect(trace).toHaveCount(10);
  const rows = await trace.allTextContents();
  let previous = 0;
  let totalReward = 0;
  const positions: number[] = [];
  for (const row of rows) {
    const match = row.match(/#\d+: (\d+):(\d+) → (\d+):(\d+) · .* · ([+-]?\d+) очк\./);
    expect(match).not.toBeNull();
    const from = (Number(match![1]) - 1) * 6 + Number(match![2]) - 1;
    const to = (Number(match![3]) - 1) * 6 + Number(match![4]) - 1;
    expect(from).toBe(previous);
    expect(Math.abs(Math.floor(from / 6) - Math.floor(to / 6)) + Math.abs(from % 6 - to % 6)).toBe(1);
    previous = to;
    positions.push(to);
    totalReward += Number(match![5]);
  }
  expect(totalReward).toBe(10);
  expect(previous).toBe(35);
  await page.getByRole('button', { name: 'Один шаг', exact: true }).click();
  await expect(page.getByTestId('playback-step')).toHaveText('1 / 10');
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', String(positions[0]));
  await expect(page.getByTestId('transition-note')).toContainText('Награда: -1.');
  await page.waitForTimeout(650); // После ручного шага таймер не должен двигать таксу дальше.
  await expect(page.getByTestId('playback-step')).toHaveText('1 / 10');
  await page.getByRole('button', { name: 'Воспроизвести', exact: false }).click();
  await expect(page.getByTestId('playback-step')).not.toHaveText('1 / 10');
  await page.getByRole('button', { name: 'Пауза' }).click();
  await page.getByRole('button', { name: 'Сразу результат', exact: true }).click();
  await expect(page.getByTestId('playback-step')).toHaveText('10 / 10');
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '35');
  await expect(page.getByTestId('transition-note')).toContainText('Награда: +19.');
  await expect(page.getByRole('button', { name: 'Один шаг', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Повторить путь' })).toBeEnabled();
  await page.getByLabel('Совпал ли путь с твоим прогнозом? Почему?').fill('Такса добралась домой за 10 шагов. За шаги потеряла 10 очков и получила 20 дома.');
  await expect(page.getByLabel('Совпал ли путь с твоим прогнозом? Почему?')).toHaveValue(/10 шагов/);
  expect(workers).toHaveLength(2); // Перемотка и анимация не запускают новое обучение.
  await expectNoOverflow(page);
  await page.getByText('Посмотреть расчёт по шагам', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-result.png`), fullPage: true });
});

test('остановка завершает Worker, новый запуск работает, seed сбрасывает опыт', async ({ page }) => {
  await page.goto('/');
  const prediction = page.getByLabel('Как такса найдёт дорогу домой?');
  await prediction.fill('Мой прогноз должен сохраниться при смене seed.');
  let workerClosed = false;
  page.once('worker', (worker) => worker.on('close', () => { workerClosed = true; }));
  await arrangeStopAfterProgress(page);
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка остановлена');
  await expect.poll(() => workerClosed).toBe(true);
  await page.waitForTimeout(750); // Старый запуск уже успел бы завершиться без terminate().
  await expect(page.getByTestId('run-status')).toContainText('Тренировка остановлена');
  await expect(page.getByRole('button', { name: 'Посмотреть путь' })).toHaveCount(0);
  await expect(prediction).toBeEnabled();
  await trainAndEvaluate(page);
  await page.getByText('Подробнее об условиях', { exact: true }).click();
  await page.locator('#seed').fill('7');
  await expect(page.getByTestId('run-status')).toContainText(/Seed.*сброшен/);
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await expect(page.getByTestId('reward-result')).toHaveText('—');
  await expect(page.getByTestId('playback-step')).toHaveText('— / —');
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '0');
  await expect(page.getByTestId('episode-count')).toHaveText('0 / 800');
  await expect(page.getByLabel('Совпал ли путь с твоим прогнозом? Почему?')).toHaveCount(0);
  await expect(prediction).toHaveValue('Мой прогноз должен сохраниться при смене seed.');
  for (const value of ['', '-1', '4294967296', '3.5']) {
    await page.locator('#seed').fill(value);
    await expect(page.locator('#seed')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: 'Начать тренировку' })).toBeDisabled();
  }
  await page.locator('#seed').fill('7');
  await trainAndEvaluate(page);
  await expect(page.getByTestId('goal-result')).toHaveText('Да, дома!');
});

test('reduced motion оставляет путь на старте, клавиатура управляет тренировкой', async ({ page }, testInfo) => {
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'К лаборатории', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await page.locator('#prediction').focus();
  const start = page.getByRole('button', { name: 'Начать тренировку' });
  // Проверяем реальный Tab-порядок, не привязывая тест к соседству блоков.
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press('Tab');
    if (await start.evaluate((element) => element === document.activeElement)) break;
  }
  await expect(start).toBeFocused();
  const focus = await start.evaluate((element) => ({ width: getComputedStyle(element).outlineWidth, style: getComputedStyle(element).outlineStyle }));
  expect(parseFloat(focus.width)).toBeGreaterThanOrEqual(2);
  expect(focus.style).not.toBe('none');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await page.getByRole('button', { name: 'Посмотреть путь' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-status')).toContainText('такса добралась домой');
  await page.waitForTimeout(1_000);
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 10');
  await expect(page.getByRole('button', { name: 'Пауза' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Один шаг', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('playback-step')).toHaveText('1 / 10');
  await page.getByRole('button', { name: 'Сразу результат', exact: true }).click();
  await expect(page.getByTestId('playback-step')).toHaveText('10 / 10');
  expect(workers).toHaveLength(2);
  await page.getByRole('button', { name: 'Посмотреть путь' }).click();
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 10');
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '0');
  await expect(page.getByTestId('goal-result')).toHaveText('Да, дома!');
  expect(workers).toHaveLength(2);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-reduced-motion.png`), fullPage: true });
});
