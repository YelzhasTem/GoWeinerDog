import { defineConfig } from '@playwright/test';

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: externalBaseURL || 'http://127.0.0.1:4173',
    channel: 'chrome',
    locale: 'ru-RU',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-375', use: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    { name: 'mobile-320', use: { viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true } },
  ],
  webServer: externalBaseURL ? undefined : {
    command: 'npm run preview -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
