import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { editorTab, nav } from './ui-helpers';
const state = (page: Page) => page.evaluate(() => (window as any).__motoneta);
async function ready(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('motoneta.settings.v3'))
      localStorage.setItem('motoneta.settings.v3', JSON.stringify({ quality: 'low', volume: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
}
test('all nine environments, keyboard selection, persistence and frozen race conditions', async ({
  page,
}) => {
  await ready(page);
  for (const time of ['morning', 'afternoon', 'night'])
    for (const weather of ['clear', 'rain', 'snow']) {
      await page.locator(`[data-action="time-of-day"][data-value="${time}"]`).click();
      await page.locator(`[data-action="weather"][data-value="${weather}"]`).click();
      expect(await state(page)).toMatchObject({ timeOfDay: time, weather });
    }
  await page.getByRole('button', { name: 'Lluvia', exact: true }).focus();
  await page.keyboard.press('Enter');
  expect(await state(page)).toMatchObject({ screen: 'quick', weather: 'rain' });
  await page.getByRole('button', { name: 'Nieve', exact: true }).focus();
  await page.keyboard.press('Space');
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  expect(await state(page)).toMatchObject({ timeOfDay: 'night', weather: 'snow' });
  await page.locator('[data-action="start"]').click();
  await expect(page.locator('.race-time-of-day')).toHaveText('Noche · Nieve');
  await expect.poll(async () => (await state(page)).precipitation.draws).toBe(1);
  await page.keyboard.press('Escape');
  const frozen = (await state(page)).precipitation;
  await page.waitForTimeout(150);
  expect((await state(page)).precipitation).toEqual(frozen);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Restablecer', exact: true }).click();
  await page.locator('[data-action="settings-tab"][data-value="image"]').click();
  await page.locator('#quality').selectOption('low');
  await page.locator('#vfx-ambient').uncheck();
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  expect(await state(page)).toMatchObject({ timeOfDay: 'night', weather: 'snow' });
  await expect.poll(async () => (await state(page)).precipitation.draws).toBe(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reiniciar', exact: true }).click();
  await expect(page.locator('.race-time-of-day')).toHaveText('Noche · Nieve');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  expect(await state(page)).toMatchObject({ timeOfDay: 'night', weather: 'snow' });
});
test('editor and replay environments survive export; obsolete maps and replays are rejected', async ({
  page,
}, info) => {
  await ready(page);
  await nav(page, 'editor');
  await editorTab(page, 'track');
  await page.getByRole('button', { name: 'Noche', exact: true }).click();
  await page.getByRole('button', { name: 'Nieve', exact: true }).click();
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  expect((await state(page)).design.weather).toBe('clear');
  await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
  await page.locator('#design-length').fill('640');
  await page.locator('#design-length').blur();
  await page.locator('#design-laps').selectOption('1');
  await page.getByRole('button', { name: 'Probar pista', exact: true }).click();
  await page.keyboard.down('z');
  await expect(page.getByRole('heading', { name: 'Resultado', exact: true })).toBeVisible({
    timeout: 45000,
  });
  await page.keyboard.up('z');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar repetición', exact: true }).click();
  const path = info.outputPath('night.json');
  await (await download).saveAs(path);
  const recording = JSON.parse(await readFile(path, 'utf8'));
  expect(recording.config).toMatchObject({ timeOfDay: 'night', weather: 'snow' });
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await nav(page, 'records');
  await page.getByRole('button', { name: 'Abrir repetición', exact: true }).click();
  await page.locator('#import-file').setInputFiles(path);
  await expect(page.locator('.race-time-of-day')).toHaveText('Noche · Nieve');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir repetición', exact: true }).click();
  await page.locator('#import-file').setInputFiles({
    name: 'old-replay.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, inputs: [] })),
  });
  await expect(page.locator('#toast')).toContainText('incompatible');
  expect((await state(page)).screen).toBe('records');
  await nav(page, 'editor');
  const before = (await state(page)).design;
  await page.locator('[data-action="editor-file"]').click();
  await page.locator('[data-action="import-design"]').click();
  await page.locator('#import-file').setInputFiles({
    name: 'old-map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, name: 'Mapa anterior', laps: 1, items: [] })),
  });
  await expect(page.locator('#toast')).toContainText('compatible con MotoNeta');
  expect((await state(page)).design).toEqual(before);
  await page.locator('#import-file').setInputFiles({
    name: 'motoneta-mapa-invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...before, weather: 'storm' })),
  });
  await expect(page.locator('#toast')).toContainText('Clima inválido');
  expect((await state(page)).design).toEqual(before);
});

test('selectors stay separate at all widths and reduced motion suppresses precipitation', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  for (const [width, height] of [
    [1440, 900],
    [1024, 600],
    [844, 390],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    if (width < 900) await page.locator('[data-action="setup-tab"][data-value="options"]').click();
    await page.getByRole('button', { name: 'Nieve', exact: true }).click();
    expect((await state(page)).environment).toMatchObject({
      weather: 'snow',
      snow: 1,
      transition: 1,
    });
    expect((await state(page)).precipitation.draws).toBe(0);
    const boxes = await page.evaluate(() => {
      const box = (s: string) => document.querySelector(s)!.getBoundingClientRect();
      return {
        time: box('.time-field').bottom,
        weatherTop: box('.weather-field').top,
        weather: box('.weather-field').bottom,
        start: box('.start-button').top,
        width: document.documentElement.scrollWidth,
      };
    });
    expect(boxes.time).toBeLessThanOrEqual(boxes.weatherTop);
    expect(boxes.weather).toBeLessThanOrEqual(boxes.start);
    expect(boxes.width).toBe(width);
    await nav(page, 'editor');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await nav(page, 'quick');
  }
});
