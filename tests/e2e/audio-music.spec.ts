import { expect, test } from '@playwright/test';
import { nav } from './ui-helpers';

const review = (page: import('@playwright/test').Page) =>
  page.evaluate(() => (window as any).__audioReview.diagnostics());

test.beforeEach(async ({ page }) => {
  const supported = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(
    !supported,
    'This Playwright WebKit build on Windows exposes no Web Audio APIs; playback requires a Safari-capable test host.',
  );
});

test('the three supplied music files and their loop previews play and stop independently', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?audio-review');
  for (const [scene, label] of [
    ['menu', 'menú'],
    ['editor', 'editor'],
    ['results', 'resultados'],
  ]) {
    await page.getByRole('button', { name: `Escuchar música de ${label}`, exact: true }).click();
    await expect.poll(async () => (await review(page)).music).toBe('playing');
    expect((await review(page)).musicTrack).toBe(scene);
    await expect.poll(async () => (await review(page)).musicVoices).toBe(1);
    await page.getByRole('button', { name: `Escuchar unión de ${label}`, exact: true }).click();
    await expect(page.getByRole('status')).toContainText('unión de bucle');
    await page.getByRole('button', { name: 'Detener todos los sonidos' }).click();
    await expect.poll(async () => (await review(page)).musicVoices).toBe(0);
  }
  await page.getByRole('button', { name: 'Escuchar motor', exact: true }).click();
  await expect.poll(async () => (await review(page)).engineVoices).toBe(3);
  expect((await review(page)).musicVoices).toBe(0);
  await page.getByRole('button', { name: 'Detener todos los sonidos' }).click();
  await page.locator('.audio-review').evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.screenshot({ path: test.info().outputPath('motoneta-music.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('the full audition follows menu, editor, a silent-music race and results', async ({
  page,
}) => {
  await page.goto('/?audio-review');
  await page.getByRole('button', { name: 'Escuchar mezcla completa', exact: true }).click();
  for (const stage of ['menu', 'editor', 'race', 'results']) {
    await expect.poll(async () => (await review(page)).previewStage).toBe(stage);
    if (stage === 'race') {
      expect((await review(page)).musicVoices).toBe(0);
      expect((await review(page)).engineVoices).toBe(3);
    } else {
      await expect.poll(async () => (await review(page)).music).toBe('playing');
      expect((await review(page)).musicTrack).toBe(stage);
    }
  }
  await expect(page.getByRole('status')).toHaveText('Prueba completa terminada.');
  await expect.poll(async () => (await review(page)).musicVoices).toBe(0);
  expect((await review(page)).voices).toBe(0);
});

test('stopping a music download prevents late playback and stale status', async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/audio/music/menu.wav*', async (route) => {
    await blocked;
    await route.continue().catch(() => {});
  });
  await page.goto('/?audio-review');
  await page.getByRole('button', { name: 'Escuchar música de menú', exact: true }).click();
  await expect.poll(async () => (await review(page)).music).toBe('loading');
  await page.getByRole('button', { name: 'Detener todos los sonidos' }).click();
  release();
  await page.getByRole('button', { name: 'Escuchar música de editor', exact: true }).click();
  await expect.poll(async () => (await review(page)).music).toBe('playing');
  expect((await review(page)).musicTrack).toBe('editor');
  expect((await review(page)).musicVoices).toBe(1);
  await expect(page.getByRole('status')).toContainText('Música de editor');
});

test('the game selects menu and editor music and keeps races and pause music-free', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('motoneta.settings.v2', JSON.stringify({ quality: 'low' })),
  );
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.music))
    .toBe('playing');
  expect(await page.evaluate(() => (window as any).__motoneta.audio.musicTrack)).toBe('menu');
  await nav(page, 'editor');
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.musicTrack))
    .toBe('editor');
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.music))
    .toBe('playing');
  await nav(page, 'quick');
  await page.locator('[data-action="start"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.scene)).toBe('race');
  expect(await page.evaluate(() => (window as any).__motoneta.audio.musicVoices)).toBe(0);
  await page.locator('[data-action="pause"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.audio.scene))
    .toBe('pause');
  expect(await page.evaluate(() => (window as any).__motoneta.audio.musicVoices)).toBe(0);
});
