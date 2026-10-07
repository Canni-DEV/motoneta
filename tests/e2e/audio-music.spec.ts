import { expect, test } from '@playwright/test';
import { musicFixture, nav } from './ui-helpers';

const music = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const music = (window as any).__musicFixture;
  return { status: music.status, track: music.track, voices: music.voices };
});

test.beforeEach(async ({ page }) => {
  const supported = await page.evaluate(() => typeof AudioContext !== 'undefined');
  test.skip(
    !supported,
    'This Playwright WebKit build on Windows exposes no Web Audio APIs; playback requires a Safari-capable test host.',
  );
});

test('the three supplied music files and their loop boundaries play and stop independently', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await musicFixture(page);
  for (const scene of ['menu', 'editor', 'results']) {
    await page.evaluate((scene) => (window as any).__musicFixture.setScene(scene), scene);
    expect(await music(page)).toEqual({ status: 'playing', track: scene, voices: 1 });
    await page.evaluate((scene) => (window as any).__musicFixture.setScene(scene, true), scene);
    await expect.poll(async () => (await music(page)).voices).toBe(1);
    expect((await music(page)).track).toBe(scene);
    await page.evaluate(() => (window as any).__musicFixture.stop(true));
    expect(await music(page)).toEqual({ status: 'silent', track: null, voices: 0 });
  }
  expect(errors).toEqual([]);
});

test('the settings audition follows menu, editor, a silent-music race and results', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('motoneta.settings.v3', JSON.stringify({ quality: 'low' })));
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('[data-action="audio-preview"]').click();
  for (const stage of ['menu', 'editor', 'race', 'results']) {
    await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBe(stage);
    if (stage === 'race') {
      await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.musicVoices)).toBe(0);
      expect(await page.evaluate(() => (window as any).__motoneta.audio.engineVoices)).toBe(3);
    } else {
      await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.music)).toBe('playing');
      expect(await page.evaluate(() => (window as any).__motoneta.audio.musicTrack)).toBe(stage);
    }
  }
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBeNull();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.voices)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => (window as any).__motoneta.audio.engineVoices)).toBe(0);
});

test('stopping a music download prevents late playback and stale status', async ({ page }) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/audio/music/menu.wav*', async (route) => {
    await blocked;
    await route.continue().catch(() => {});
  });
  await musicFixture(page);
  await page.evaluate(() => { void (window as any).__musicFixture.setScene('menu'); });
  await expect.poll(async () => (await music(page)).status).toBe('loading');
  await page.evaluate(() => (window as any).__musicFixture.stop(true));
  release();
  await page.evaluate(() => (window as any).__musicFixture.setScene('editor'));
  expect(await music(page)).toEqual({ status: 'playing', track: 'editor', voices: 1 });
});

test('the game selects menu and editor music and keeps races and pause music-free', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('motoneta.settings.v3', JSON.stringify({ quality: 'low' })),
  );
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.music)).toBe('playing');
  expect(await page.evaluate(() => (window as any).__motoneta.audio.musicTrack)).toBe('menu');
  await nav(page, 'editor');
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.musicTrack)).toBe('editor');
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.music)).toBe('playing');
  await nav(page, 'quick');
  await page.locator('[data-action="start"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.scene)).toBe('race');
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.musicVoices)).toBe(0);
  await page.locator('[data-action="pause"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.scene)).toBe('pause');
  expect(await page.evaluate(() => (window as any).__motoneta.audio.musicVoices)).toBe(0);
});
