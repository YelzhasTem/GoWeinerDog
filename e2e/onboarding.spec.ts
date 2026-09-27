import { expect, test, type Page } from '@playwright/test';
import { ONBOARDING_KEY } from './helpers';

const LESSON_KEY = 'goweinerdog.lesson.v1';
const card = (page: Page) => page.getByTestId('onboarding-card');
const welcome = (page: Page) => page.getByRole('button', { name: 'Начать знакомство', exact: true });

async function expectStep(page: Page, step: string) {
  await expect(page.locator('[data-onboarding-step]')).toHaveAttribute('data-onboarding-step', step);
  await expect(card(page)).toBeVisible();
}

async function expectFits(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: innerWidth, page: document.documentElement.scrollWidth,
    overflowing: Array.from(document.querySelectorAll('[data-testid="onboarding-card"], [data-testid="ground"], .onboarding-welcome'))
      .filter((element) => element.getClientRects().length)
      .map((element) => ({ left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right })),
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport);
  for (const element of dimensions.overflowing) {
    expect(element.left).toBeGreaterThanOrEqual(0);
    expect(element.right).toBeLessThanOrEqual(dimensions.viewport);
  }
}

async function reachTraining(page: Page) {
  await page.goto('/');
  await welcome(page).click();
  await expectStep(page, 'ground');
  await page.getByRole('button', { name: 'К прогнозу', exact: true }).click();
  await expectStep(page, 'prediction');
  await page.getByRole('button', { name: 'К тренировке', exact: true }).click();
  await expectStep(page, 'training');
}

async function trainAndCheck(page: Page) {
  await page.getByRole('button', { name: /^Начать тренировку/ }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await page.getByRole('button', { name: /^Посмотреть путь/ }).click();
  await expect(page.getByTestId('goal-result')).toHaveText('Да, дома!');
}

async function readLesson(page: Page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), LESSON_KEY);
}

// Браузерная сессия каждого теста пустая: здесь знакомство не обходится fixture.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

test('первый вход → реальное обучение → проверка → наблюдение → вопрос → завершение', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const workers: string[] = [];
  const errors: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByText('Привет! Поможешь мне научиться находить дорогу домой?', { exact: true })).toBeVisible();
  await expect(page.getByText(/Здесь ты исследователь/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Сразу в лабораторию', exact: true })).toBeVisible();
  await expectFits(page);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-welcome.png`), fullPage: true });

  // Клавиатурой запускаем знакомство; это не запускает Worker.
  await expect(page.locator('#welcome-title')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(welcome(page)).toBeFocused();
  const focusWidth = await welcome(page).evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth));
  expect(focusWidth).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Enter');
  await expectStep(page, 'ground');
  await expect(card(page).getByRole('heading')).toBeFocused();
  await expect(card(page)).toContainText('стрелками не нужно');
  await expect(card(page)).toContainText('20');
  await expect(page.getByTestId('ground')).toBeVisible();
  expect(workers).toEqual([]);
  await page.getByRole('button', { name: 'К прогнозу', exact: true }).click();
  await expectStep(page, 'prediction');
  await expect(page.locator('#prediction')).toHaveCount(1);
  await expect(page.locator('#prediction')).toBeFocused();
  await expect(page.locator('#prediction')).toBeInViewport();
  await expect(page.locator('#prediction')).toHaveValue('');
  await page.locator('#prediction').fill('Предполагаю, что такса найдёт проход и доберётся до домика.');
  await page.getByRole('button', { name: 'К тренировке', exact: true }).click();
  await expectStep(page, 'training');
  await expect(card(page)).toContainText('800');
  await page.getByRole('button', { name: /^Начать тренировку/ }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await expect(page.getByTestId('episode-count')).toHaveText('800 / 800');
  await expectStep(page, 'check');
  await expect(card(page).getByRole('heading')).toBeFocused();
  await expect(card(page).getByRole('heading')).toBeInViewport({ ratio: 1 });
  expect(workers).toHaveLength(1);
  await page.getByRole('button', { name: /^Посмотреть путь/ }).click();
  await expectStep(page, 'observation');
  // Новый шаг должен оказаться в поле зрения, а проигрыватель не должен
  // перетянуть прокрутку обратно к площадке после завершения проверки.
  await expect(card(page).getByRole('heading')).toBeFocused();
  await expect(card(page).getByRole('heading')).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('goal-result')).toHaveText('Да, дома!');
  await expect(page.getByTestId('steps-result')).toHaveText('10');
  await expect(page.getByTestId('reward-result')).toHaveText('10');
  await expect(card(page)).toContainText('10');
  // При reduced motion маршрут рассчитан, но сам не проигрывается.
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 10');
  await expect(page.getByRole('button', { name: 'Пауза', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Один шаг', exact: true }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('playback-step')).toHaveText('1 / 10');
  await page.getByRole('button', { name: 'Сразу результат', exact: true }).click();
  await expect(page.getByTestId('playback-step')).toHaveText('10 / 10');
  await expect(page.locator('#explanation')).toHaveCount(1);
  await expect(page.locator('#explanation')).toHaveValue('');
  await page.locator('#explanation').fill('Прогноз совпал: такса дошла домой за 10 шагов.');
  await expectFits(page);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-guided-result.png`), fullPage: true });
  await page.getByRole('button', { name: 'К короткому вопросу', exact: true }).click();
  await expectStep(page, 'question');
  await page.getByRole('button', { name: 'Готовый маршрут до домика', exact: true }).click();
  await expect(card(page)).toContainText(/оценк/i);
  await page.getByRole('button', { name: 'Оценки действий, по которым программа выбирает путь', exact: true }).click();
  await page.getByRole('button', { name: 'Дальше', exact: true }).click();
  await expectStep(page, 'finish');
  await expect(card(page)).toContainText('Первый опыт готов');
  await page.getByRole('button', { name: 'К эксперименту с лакомством', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Ловушка лакомства/, level: 1 })).toBeVisible();
  const trapHint = page.getByRole('complementary', { name: 'Теперь — твоя идея' });
  await expect(trapHint).toBeVisible();
  await expect(trapHint).toContainText('Измени только бонус');
  await expect(trapHint).not.toContainText(/\+5|\+1|бонусе 1|бонусе 5/);
  expect(workers).toHaveLength(2);
  for (const url of workers) expect(url).toMatch(/\/assets\/lab\.worker-[\w-]+\.js$/);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), ONBOARDING_KEY);
  expect(stored.status).toBe('completed');
  await expectFits(page);
  await page.reload();
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Ловушка лакомства/, level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await expect(page.getByLabel('Наблюдение первой миссии', { exact: true })).toHaveValue('Прогноз совпал: такса дошла домой за 10 шагов.');
  await page.getByRole('button', { name: 'Как это работает', exact: true }).click();
  const analysis = page.getByText('Разбор эксперимента', { exact: true });
  await expect(analysis).toBeVisible();
  await expect(analysis.locator('..')).not.toHaveAttribute('open', '');
  await expect(page.getByText(/При бонусе \+5 уйти/)).not.toBeVisible();

  // Сброс занятия очищает опыты, но не стирает отдельное завершённое знакомство.
  await page.getByRole('button', { name: 'Лаборатория', exact: true }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  expect((await readLesson(page)).home).toBeNull();
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), ONBOARDING_KEY)).toEqual(stored);
  await page.reload();
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
  await expect(card(page)).toHaveCount(0);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).status, ONBOARDING_KEY)).toBe('completed');
  expect(errors).toEqual([]);
});

