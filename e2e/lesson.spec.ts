import type { Page } from '@playwright/test';
import { expect, test } from './helpers';

const STORAGE_KEY = 'goweinerdog.lesson.v1';
const firstPrediction = 'Лакомство может заставить таксу возвращаться за очками.';
const firstObservation = '150 очков и 50 входов, но домик не достигнут.';
const secondPrediction = 'С маленьким бонусом ожидаю возвращение домой.';
const secondObservation = 'При бонусе 1 такса дошла домой за 5 шагов.';
const pairExplanation = 'Мы изменили только бонус: большой поощрял возвращения, маленький — путь домой.';


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

async function openTrap(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Ловушка лакомства', exact: true }).click();
  await expect(page.locator('#treat-bonus')).toHaveValue('5');
}

async function trainAndCheck(page: Page, goal: boolean) {
  await page.getByRole('button', { name: /^Начать тренировку/ }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await page.getByRole('button', { name: /^Посмотреть путь/ }).click();
  await expect(page.getByTestId('goal-result')).toHaveText(goal ? 'Да, дома!' : 'До домика не дошла');
}

async function fillObservation(page: Page, index: number, value: string) {
  const label = `Наблюдение опыта ${index}`;
  const input = page.getByLabel(label, { exact: true });
  // Записи могут быть компактно размещены внутри раскрываемой карточки.
  const card = page.getByTestId(`experience-${index}`);
  const details = card.locator('details').filter({ has: input });
  if (await details.count() && !(await details.evaluate((element) => element.hasAttribute('open')))) {
    await details.locator('summary').click();
  }
  await input.fill(value);
}

async function completePair(page: Page) {
  await page.locator('#prediction').fill(firstPrediction);
  await trainAndCheck(page, false);
  await page.locator('#explanation').fill(firstObservation);
  await page.getByRole('button', { name: 'Сохранить опыт и изменить бонус', exact: true }).click();
  await page.locator('#treat-bonus').selectOption('1');
  await page.locator('#prediction').fill(secondPrediction);
  await trainAndCheck(page, true);
  await expect(page.getByTestId('experience-2-reward')).toHaveText('8');
  await fillObservation(page, 2, secondObservation);
  await page.getByLabel('Почему поведение изменилось или осталось прежним?', { exact: true }).fill(pairExplanation);
}

async function expectSavedPair(page: Page) {
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+5');
  await expect(page.getByTestId('experience-1-reward')).toHaveText('150');
  await expect(page.getByTestId('experience-2-bonus')).toHaveText('+1');
  await expect(page.getByTestId('experience-2-reward')).toHaveText('8');
  await expect(page.getByLabel('Почему поведение изменилось или осталось прежним?', { exact: true })).toHaveValue(pairExplanation);
}

async function expectDisplayedConditions(page: Page, expected: { home: string; homeReward: number; seed: number; gamma: string; treatBonus?: number }) {
  const blocks = page.locator('.conditions-details');
  const count = await blocks.count();
  expect(count).toBeGreaterThan(0);
  // Проверяем каждый блок: прежний дефект оставлял правильный блок у поля
  // и одновременно показывал условия активного черновика ниже страницы.
  for (let index = 0; index < count; index += 1) {
    const block = blocks.nth(index);
    if (!(await block.evaluate((element) => element.hasAttribute('open')))) await block.locator('summary').click();
    await expect(block).toContainText(`домик ${expected.home}`);
    await expect(block).toContainText(`домик +${expected.homeReward}`);
    await expect(block).toContainText(`Seed ${expected.seed}`);
    await expect(block).toContainText(`(gamma) — ${expected.gamma}`);
    if (expected.treatBonus !== undefined) {
      await expect(block).toContainText('лакомство 1:2');
      await expect(block).toContainText(`лакомство +${expected.treatBonus} за каждый вход`);
    } else {
      await expect(block).not.toContainText('лакомство 1:2');
      await expect(block).toContainText('Лакомства нет');
    }
  }
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`);
  });
  await page.exposeFunction('getLessonErrorsForTest', () => errors);
});

test.afterEach(async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const exposed = window as typeof window & { getLessonErrorsForTest(): Promise<string[]> };
    return exposed.getLessonErrorsForTest();
  });
  expect(errors).toEqual([]);
});

test('правка бонуса до ручного сохранения сохраняет первый опыт и позволяет дописать наблюдение', async ({ page }) => {
  await openTrap(page);
  await page.locator('#prediction').fill(firstPrediction);
  await trainAndCheck(page, false);
  await page.locator('#explanation').fill(firstObservation);
  // Прямое изменение бонуса раньше стирало завершённый результат.
  await page.locator('#treat-bonus').selectOption('1');
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+5');
  await expect(page.getByTestId('experience-1-reward')).toHaveText('150');
  await expect(page.getByTestId('experience-1-steps')).toHaveText('100');
  await expect(page.getByTestId('experience-1-entries')).toHaveText('50');
  const amended = `${firstObservation} Уменьшу бонус и проверю снова.`;
  await fillObservation(page, 1, amended);
  await expect(page.getByTestId('experience-1-reward')).toHaveText('150');
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+5');
  await page.getByRole('button', { name: 'Путь опыта 1', exact: true }).click();
  await expect(page.getByTestId('saved-view')).toContainText('Сохранённый путь');
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Бонус 5 за каждый вход/);
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 100');
  await expect(page.locator('#prediction')).toHaveValue(firstPrediction);
  await expect(page.locator('#explanation')).toHaveValue(amended);
  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await page.reload();
  await expect(page.getByTestId('experience-1-reward')).toHaveText('150');
  await expect(page.getByLabel('Наблюдение опыта 1', { exact: true })).toHaveValue(amended);
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
});

test('завершённая пара защищена при новой попытке и отмене; перезагрузка восстанавливает записи', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await openTrap(page);
  await completePair(page);
  await expectSavedPair(page);
  await page.locator('#treat-bonus').selectOption('4');
  await page.locator('#prediction').fill('Начинаю новую попытку с бонусом 4.');
  await expectSavedPair(page);
  let closed = false;
  page.once('worker', (worker) => worker.on('close', () => { closed = true; }));
  await arrangeStopAfterProgress(page);
  await page.getByRole('button', { name: /^Начать тренировку/ }).click();
  await expect.poll(() => closed).toBe(true);
  await expectSavedPair(page);
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await expectSavedPair(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: /Ловушка лакомства/ })).toBeVisible();
  await expect(page.locator('#prediction')).toHaveValue('Начинаю новую попытку с бонусом 4.');
  await expect(page.locator('#treat-bonus')).toHaveValue('4');
  await expectSavedPair(page);
  await expect(page.getByLabel('Наблюдение опыта 1', { exact: true })).toHaveValue(firstObservation);
  await expect(page.getByLabel('Наблюдение опыта 2', { exact: true })).toHaveValue(secondObservation);
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await page.getByRole('button', { name: 'Путь опыта 1', exact: true }).click();
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Бонус 5 за каждый вход/);
  await expect(page.getByTestId('reward-result')).toHaveText('150');
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 100');
  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();
  await page.getByRole('button', { name: 'Лаборатория', exact: true }).click();
  await expect(page.locator('#treat-bonus')).toHaveValue('4');
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  expect(overflow).toBe(false);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-saved-lesson.png`), fullPage: true });
});

