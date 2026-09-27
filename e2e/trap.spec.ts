import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

async function openTrap(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Ловушка лакомства', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Ловушка лакомства/ })).toBeVisible();
  await expect(page.getByLabel('Бонус за лакомство', { exact: true })).toHaveValue('5');
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Домик \(строка:столбец\): 1:6\./);
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Лакомство \(строка:столбец\): 1:2\./);
}

async function trainAndCheck(page: Page, outcome: 'goal' | 'timeout') {
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await expect(page.getByTestId('episode-count')).toHaveText('800 / 800');
  await page.getByRole('button', { name: 'Посмотреть путь' }).click();
  await expect(page.getByTestId('goal-result')).toHaveText(outcome === 'goal' ? 'Да, дома!' : 'До домика не дошла');
}

async function expectNoOverflow(page: Page) {
  const sizes = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    ground: document.querySelector('[data-testid="ground"]')!.getBoundingClientRect().toJSON() as { left: number; right: number; width: number },
  }));
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.body).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.ground.left).toBeGreaterThanOrEqual(0);
  expect(sizes.ground.right).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.ground.width).toBeGreaterThan(200);
}

async function checkVisibleTrace(page: Page, expected: { reward: number; steps: number; entries: number; finalCell?: number }) {
  const details = page.locator('.trace-details');
  if (!(await details.evaluate((element) => element.hasAttribute('open')))) await details.locator('summary').click();
  const trace = page.getByTestId('trace-list').locator('li');
  await expect(trace).toHaveCount(expected.steps);
  let previous = 0;
  let reward = 0;
  let entries = 0;
  for (const row of await trace.allTextContents()) {
    const match = row.match(/#\d+: (\d+):(\d+) → (\d+):(\d+) · .*? · ([+-]?\d+) очк\./);
    expect(match).not.toBeNull();
    const from = (Number(match![1]) - 1) * 6 + Number(match![2]) - 1;
    const to = (Number(match![3]) - 1) * 6 + Number(match![4]) - 1;
    expect(from).toBe(previous);
    expect(Math.abs(from - to)).toBe(1); // Подготовленная площадка — одна открытая строка.
    expect(to).toBeGreaterThanOrEqual(0);
    expect(to).toBeLessThanOrEqual(5);
    if (to === 1 && from !== to) entries += 1;
    previous = to;
    reward += Number(match![5]);
  }
  expect(reward).toBe(expected.reward);
  expect(entries).toBe(expected.entries);
  if (expected.finalCell !== undefined) expect(previous).toBe(expected.finalCell);
  await expect(page.getByTestId('reward-result')).toHaveText(String(reward));
  await expect(page.getByTestId('steps-result')).toHaveText(String(expected.steps));
  await details.locator('summary').click();
}

test.beforeEach(async ({ page, browser }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  test.info().annotations.push({ type: 'browser', description: `Installed Google Chrome ${browser.version()}; production Vite preview; real Workers` });
  await page.exposeFunction('getTrapBrowserErrorsForTest', () => errors);
});

test.afterEach(async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const windowWithErrors = window as typeof window & { getTrapBrowserErrorsForTest(): Promise<string[]> };
    return windowWithErrors.getTrapBrowserErrorsForTest();
  });
  expect(errors).toEqual([]);
});