test('пропуск запоминается, повторное знакомство и выход не меняют занятие', async ({ page }) => {
  test.setTimeout(60_000);
  let workers = 0;
  page.on('worker', () => { workers += 1; });
  await page.goto('/');
  await page.getByRole('button', { name: 'Сразу в лабораторию', exact: true }).click();
  await page.locator('#prediction').fill('Мой прогноз остаётся в занятии.');
  const before = await readLesson(page);
  await page.reload();
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
  await expect(page.locator('#prediction')).toHaveValue('Мой прогноз остаётся в занятии.');
  await page.getByRole('button', { name: 'Как это работает', exact: true }).click();
  await page.getByRole('button', { name: 'Пройти знакомство ещё раз', exact: true }).click();
  await welcome(page).click();
  await expectStep(page, 'ground');
  await page.getByRole('button', { name: 'Выйти из знакомства', exact: true }).click();
  await expect(card(page)).toHaveCount(0);
  await expect(page.locator('#mission-title')).toBeFocused();

  // При выходе из другого раздела удаляемая кнопка подсказки возвращает
  // фокус в активную навигацию, а не оставляет клавиатуру на body.
  for (const section of ['Как это работает', 'Мои опыты']) {
    await page.getByRole('button', { name: 'Как это работает', exact: true }).click();
    await page.getByRole('button', { name: 'Пройти знакомство ещё раз', exact: true }).click();
    await welcome(page).click();
    await expectStep(page, 'ground');
    const navigation = page.getByRole('button', { name: section, exact: true });
    await navigation.click();
    await page.getByRole('button', { name: 'Выйти из знакомства', exact: true }).click();
    await expect(navigation).toBeFocused();
    await expect(navigation).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Выйти из знакомства', exact: true })).toHaveCount(0);
  }
  expect(await readLesson(page)).toEqual(before);
  expect(workers).toBe(0);
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).status, ONBOARDING_KEY)).toBe('skipped');
});

test('перезагрузка во время настоящей тренировки возвращает незавершённый шаг', async ({ page }) => {
  await reachTraining(page); // Пустой прогноз разрешён.
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const match = document.querySelector('[data-testid="run-status"]')?.textContent?.match(/Тренировка: (\d+) из/);
      if (!match || Number(match[1]) === 0) return;
      observer.disconnect();
      location.reload();
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  });
  const reload = page.waitForEvent('load');
  await page.getByRole('button', { name: /^Начать тренировку/ }).click();
  await reload;
  await expectStep(page, 'training');
  await expect(page.getByTestId('episode-count')).toHaveText('0 / 800');
  await expect(page.getByRole('button', { name: /^Посмотреть путь/ })).toHaveCount(0);
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await trainAndCheck(page);
  await expectStep(page, 'observation');
  // И наблюдение разрешено пропустить, без выдуманного ответа ученика.
  await expect(page.locator('#explanation')).toHaveValue('');
  await page.getByRole('button', { name: 'К короткому вопросу', exact: true }).click();
  await expectStep(page, 'question');
});

