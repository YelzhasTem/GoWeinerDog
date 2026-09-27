import { expect, test } from './helpers';

// Отдельные пустые браузерные сессии: проверка не использует авторизацию Vercel.
test.use({ storageState: { cookies: [], origins: [] } });
test.skip(!process.env.PLAYWRIGHT_BASE_URL?.trim(), 'Проверка публикации запускается только с PLAYWRIGHT_BASE_URL.');

test('публичная сборка доступна анонимно: HTML, CSS, изображения и настоящий Worker', async ({ page, context, request, baseURL }, testInfo) => {
  test.setTimeout(60_000);
  const address = new URL(baseURL!);
  // В проверяемом адресе не должно быть пароля, query-токена или параметра обхода защиты.
  expect(Boolean(address.username || address.password || address.search || address.hash)).toBe(false);
  const rootURL = new URL('/', address).href;
  await expect(context.cookies()).resolves.toEqual([]);

  // API request fixture также изолирован: это обычный HTTP-запрос без auth/bypass.
  const html = await request.get(rootURL, { maxRedirects: 0 });
  expect(html.status()).toBe(200);
  expect(html.headers()['content-type']).toMatch(/text\/html/i);
  expect(await html.text()).toContain('GoWeinerDog');

  const errors: string[] = [];
  const failedResponses: string[] = [];
  const requestFailures: string[] = [];
  const workerURLs: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  page.on('requestfailed', (failed) => requestFailures.push(`${failed.resourceType()} ${new URL(failed.url()).pathname}`));
  page.on('worker', (worker) => workerURLs.push(worker.url()));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const navigation = await page.goto(rootURL);
  expect(navigation?.status()).toBe(200);
  await expect(page).toHaveTitle(/GoWeinerDog/);
  await expect(page.getByRole('heading', { name: /Дорога домой/, level: 1 })).toBeVisible();
  await expect(page.getByTestId('ground')).toBeVisible();
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(255, 247, 237)');
  await expect(page.getByRole('button', { name: 'Лаборатория', exact: true })).toHaveCSS('background-color', 'rgb(54, 92, 69)');
  await expect.poll(() => page.locator('img').evaluateAll((images) => images.length > 0
    && images.every((image) => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);

  const styleURLs = await page.locator('link[rel="stylesheet"]').evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
  expect(styleURLs.length).toBeGreaterThan(0);
  for (const url of styleURLs) {
    const stylesheet = await request.get(url, { maxRedirects: 0 });
    expect(stylesheet.status()).toBe(200);
    expect(stylesheet.headers()['content-type']).toMatch(/text\/css/i);
  }

  await page.locator('#prediction').fill('Проверю, что опубликованная версия действительно обучает таксу.');
  await page.getByRole('button', { name: /^Начать тренировку/ }).click();
  await expect(page.getByTestId('run-status')).toContainText('Тренировка завершена');
  await expect(page.getByTestId('episode-count')).toHaveText('800 / 800');
  expect(workerURLs).toHaveLength(1);
  const workerURL = new URL(workerURLs[0]);
  expect(workerURL.origin).toBe(address.origin);
  expect(workerURL.pathname).toMatch(/\/assets\/lab\.worker-[\w-]+\.js$/);
  const workerModule = await request.get(workerURL.href, { maxRedirects: 0 });
  expect(workerModule.status()).toBe(200);
  expect(workerModule.headers()['content-type']).toMatch(/(?:application|text)\/(?:java|ecma)script/i);
  expect((await workerModule.body()).byteLength).toBeGreaterThan(100);

  await page.getByRole('button', { name: /^Посмотреть путь/ }).click();
  await expect(page.getByTestId('goal-result')).toHaveText('Да, дома!');
  await expect(page.getByTestId('reward-result')).toHaveText('10');
  await expect(page.getByTestId('steps-result')).toHaveText('10');
  expect(workerURLs).toHaveLength(2);
  expect(errors).toEqual([]);
  expect(failedResponses).toEqual([]);
  expect(requestFailures).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}-public-deployment.png`), fullPage: true });
});
