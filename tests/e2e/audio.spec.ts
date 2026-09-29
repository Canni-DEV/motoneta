import { expect, test } from '@playwright/test';
import { nav } from './ui-helpers';
test('audio review activates by gesture, loads local bank and stops every preview', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?audio-review');
  await expect(page.getByRole('heading', { name: 'Tierra. Motor. Suspensión.' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__audioReview.diagnostics().state)).toBe(
    'locked',
  );
  await page.getByRole('button', { name: 'Escuchar mezcla completa', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__audioReview.diagnostics().ready))
    .toBe(true);
  expect(await page.evaluate(() => (window as any).__audioReview.diagnostics().failed)).toEqual([]);
  await page.getByRole('button', { name: 'Detener todos los sonidos' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__audioReview.diagnostics().voices))
    .toBe(0);
  await page.getByRole('button', { name: 'Escuchar aterrizaje fuerte', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__audioReview.diagnostics().history.some((e: any) => e.id === 'land-2-0'),
      ),
    )
    .toBe(true);
  await page.screenshot({ path: test.info().outputPath('motoneta-audio.png'), fullPage: true });
  expect(errors).toEqual([]);
});
test('six independent levels persist, race and pause use bounded audio', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('motoneta.settings.v2'))
      localStorage.setItem(
        'motoneta.settings.v2',
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
test('missing optional sounds never prevent review or game initialization', async ({ page }) => {
  await page.route('**/audio/land-2-0.wav', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto('/?audio-review');
  await page.getByRole('button', { name: 'Escuchar aterrizaje fuerte', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__audioReview.diagnostics().ready))
    .toBe(true);
  expect(await page.evaluate(() => (window as any).__audioReview.diagnostics().failed)).toContain(
    'land-2-0',
  );
  await page.getByRole('button', { name: 'Escuchar aterrizaje suave', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).__audioReview.diagnostics().history.some((e: any) => e.id === 'land-0-0'),
      ),
    )
    .toBe(true);
});