test('остановленный Worker не продвигает знакомство, повторный запуск завершает реальный опыт', async ({ page }) => {
  await reachTraining(page);
  await page.evaluate(() => {
    const observer = new MutationObserver(() => {
      const match = document.querySelector('[data-testid="run-status"]')?.textContent?.match(/Тренировка: (\d+) из/);
      const stop = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Остановить тренировку');
      if (!match || Number(match[1]) === 0 || !stop) return;
      observer.disconnect(); stop.click();
    });
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  });
  let closed = false;
  page.once('worker', (worker) => worker.once('close', () => { closed = true; }));
  await page.getByRole('button', { name: /^Начать тренировку/ }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка остановлена');
  await expect.poll(() => closed).toBe(true);
  await expectStep(page, 'training');
  await expect(page.getByRole('button', { name: /^Посмотреть путь/ })).toHaveCount(0);
  await trainAndCheck(page);
  await expectStep(page, 'observation');
});

test('ошибка запуска Worker оставляет доступный повторный запуск', async ({ page }) => {
  await page.addInitScript(() => {
    let failOnce = true;
    // Только отказ создания первого Worker; успешный повтор работает настоящим модулем.
    window.Worker = new Proxy(window.Worker, {
      construct(target, args) {
        if (failOnce) { failOnce = false; throw new DOMException('Test worker failure', 'SecurityError'); }
        return Reflect.construct(target, args);
      },
    });
  });
  await reachTraining(page);
  await page.getByRole('button', { name: /^Начать тренировку/ }).click();
  await expect(page.getByTestId('run-status')).toContainText('Не удалось запустить расчёт');
  await expectStep(page, 'training');
  await trainAndCheck(page);
  await expectStep(page, 'observation');
});

test('существующий опыт и его сохранённый контекст остаются неизменными при знакомстве', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Сразу в лабораторию', exact: true }).click();
  await page.getByRole('button', { name: 'Ловушка лакомства', exact: true }).click();
  await page.locator('#treat-bonus').selectOption('1');
  await page.locator('#prediction').fill('Мой прежний прогноз о лакомстве.');
  await trainAndCheck(page);
  await page.locator('#explanation').fill('Сохранённое наблюдение о реальном пути.');
  const before = await readLesson(page);
  await page.evaluate((key) => localStorage.removeItem(key), ONBOARDING_KEY);
  await page.reload();
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
  await expect(page.getByTestId('reward-result')).toHaveText('8');
  // Старому пользователю предлагается знакомство без обязательного приветствия.
  await expect(page.getByText('Первый эксперимент с подсказками', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await page.getByRole('button', { name: 'Путь опыта 1', exact: true }).click();
  await expect(page.getByTestId('saved-view')).toBeVisible();
  let extraWorkers = 0;
  page.on('worker', () => { extraWorkers += 1; });
  await page.getByRole('button', { name: 'Как это работает', exact: true }).click();
  await page.getByRole('button', { name: 'Пройти знакомство ещё раз', exact: true }).click();
  await welcome(page).click();
  await expect(page.getByTestId('saved-view')).toBeVisible();
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
  await expect(page.locator('#treat-bonus')).toBeDisabled();
  await expect(page.locator('#prediction')).toHaveValue('Мой прежний прогноз о лакомстве.');
  expect(await readLesson(page)).toEqual(before);
  expect(extraWorkers).toBe(0);
  await page.getByRole('button', { name: 'Выйти из знакомства', exact: true }).click();
  await expect(page.getByTestId('saved-view')).toBeVisible();
});

for (const fault of ['corrupt', 'denied', 'quota'] as const) {
  test(`хранилище знакомства ${fault}: приветствие не зацикливается в текущей сессии`, async ({ page }) => {
    await page.addInitScript(({ key, scenario }) => {
      if (scenario === 'corrupt') localStorage.setItem(key, '{broken-onboarding');
      else if (scenario === 'denied') Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked for test', 'SecurityError'); } });
      else Storage.prototype.setItem = function () { throw new DOMException('Quota for test', 'QuotaExceededError'); };
    }, { key: ONBOARDING_KEY, scenario: fault });
    await page.goto('/');
    await page.getByRole('button', { name: 'Сразу в лабораторию', exact: true }).click();
    await page.getByRole('button', { name: 'Как это работает', exact: true }).click();
    await page.getByRole('button', { name: 'Лаборатория', exact: true }).click();
    await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
    await trainAndCheck(page);
    await expect(page.getByTestId('reward-result')).toHaveText('10');
    await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
  });
}