test('переходы между разделами сохраняют Worker, черновик и доступное управление', async ({ page }, testInfo) => {
  await openTrap(page);
  await page.locator('#prediction').fill(firstPrediction);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  const action = page.getByRole('button', { name: /^Начать тренировку/ });
  await page.evaluate(() => scrollTo(0, 0));
  if (testInfo.project.name !== 'desktop') {
    const bottom = await action.evaluate((element) => element.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(testInfo.project.use.viewport!.height);
  }
  await action.click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка:');
  await page.getByRole('button', { name: 'Как это работает', exact: true }).click();
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await page.getByRole('button', { name: 'Лаборатория', exact: true }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await expect(page.locator('#prediction')).toHaveValue(firstPrediction);
  expect(workers).toHaveLength(1);
  await page.getByRole('button', { name: /^Посмотреть путь/ }).click();
  await expect(page.getByTestId('goal-result')).toHaveText('До домика не дошла');
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 100');
  await page.locator('#treat-bonus').selectOption('1');
  await page.locator('#prediction').fill(secondPrediction);
  await page.getByRole('button', { name: 'Как это работает', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Лаборатория', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#prediction')).toHaveValue(secondPrediction);
  await page.locator('#treat-bonus').focus();
  if (testInfo.project.name === 'desktop') {
    // Headless Chrome/macOS не передаёт клавиши родному popup select.
    // Его выбор отдельно проверяется в видимом браузере; здесь — Tab и фокус.
    testInfo.annotations.push({ type: 'manual-coverage', description: 'Desktop native select option keys require a visible browser on macOS; keyboard Tab/focus and section activation remain automated.' });
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#treat-bonus')).toBeFocused();
    await page.locator('#treat-bonus').selectOption('10');
  } else {
    await page.keyboard.press('Space');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
  }
  await expect(page.locator('#treat-bonus')).toHaveValue('10');
  const focus = await page.locator('#treat-bonus').evaluate((element) => getComputedStyle(element).outlineWidth);
  expect(parseFloat(focus)).toBeGreaterThanOrEqual(2);
  expect(workers).toHaveLength(2);
});

test('новая пара заменяет сохранённую только после явного действия ученика', async ({ page }) => {
  test.setTimeout(60_000);
  await openTrap(page);
  await completePair(page);
  await page.locator('#treat-bonus').selectOption('4');
  await page.locator('#prediction').fill('Новый первый опыт, бонус 4.');
  await trainAndCheck(page, false);
  await page.locator('#treat-bonus').selectOption('0');
  await page.locator('#prediction').fill('Новый второй опыт, без бонуса.');
  await trainAndCheck(page, true);
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+4');
  await expect(page.getByTestId('experience-2-bonus')).toHaveText('0');
  await expect(page.getByTestId('experience-2-reward')).toHaveText('7');
  await expect(page.getByRole('button', { name: 'Заменить сохранённую пару', exact: true }).first()).toBeEnabled();
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await expectSavedPair(page);
  await page.getByRole('button', { name: 'Лаборатория', exact: true }).click();
  await page.getByRole('button', { name: 'Заменить сохранённую пару', exact: true }).first().click();
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+4');
  await expect(page.getByTestId('experience-2-bonus')).toHaveText('0');
  await expect(page.getByTestId('experience-2-reward')).toHaveText('7');
  await page.reload();
  await expect(page.getByTestId('experience-1-bonus')).toHaveText('+4');
  await expect(page.getByTestId('experience-2-bonus')).toHaveText('0');
});

test('сохранённый путь +5 сохраняет единый контекст после перехода из Моих опытов в Лабораторию', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await openTrap(page);
  await completePair(page);
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await page.getByRole('button', { name: 'Путь опыта 1', exact: true }).click();
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Бонус 5 за каждый вход/);
  await page.getByRole('button', { name: 'Лаборатория', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ловушка лакомства.');
  await expect(page.getByTestId('saved-view')).toContainText('бонус +5');
  await expect(page.getByRole('button', { name: 'Ловушка лакомства', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Дорога домой', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Ловушка лакомства', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Дорога домой', exact: true })).toBeDisabled();
  await expect(page.locator('#treat-bonus')).toHaveValue('5');
  await expect(page.locator('#treat-bonus')).toBeDisabled();
  await expect(page.locator('.reward-rules')).toContainText(/Домик\s*\+12/);
  await expect(page.locator('.reward-rules')).toContainText(/Лакомство\s*\+5/);
  await expectDisplayedConditions(page, { home: '1:6', homeReward: 12, seed: 42, gamma: '0,9', treatBonus: 5 });
  await expect(page.locator('#prediction')).toHaveValue(firstPrediction);
  await expect(page.locator('#prediction')).toBeDisabled();
  await expect(page.locator('#explanation')).toHaveValue(firstObservation);
  await expect(page.locator('#explanation')).toBeEditable();
  const amendedFirst = `${firstObservation} Дописано при просмотре сохранённого пути.`;
  await page.locator('#explanation').fill(amendedFirst);
  await expect(page.getByTestId('reward-result')).toHaveText('150');
  await expect(page.getByTestId('steps-result')).toHaveText('100');
  await expect(page.getByRole('button', { name: /^Начать тренировку/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'К текущему опыту', exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-saved-bonus-context.png`), fullPage: true });

  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();
  await expect(page.getByTestId('saved-view')).toHaveCount(0);
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
  await expect(page.locator('#treat-bonus')).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Дорога домой', exact: true })).toBeEnabled();
  await expect(page.locator('#prediction')).toHaveValue(secondPrediction);
  await expect(page.locator('#explanation')).toHaveValue(secondObservation);
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Бонус 1 за каждый вход/);
  await expect(page.getByTestId('reward-result')).toHaveText('8');
  await expect(page.getByTestId('steps-result')).toHaveText('5');
  await expect(page.getByLabel('Наблюдение опыта 1', { exact: true })).toHaveValue(amendedFirst);
  await expectSavedPair(page);
  expect(workers).toHaveLength(4);
});

test('сохранённый путь домой с seed 7 не смешивается с активным черновиком ловушки', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const workers: string[] = [];
  page.on('worker', (worker) => workers.push(worker.url()));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const homePrediction = 'Ожидаю возвращение домой в первом опыте с seed 7.';
  const homeObservation = 'На этой площадке такса добралась до домика.';
  const trapDraft = 'Новый прогноз ловушки: при бонусе 1 ожидаю путь домой.';
  await page.locator('#prediction').fill(homePrediction);
  await page.getByText('Подробнее об условиях', { exact: true }).click();
  await page.locator('#seed').fill('7');
  await trainAndCheck(page, true);
  await page.locator('#explanation').fill(homeObservation);
  await page.getByRole('button', { name: 'Ловушка лакомства', exact: true }).click();
  await page.locator('#treat-bonus').selectOption('1');
  await page.locator('#prediction').fill(trapDraft);
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await page.getByRole('button', { name: 'Путь домой', exact: true }).click();
  await page.getByRole('button', { name: 'Лаборатория', exact: true }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Дорога домой.');
  await expect(page.getByTestId('saved-view')).toContainText('Дорога домой');
  await expect(page.getByRole('button', { name: 'Дорога домой', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Ловушка лакомства', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: 'Дорога домой', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Ловушка лакомства', exact: true })).toBeDisabled();
  await expect(page.locator('#treat-bonus')).toHaveCount(0);
  await expect(page.locator('.reward-rules')).toContainText(/Домик\s*\+20/);
  await expect(page.locator('.reward-rules')).not.toContainText('Лакомство');
  await expectDisplayedConditions(page, { home: '6:6', homeReward: 20, seed: 7, gamma: '0,95' });
  await expect(page.locator('#seed')).toHaveValue('7');
  await expect(page.locator('#seed')).toBeDisabled();
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Лакомства на площадке нет/);
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Домик \(строка:столбец\): 6:6\./);
  await expect(page.locator('#prediction')).toHaveValue(homePrediction);
  await expect(page.locator('#explanation')).toHaveValue(homeObservation);
  const amendedHome = `${homeObservation} Запись дополнена из сохранённого пути.`;
  await page.locator('#explanation').fill(amendedHome);
  await expect(page.getByTestId('reward-result')).toHaveText('10');
  await expect(page.getByTestId('steps-result')).toHaveText('10');
  await expect(page.getByRole('button', { name: 'К текущему опыту', exact: true })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-saved-home-context.png`), fullPage: true });

  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ловушка лакомства.');
  await expect(page.getByRole('button', { name: 'Ловушка лакомства', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Ловушка лакомства', exact: true })).toBeEnabled();
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
  await expect(page.locator('#treat-bonus')).toBeEnabled();
  await expect(page.locator('#prediction')).toHaveValue(trapDraft);
  await expect(page.locator('#prediction')).toBeEditable();
  await expect(page.locator('#seed')).toHaveCount(0);
  await expect(page.locator('.reward-rules')).toContainText(/Домик\s*\+12/);
  await expect(page.locator('.reward-rules')).toContainText(/Лакомство\s*\+1/);
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await expect(page.getByLabel('Наблюдение первой миссии', { exact: true })).toHaveValue(amendedHome);
  expect(workers).toHaveLength(2);
});

for (const fault of ['corrupt-json', 'unknown-version', 'storage-getter', 'quota'] as const) {
  test(`ошибка хранилища ${fault} показана честно и не ломает обучение`, async ({ page }) => {
    await page.addInitScript(({ key, scenario }) => {
      if (scenario === 'storage-getter') {
        Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('Storage is disabled', 'SecurityError'); } });
      } else if (scenario === 'quota') {
        localStorage.setItem('goweinerdog.onboarding.v1', JSON.stringify({ version: 1, status: 'skipped', step: 'welcome', trapHintDismissed: true }));
        Storage.prototype.setItem = function () { throw new DOMException('Storage quota exceeded', 'QuotaExceededError'); };
      } else {
        const futureLesson = {
          version: 999, mission: 'home',
          drafts: {
            home: { seedText: '42', prediction: '', observation: '' },
            trap: { bonus: 5, prediction: '', observation: '' },
          },
          current: null, home: null,
          working: { first: null, second: null, explanation: '' }, savedPair: null,
        };
        localStorage.setItem(key, scenario === 'corrupt-json' ? '{broken-json' : JSON.stringify(futureLesson));
      }
    }, { key: STORAGE_KEY, scenario: fault });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    if (fault === 'storage-getter') await page.getByRole('button', { name: 'Сразу в лабораторию', exact: true }).click();
    if (fault === 'quota') await page.locator('#prediction').fill('Запись не должна мешать работе в памяти.');
    await expect(page.getByTestId('storage-warning')).toBeVisible();
    await expect(page.getByTestId('storage-warning')).toHaveAttribute('role', 'alert');
    await page.locator('#prediction').fill('Даже без хранения можно проверить путь.');
    await trainAndCheck(page, true);
    await expect(page.getByTestId('reward-result')).toHaveText('10');
    if (fault === 'storage-getter' || fault === 'quota') {
      await expect(page.getByTestId('storage-warning')).toBeVisible();
      await expect(page.getByTestId('storage-status')).not.toContainText('Занятие сохранено в этом браузере.');
    }
  });
}