test('прогноз → ловушка → один новый бонус → новое обучение → сравнение → объяснение', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await page.addInitScript(() => {
    const host = window as typeof window & { lessonWritesForTest: number };
    host.lessonWritesForTest = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === 'goweinerdog.lesson.v1') host.lessonWritesForTest += 1;
      return original.call(this, key, value);
    };
  });
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTrap(page);
  await expectNoOverflow(page);
  const firstPrediction = page.getByLabel('Как лакомство повлияет на путь таксы?', { exact: true });
  await expect(firstPrediction).toHaveValue('');
  await firstPrediction.fill('Думаю, такса будет возвращаться за лакомством, если за него дают много очков.');
  await trainAndCheck(page, 'timeout');
  await expect(page.getByTestId('reward-result')).toHaveText('150');
  await expect(page.getByTestId('steps-result')).toHaveText('100');
  await expect(page.getByText('Выполнено шагов', { exact: true }).first()).toBeVisible();
  await checkVisibleTrace(page, { reward: 150, steps: 100, entries: 50 });
  await expect(page.getByTestId('storage-status')).toContainText('Занятие сохранено в этом браузере.');
  const writes = await page.evaluate(() => (window as typeof window & { lessonWritesForTest: number }).lessonWritesForTest);
  await page.getByLabel('Скорость просмотра', { exact: true }).selectOption('12');
  await page.getByRole('button', { name: 'Воспроизвести', exact: false }).click();
  await expect(page.getByTestId('playback-step')).not.toHaveText('0 / 100');
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await expect(page.getByTestId('reward-result')).toHaveText('150');
  await expect(page.getByTestId('steps-result')).toHaveText('100');
  expect(workers).toHaveLength(2);
  expect(await page.evaluate(() => (window as typeof window & { lessonWritesForTest: number }).lessonWritesForTest)).toBe(writes);
  const observation = page.getByLabel('Что делает такса? Опиши наблюдаемое поведение.', { exact: true });
  await expect(observation).toHaveValue('');
  await observation.fill('Такса ходит туда и обратно у лакомства. До домика не дошла, хотя набрала 150 очков.');
  await page.getByRole('button', { name: 'Сохранить опыт и изменить бонус', exact: true }).click();
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+5');
  await expect(page.getByTestId('experience-1-outcome')).toContainText('До домика не дошла');
  await expect(page.getByTestId('experience-1-reason')).toHaveText('Лимит шагов');
  await expect(page.getByTestId('experience-1-reward')).toHaveText('150');
  await expect(page.getByTestId('experience-1-steps')).toHaveText('100');
  await expect(page.getByTestId('experience-1-entries')).toHaveText('50');

  await page.getByLabel('Бонус за лакомство', { exact: true }).selectOption('1');
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await expect(page.getByTestId('playback-step')).toHaveText('— / —');
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Бонус 1 за каждый вход/);
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+5');
  await expect(page.getByTestId('experience-1-reward')).toHaveText('150');
  const secondPrediction = page.getByLabel('Что изменится при новом бонусе?', { exact: true });
  await expect(secondPrediction).toHaveValue('');
  await secondPrediction.fill('При бонусе 1 возвращаться менее выгодно. Ожидаю путь прямо к домику.');
  await trainAndCheck(page, 'goal');
  await checkVisibleTrace(page, { reward: 8, steps: 5, entries: 1, finalCell: 5 });
  await observation.fill('Теперь такса забрала лакомство один раз и дошла до домика за 5 шагов.');
  await page.getByText('Прогноз и наблюдение опыта 2', { exact: true }).click();
  await page.getByLabel('Наблюдение опыта 2', { exact: true }).fill('Теперь такса забрала лакомство один раз и дошла до домика за 5 шагов.');
  await expect(page.getByTestId('experience-2-bonus')).toHaveText('+1');
  await expect(page.getByTestId('experience-2-outcome')).toContainText('Да, дома!');
  await expect(page.getByTestId('experience-2-reason')).toHaveText('Домик достигнут');
  await expect(page.getByTestId('experience-2-reward')).toHaveText('8');
  await expect(page.getByTestId('experience-2-steps')).toHaveText('5');
  await expect(page.getByTestId('experience-2-entries')).toHaveText('1');
  await expect(page.getByTestId('comparison-difference')).toContainText(/5.*1/);
  await expect(page.getByTestId('fixed-conditions')).toContainText('Совпадают площадка, seed, число попыток, лимиты, параметры обучения и остальные награды.');
  const explanation = page.getByLabel('Почему поведение изменилось или осталось прежним?', { exact: true });
  await expect(explanation).toHaveValue('');
  await explanation.fill('Изменился только бонус. Раньше возвраты приносили много очков, теперь награда дома выгоднее повторного лакомства.');

  // Просмотр старого опыта берёт его собственные условия, а не текущий бонус 1.
  await page.getByRole('button', { name: 'Путь опыта 1', exact: true }).click();
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Бонус 5 за каждый вход/);
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 100');
  await expect(page.getByTestId('saved-view')).toContainText('Сохранённый путь');
  await expect(page.getByTestId('episode-count')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Начать тренировку' })).toHaveCount(0);
  await expect(page.locator('#prediction')).toHaveValue('Думаю, такса будет возвращаться за лакомством, если за него дают много очков.');
  await expect(page.locator('#prediction')).toBeDisabled();
  await expect(observation).toHaveValue('Такса ходит туда и обратно у лакомства. До домика не дошла, хотя набрала 150 очков.');
  await checkVisibleTrace(page, { reward: 150, steps: 100, entries: 50 });
  await page.getByRole('button', { name: 'Один шаг', exact: true }).click();
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '1');
  await expect(page.getByTestId('transition-note')).toContainText('Награда: +4.');
  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();
  await expect(page.locator('#prediction')).toHaveValue('При бонусе 1 возвращаться менее выгодно. Ожидаю путь прямо к домику.');
  await expect(page.getByTestId('run-status')).toHaveText('Проверка завершена: такса добралась домой.');
  await page.getByRole('button', { name: 'Путь опыта 2', exact: true }).click();
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Бонус 1 за каждый вход/);
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 5');
  await expect(page.getByTestId('experience-1-reward')).toHaveText('150');
  await expect(page.getByTestId('saved-view')).toContainText('Сохранённый путь');
  await expect(page.locator('#prediction')).toHaveValue('При бонусе 1 возвращаться менее выгодно. Ожидаю путь прямо к домику.');

  // Смена миссии отменяет текущий расчёт, но не меняет два зафиксированных опыта.
  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();
  await page.getByRole('button', { name: 'Дорога домой', exact: true }).click();
  await page.getByRole('button', { name: 'Ловушка лакомства', exact: true }).click();
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+5');
  await expect(page.getByTestId('experience-2-bonus')).toHaveText('+1');
  await expect(explanation).toHaveValue('Изменился только бонус. Раньше возвраты приносили много очков, теперь награда дома выгоднее повторного лакомства.');
  await page.getByRole('button', { name: 'Путь опыта 1', exact: true }).click();
  await expect(page.locator('#prediction')).toHaveValue('Думаю, такса будет возвращаться за лакомством, если за него дают много очков.');
  await expect(observation).toHaveValue('Такса ходит туда и обратно у лакомства. До домика не дошла, хотя набрала 150 очков.');
  await page.getByRole('button', { name: 'Путь опыта 2', exact: true }).click();
  await expect(observation).toHaveValue('Теперь такса забрала лакомство один раз и дошла до домика за 5 шагов.');
  expect(workers).toHaveLength(4); // Два обучения и две проверки; воспроизведение не учится.
  for (const url of workers) expect(url).toMatch(/\/assets\/lab\.worker-[\w-]+\.js$/);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-trap-comparison.png`), fullPage: true });

  await page.reload();
  await expect(page.getByRole('heading', { name: /Ловушка лакомства/ })).toBeVisible();
  await expect(page.getByTestId('experience-1-reward')).toHaveText('150');
  await expect(page.getByTestId('experience-2-reward')).toHaveText('8');
  await expect(explanation).toHaveValue('Изменился только бонус. Раньше возвраты приносили много очков, теперь награда дома выгоднее повторного лакомства.');
});

test('изменение бонуса отменяет настоящий Worker; новый запуск не принимает старые результаты', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTrap(page);
  await page.getByLabel('Как лакомство повлияет на путь таксы?', { exact: true }).fill('Ожидаю возвраты.');
  const firstWorkerPromise = page.waitForEvent('worker');
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  const firstWorker = await firstWorkerPromise;
  let closed = false;
  firstWorker.on('close', () => { closed = true; });
  await expect(page.getByTestId('run-status')).toContainText('Тренировка:');
  await page.getByLabel('Бонус за лакомство', { exact: true }).selectOption('1');
  await expect.poll(() => closed).toBe(true);
  await expect(page.getByTestId('episode-count')).toHaveText('0 / 800');
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await page.waitForTimeout(800); // Старый Worker успел бы прислать done, если бы не был остановлен.
  await expect(page.getByTestId('episode-count')).toHaveText('0 / 800');
  await expect(page.getByRole('button', { name: 'Посмотреть путь' })).toHaveCount(0);
  await trainAndCheck(page, 'goal');
  await expect(page.getByTestId('reward-result')).toHaveText('8');
  await expect(page.getByTestId('steps-result')).toHaveText('5');
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Бонус 1 за каждый вход/);
  await page.getByLabel('Что делает такса? Опиши наблюдаемое поведение.', { exact: true }).fill('После отмены новое обучение дошло домой.');
  await page.getByRole('button', { name: 'Сохранить опыт и изменить бонус', exact: true }).click();
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+1');
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await expect(page.getByTestId('experience-1-reward')).toHaveCount(0);
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await expect(page.getByLabel('Бонус за лакомство', { exact: true })).toHaveValue('5');
  await expect(page.locator('#prediction')).toHaveValue('');
  await expect(page.locator('#explanation')).toHaveCount(0);
});

test('смена миссии отменяет тренировку и воспроизведение, возвращает правильную площадку', async ({ page }) => {
  await openTrap(page);
  const firstWorkerPromise = page.waitForEvent('worker');
  await page.getByRole('button', { name: 'Начать тренировку' }).click();
  const firstWorker = await firstWorkerPromise;
  let closed = false;
  firstWorker.on('close', () => { closed = true; });
  await expect(page.getByTestId('run-status')).toContainText('Тренировка:');
  await page.getByRole('button', { name: 'Дорога домой', exact: true }).click();
  await expect.poll(() => closed).toBe(true);
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Домик \(строка:столбец\): 6:6\./);
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Лакомства на площадке нет/);
  await expect(page.getByLabel('Бонус за лакомство', { exact: true })).toHaveCount(0);
  await page.waitForTimeout(800);
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await expect(page.getByTestId('episode-count')).toHaveText('0 / 800');

  await page.getByRole('button', { name: 'Ловушка лакомства', exact: true }).click();
  await trainAndCheck(page, 'timeout');
  await expect(page.getByRole('button', { name: 'Пауза', exact: true })).toBeVisible();
  await expect(page.getByTestId('playback-step')).not.toHaveText('0 / 100');
  await page.getByRole('button', { name: 'Дорога домой', exact: true }).click();
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '0');
  await expect(page.getByTestId('playback-step')).toHaveText('— / —');
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Домик \(строка:столбец\): 6:6\./);
  await page.waitForTimeout(800); // Старый таймер пути также должен быть очищен.
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '0');
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await expectNoOverflow(page);
});
