import { expect, test } from '@playwright/test';
import { nav } from './ui-helpers';
test('settings audio activates by gesture, loads the local bank and stops previews', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__motoneta.audio.state)).toBe(
    'locked',
  );
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('[data-action="audio-preview"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.ready))
    .toBe(true);
  expect(await page.evaluate(() => (window as any).__motoneta.audio.failed)).toEqual([]);
  await page.locator('[data-action="audio-stop"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.voices))
    .toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => (window as any).__motoneta.audio.engineVoices)).toBe(0);
  expect(await page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBeNull();
  await page.locator('[data-action="audio-preview"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBe('menu');
  await page.locator('[data-action="audio-stop"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBeNull();
  await page.screenshot({ path: test.info().outputPath('motoneta-audio.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('six independent levels persist, race and pause use bounded audio', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('motoneta.settings.v3'))
      localStorage.setItem(
        'motoneta.settings.v3',
        JSON.stringify({ quality: 'low', volume: 0.2, audioLevels: { ui: 0 } }),
      );
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveCount(6);
  await expect(page.getByRole('slider', { name: 'Interfaz', exact: true })).toHaveValue('0');
  await page.getByRole('slider', { name: 'Motores', exact: true }).fill('37');
  await page.getByRole('slider', { name: 'Música', exact: true }).fill('21');
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Motores', exact: true })).toHaveValue('37');
  await expect(page.getByRole('slider', { name: 'Música', exact: true })).toHaveValue('21');
  await page.locator('[data-action="audio-preview"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.ready)).toBe(true);
  await page.locator('[data-action="audio-stop"]').click();
  await nav(page, 'quick');
  await page.locator('#bots').selectOption('5');
  await page.locator('[data-action="start"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.scene)).toBe('race');
  await page.keyboard.down('KeyZ');
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.voices))
    .toBeGreaterThan(18);
  await page.keyboard.up('KeyZ');
  await page.locator('[data-action="pause"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.scene))
    .toBe('pause');
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.voices))
    .toBeLessThan(8);
  expect(await page.evaluate(() => (window as any).__motoneta.audio.failed)).toEqual([]);
});
test('missing optional sounds never prevent game initialization or racing', async ({ page }) => {
  await page.route('**/audio/land-2-0.wav', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await page.locator('[data-action="start"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.ready))
    .toBe(true);
  expect(await page.evaluate(() => (window as any).__motoneta.audio.failed)).toContain(
    'land-2-0',
  );
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.race.phase)).toBe('racing');
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.engineVoices)).toBe(3);
});
