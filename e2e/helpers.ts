import { test as base, expect } from '@playwright/test';

export const ONBOARDING_KEY = 'goweinerdog.onboarding.v1';

// Эти сценарии проверяют уже знакомую лабораторию. Первый вход и само
// знакомство отдельно проходят настоящим интерфейсом в onboarding.spec.ts.
// Сохраняем только отдельную настройку знакомства, не подставляем опыт или Q.
export const test = base.extend({
  page: async ({ page }, use) => {
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
