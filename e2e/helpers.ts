import { test as base, expect, type Page } from '@playwright/test';

export const ONBOARDING_KEY = 'goweinerdog.onboarding.v1';
export const SECTION_KEY = 'goweinerdog.section.v1';

// Новичок начинает со STEM-лаборатории «Обучи бота». Сценарии Q-лаборатории
// открывают её так, будто ученик уже перешёл в этот раздел.
export async function startInQLab(page: Page) {
  await page.addInitScript((key) => {
    try { if (localStorage.getItem(key) === null) localStorage.setItem(key, 'lab'); } catch { /* хранилище недоступно */ }
  }, SECTION_KEY);
}

// Эти сценарии проверяют уже знакомую лабораторию. Первый вход и само
// знакомство отдельно проходят настоящим интерфейсом в onboarding.spec.ts.
// Сохраняем только отдельную настройку знакомства, не подставляем опыт или Q.
export const test = base.extend({
  page: async ({ page }, use) => {
    await startInQLab(page);
    await page.addInitScript((key) => {
      try {
        if (localStorage.getItem(key) === null) {
          localStorage.setItem(key, JSON.stringify({
            version: 1, status: 'skipped', step: 'welcome', trapHintDismissed: true,
          }));
        }
      } catch {
        // Сценарий запрета хранилища пропускает приветствие через интерфейс.
      }
    }, ONBOARDING_KEY);
    await use(page);
  },
});
export { expect };
