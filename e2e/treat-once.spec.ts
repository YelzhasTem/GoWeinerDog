import type { Page } from '@playwright/test';
import { expect, ONBOARDING_KEY, test } from './helpers';
import legacyFixture from '../src/experiments/fixtures/lesson-v1.json' with { type: 'json' };

const OLD_KEY = 'goweinerdog.lesson.v1';
const NEW_KEY = 'goweinerdog.lesson.v2';
const oldRaw = JSON.stringify(legacyFixture);
const completedGuide = JSON.stringify({ version: 1, status: 'completed', step: 'finish', trapHintDismissed: true });

async function trainAndCheck(page: Page) {
  await page.getByRole('button', { name: /^Начать тренировку/ }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await page.getByRole('button', { name: /^Посмотреть путь/ }).click();
  await expect(page.getByTestId('goal-result')).toHaveText('Да, дома!');
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

for (const bonus of [0, 10]) {
  test(`бонус ${bonus}: один сбор, реальные клетки при перемотке и восстановлении`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Ловушка лакомства', exact: true }).click();
    await page.locator('#treat-bonus').selectOption(String(bonus));
    await page.locator('#prediction').fill('Проверю сбор лакомства по пути домой.');
    await trainAndCheck(page);
    await expect(page.getByTestId('reward-result')).toHaveText(String(7 + bonus));
    await expect(page.getByTestId('steps-result')).toHaveText('5');
    await expect(page.getByTestId('treat-result')).toHaveText('1');
    await expect(page.getByTestId('treat-collections')).toHaveText('1');
    await expect(page.getByTestId('ground')).toHaveAttribute('data-treat-collected', 'false');
    await page.getByRole('button', { name: 'Один шаг', exact: true }).click();
    await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '1');
    await expect(page.getByTestId('ground')).toHaveAttribute('data-treat-collected', 'true');
    await expect(page.getByTestId('transition-note')).toContainText('Лакомство собрано');
    await expect(page.getByTestId('transition-note')).toContainText(`Награда: ${bonus > 1 ? '+' : ''}${bonus - 1}.`);
    await page.getByRole('button', { name: 'Сначала', exact: true }).click();
    await expect(page.getByTestId('ground')).toHaveAttribute('data-treat-collected', 'false');
    await expect(page.getByTestId('treat-state')).toContainText('Лакомство доступно');
    await page.getByRole('button', { name: 'Сразу результат', exact: true }).click();
    await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '5');
    await expect(page.getByTestId('treat-state')).toContainText('Лакомство собрано');

    const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!), NEW_KEY);
    const { model, result } = stored.current;
    expect(stored.version).toBe(2);
    expect(model.q).toHaveLength(72);
    expect(model.rulesVersion).toBe('treat-once-v2');
    expect(model.stateEncodingVersion).toBe('cell-treat-v2');
    expect(result.positions).toEqual([0, 1, 2, 3, 4, 5]);
    expect(result.states.map((state: { cell: number }) => state.cell)).toEqual(result.positions);
    expect(result.states.map((state: { treatCollected: boolean }) => state.treatCollected)).toEqual([false, true, true, true, true, true]);
    expect(result.transitions[0].toState).toBe(37);
    expect(result.transitions[0].to).toBe(1);
    expect(result.transitions.filter((step: { collectedTreat: boolean }) => step.collectedTreat)).toHaveLength(1);
    expect(result.transitions.reduce((sum: number, step: { reward: number }) => sum + step.reward, 0)).toBe(result.reward);

    await page.reload();
    await expect(page.getByTestId('reward-result')).toHaveText(String(7 + bonus));
    await expect(page.getByTestId('ground')).toHaveAttribute('data-treat-collected', 'false');
    await page.getByRole('button', { name: 'Один шаг', exact: true }).click();
    await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '1');
    await expect(page.getByTestId('ground')).toHaveAttribute('data-treat-collected', 'true');
    expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)!).current.model.q, NEW_KEY)).toEqual(model.q);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`treat-${bonus}-collected.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('архив v1 сохраняет исходные пути, Q и заметки рядом с новым занятием и знакомством', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Только архивная фикстура из настоящей старой версии. Новые опыты ниже
  // получаются обычными кнопками и реальным Worker, без подстановки модели.
  await page.addInitScript(({ key, raw, guideKey, guide }) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, raw);
      localStorage.setItem(guideKey, guide);
    }
  }, { key: OLD_KEY, raw: oldRaw, guideKey: ONBOARDING_KEY, guide: completedGuide });
  await page.goto('/');
  await expect(page.getByTestId('legacy-notice')).toContainText('Архив не пересчитан');
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');
  await expect(page.getByTestId('onboarding-welcome')).toHaveCount(0);
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  const archive = page.getByTestId('legacy-archive');
  const high = archive.locator('article').filter({ has: page.getByRole('heading', { name: 'Лакомство: бонус +5 · v1', exact: true }) });
  await expect(high).toContainText('150 очк. · 100 выполненных шагов');
  await high.getByText('Исходные записи и условия', { exact: true }).click();
  await expect(high).toContainText(legacyFixture.savedPair.first.notes.prediction);
  await expect(high).toContainText(legacyFixture.savedPair.first.notes.observation);
  await high.getByRole('button', { name: /^Путь архива/ }).click();
  await expect(page.getByTestId('reward-result')).toHaveText('150');
  await expect(page.getByTestId('treat-result')).toHaveText('50');
  await expect(page.getByTestId('goal-result')).toHaveText('До домика не дошла');
  await page.getByRole('button', { name: 'Q-лаборатория', exact: true }).click();
  await expect(page.getByTestId('saved-view')).toContainText('Архив · правила v1');
  await expect(page.locator('#treat-bonus')).toHaveValue('5');
  await expect(page.locator('#treat-bonus')).toBeDisabled();
  await expect(page.locator('#explanation')).toHaveValue(legacyFixture.savedPair.first.notes.observation);
  await expect(page.locator('#explanation')).toHaveAttribute('readonly', '');
  for (let count = 0; count < 3; count += 1) await page.getByRole('button', { name: 'Один шаг', exact: true }).click();
  await expect(page.getByTestId('ground')).toHaveAttribute('data-position', '1');
  await expect(page.getByTestId('transition-note')).toContainText('Награда: +4. Получено лакомство по архивным правилам v1.');
  await page.getByRole('button', { name: 'Сначала', exact: true }).click();
  await expect(page.getByTestId('playback-step')).toHaveText('0 / 100');
  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();
  await expect(page.locator('#treat-bonus')).toHaveValue('1');
  await expect(page.getByTestId('goal-result')).toHaveText('Не проверяли');

  // Первая миссия старого занятия тоже отображается в собственном контексте.
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await archive.locator('article').filter({ has: page.getByRole('heading', { name: 'Дорога домой · v1', exact: true }) }).getByRole('button', { name: /^Путь архива/ }).click();
  await page.getByRole('button', { name: 'Q-лаборатория', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^Дорога домой/ })).toBeVisible();
  await expect(page.locator('#treat-bonus')).toHaveCount(0);
  await expect(page.getByTestId('reward-result')).toHaveText('10');
  await expect(page.getByTestId('steps-result')).toHaveText('10');
  await expect(page.getByTestId('ground')).toHaveAttribute('aria-label', /Домик \(строка:столбец\): 6:6/);
  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();

  // Новая пара не наследует старый Q36 и не выдаёт архив за один изменённый бонус.
  await page.locator('#treat-bonus').selectOption('5');
  await page.locator('#prediction').fill('Новое правило: одно лакомство, затем домик.');
  await trainAndCheck(page);
  await expect(page.getByTestId('reward-result')).toHaveText('12');
  await page.getByRole('button', { name: 'Сохранить опыт и изменить бонус', exact: true }).click();
  await page.locator('#treat-bonus').selectOption('1');
  await trainAndCheck(page);
  await expect(page.getByTestId('experience-1-reward')).toHaveText('12');
  await expect(page.getByTestId('experience-2-reward')).toHaveText('8');
  await expect(page.getByTestId('fixed-conditions')).toContainText('Совпадают правила, формат состояния');
  await page.reload();
  await expect(page.getByTestId('experience-1-reward')).toHaveText('12');
  await page.getByRole('button', { name: 'Мои опыты', exact: true }).click();
  await expect(high).toContainText('150 очк. · 100 выполненных шагов');
  await archive.getByText('Прежние черновики и объяснения', { exact: true }).click();
  await expect(archive).toContainText(legacyFixture.savedPair.explanation);
  await expect(archive).toContainText(legacyFixture.drafts.home.prediction);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('legacy-and-current-lessons.png'), fullPage: true });
  await page.getByRole('button', { name: 'Q-лаборатория', exact: true }).click();
  await page.getByRole('button', { name: 'Начать заново', exact: true }).click();
  await page.reload();
  expect(await page.evaluate((key) => localStorage.getItem(key), OLD_KEY)).toBe(oldRaw);
  expect(await page.evaluate((key) => localStorage.getItem(key), ONBOARDING_KEY)).toBe(completedGuide);
  await expect(page.getByTestId('legacy-notice')).toBeVisible();
  expect(errors).toEqual([]);
});

test('обновление правил не откатывает незавершённое знакомство без выбора ученика', async ({ page }) => {
  const homeLesson = { ...legacyFixture, mission: 'home', current: legacyFixture.home };
  const archivedRaw = JSON.stringify(homeLesson);
  const guideRaw = JSON.stringify({ version: 1, status: 'in-progress', step: 'question', trapHintDismissed: false });
  let workers = 0;
  page.on('worker', () => { workers += 1; });
  await page.addInitScript(({ key, raw, guideKey, guide }) => {
    if (localStorage.getItem(key) === null) {
      localStorage.setItem(key, raw);
      localStorage.setItem(guideKey, guide);
    }
  }, { key: OLD_KEY, raw: archivedRaw, guideKey: ONBOARDING_KEY, guide: guideRaw });
  await page.goto('/');
  await expect(page.getByTestId('onboarding-legacy-pause')).toBeVisible();
  await expect(page.locator('[data-onboarding-step]')).toHaveAttribute('data-onboarding-step', 'question');
  expect(await page.evaluate((key) => localStorage.getItem(key), ONBOARDING_KEY)).toBe(guideRaw);
  await page.reload();
  await expect(page.getByTestId('onboarding-legacy-pause')).toBeVisible();
  await page.getByRole('button', { name: 'Посмотреть прежний опыт', exact: true }).click();
  await expect(page.getByTestId('saved-view')).toContainText('Архив · правила v1');
  await expect(page.getByTestId('reward-result')).toHaveText('10');
  await page.getByRole('button', { name: 'К текущему опыту', exact: true }).click();
  await expect(page.getByTestId('onboarding-legacy-pause')).toBeVisible();
  expect(await page.evaluate((key) => localStorage.getItem(key), ONBOARDING_KEY)).toBe(guideRaw);
  expect(workers).toBe(0);
  await page.getByRole('button', { name: 'Продолжить с новой тренировкой', exact: true }).click();
  await expect(page.locator('[data-onboarding-step]')).toHaveAttribute('data-onboarding-step', 'training');
  expect(workers).toBe(0);
  await trainAndCheck(page);
  await expect(page.locator('[data-onboarding-step]')).toHaveAttribute('data-onboarding-step', 'observation');
  expect(workers).toBe(2);
  expect(await page.evaluate((key) => localStorage.getItem(key), OLD_KEY)).toBe(archivedRaw);
});
