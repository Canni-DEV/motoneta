import { expect, test } from '@playwright/test';
import { nav } from './ui-helpers';

for(const vehicle of ['motocross','motoneta']) test(`loading blocks race entry and a failed ${vehicle} asset can be retried without reloading the page`, async ({
  page,
}) => {
  let fail = true;
  let requests = 0;
  await page.route(`**/models/${vehicle}-low.glb`, async (route) => {
    requests++;
    if (fail) await route.abort('failed');
    else await route.continue();
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await expect(page.locator('#ui')).toHaveAttribute('inert', '');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__motoneta.race)).toBeNull();
  fail = false;
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await expect(page.getByRole('button', { name: /Comenzar/ })).toBeEnabled();
  await page.getByRole('button', { name: /Comenzar/ }).click();
  await expect(page.locator('.race-identity')).toBeVisible();
  expect(requests).toBe(2);
});

test('both quality presets use the new model, with no extra asset requests on switching', async ({
  page,
}) => {
  const errors: string[] = [],
    requests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (r.url().includes('/models/')) requests.push(r.url());
  });
  await page.goto('/');
  await nav(page, 'quick');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('[data-action="settings-tab"][data-value="image"]').click();
  for (const quality of ['low', 'high', 'low']) {
    await page.locator('#quality').selectOption(quality);
    expect(await page.evaluate(() => (window as any).__motoneta.quality)).toBe(quality);
  }
  await page.getByRole('button', { name: 'Listo' }).click();
  await page.locator('#bots').selectOption('3');
  await page.getByRole('button', { name: /Comenzar/ }).click();
  await page.waitForFunction(() => (window as any).__motoneta.race?.phase === 'racing');
  expect(await page.evaluate(() => (window as any).__motoneta.race.riders.length)).toBe(4);
  expect(requests.length).toBe(7);
  expect(errors).toEqual([]);
});
