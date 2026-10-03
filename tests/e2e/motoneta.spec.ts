import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { editorTab, nav, ready } from './ui-helpers';

test('first launch of ruleset 2 clears old local game data and settings', async ({ page }) => {
  const url = 'http://127.0.0.1:5173/';
  await page.route(url, (route) => route.fulfill({ contentType: 'text/html', body: '<title>seed</title>' }));
  await page.goto('/');
  await page.evaluate(async () => {
    localStorage.setItem('motoneta.settings', JSON.stringify({ quality: 'low', volume: 0 }));
    localStorage.setItem('motoneta.settings.v2', JSON.stringify({ quality: 'low', volume: 0 }));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motoneta-game', 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('data');
        request.result.createObjectStore('replays');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['data', 'replays'], 'readwrite');
      tx.objectStore('data').put({ profiles: [{ name: 'Anterior' }], maps: [{ id: 'old' }] }, 'state');
      tx.objectStore('replays').put({ ruleset: 'motoneta-1' }, 'old-replay');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  });
  await page.unroute(url);
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  const fresh = await page.evaluate(async () => {
    const request = indexedDB.open('motoneta-game', 3);
    const db = await new Promise<IDBDatabase>((resolve) => (request.onsuccess = () => resolve(request.result)));
    const state = await new Promise<any>((resolve) => {
      const get = db.transaction('data').objectStore('data').get('state');
      get.onsuccess = () => resolve(get.result);
    });
    const count = await new Promise<number>((resolve) => {
      const get = db.transaction('replays').objectStore('replays').count();
      get.onsuccess = () => resolve(get.result);
    });
    db.close();
    const storagePath = '/src/storage.ts';
    const storageModule: typeof import('../../src/storage') = await import(/* @vite-ignore */ storagePath);
    const currentSettings = storageModule.settings();
    return { state, count, oldSettings: localStorage.getItem('motoneta.settings'),
      oldSettingsV2: localStorage.getItem('motoneta.settings.v2'),
      settings: currentSettings };
  });
  expect(fresh.state.profiles[0].name).toBe('Jugador 1');
  expect(fresh.state.maps).toEqual([]);
  expect(fresh.state.records).toEqual([]);
  expect(fresh.count).toBe(0);
  expect(fresh.oldSettings).toBeNull();
  expect(fresh.oldSettingsV2).toBeNull();
  expect(fresh.settings.quality).toBe('high');
});

test('MotoNeta identity, isolated saves, portable maps and backups', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('retired-game.settings', '{"volume":0.73}'));
  await ready(page);
  await expect(page).toHaveTitle('MOTONETA');
  await expect(page.locator('.brand')).toHaveText('MOTONETA');
  await expect(page.locator('.brand .sr-only')).toHaveText('MOTONETA');
  const initial = await page.evaluate(async () => ({
    keys: Object.keys(localStorage),
    databases: (await indexedDB.databases()).map((d) => ({ name: d.name, version: d.version })),
    foreign: localStorage.getItem('retired-game.settings'),
  }));
  expect(initial.keys.sort()).toEqual(['motoneta.settings.v3', 'retired-game.settings']);
  expect(initial.databases).toEqual([{ name: 'motoneta-game', version: 3 }]);
  expect(initial.foreign).toBe('{"volume":0.73}');
  await nav(page, 'editor');
  await editorTab(page, 'track');
  await page.locator('#design-name').fill('Ruta Ñandú / Río');
  await page.locator('#design-name').blur();
  const mapDownload = page.waitForEvent('download');
  await page.locator('[data-action="editor-file"]').click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const map = await mapDownload;
  expect(map.suggestedFilename()).toBe('motoneta-mapa-ruta-nandu-rio.json');
  const payload = JSON.parse(await readFile((await map.path())!, 'utf8'));
  expect(payload).toMatchObject({ game: 'motoneta', version: 2, name: 'Ruta Ñandú / Río' });
  await nav(page, 'records');
  await expect(page.getByRole('button', { name: 'Anteriores', exact: true })).toHaveCount(0);
  const backupDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar datos', exact: true }).click();
  const backup = await backupDownload;
  expect(backup.suggestedFilename()).toBe('motoneta-datos.json');
  const data = JSON.parse(await readFile((await backup.path())!, 'utf8'));
  expect(data).toMatchObject({
    game: 'motoneta',
    version: 2,
    state: { game: 'motoneta', version: 2 },
  });
  expect(data.state).not.toHaveProperty('legacy');
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'editor');
  await editorTab(page, 'track');
  await expect(page.locator('#design-name')).toHaveValue('Ruta Ñandú / Río');
});

test('current replay imports and exports; mismatched contracts leave the UI intact', async ({
  page,
}) => {
  await ready(page);
  const recording = await page.evaluate(async () => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [
      { testRace, testTrack },
      { newRecording, appendInput },
      { stepRace, isFinished, raceResult },
    ] = await Promise.all([
      source('/tests/race-fixture.ts'),
      source('/src/core/recording.ts'),
      source('/src/core/racing.ts'),
    ]);
    const race = testRace(testTrack());
    const value = newRecording(race.config);
    while (!isFinished(race, 0)) {
      appendInput(value, 1);
      stepRace(race, 1);
    }
    value.result = raceResult(race);
    return value;
  });
  await nav(page, 'records');
  for (const change of [{ game: undefined }, { version: 1 }, { ruleset: 'motoneta-1' }]) {
    await page.getByRole('button', { name: 'Abrir repetición', exact: true }).click();
    await page.locator('#import-file').setInputFiles({
      name: 'invalid.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ ...recording, ...change })),
    });
    await expect(page.locator('#toast')).toContainText('incompatible');
    await expect(page.getByRole('heading', { name: 'Tus marcas', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Abrir repetición', exact: true }).click();
  await page.locator('#import-file').setInputFiles({
    name: 'motoneta-repeticion.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(recording)),
  });
  await expect(
    page.getByRole('heading', { name: 'Repetición finalizada', exact: true }),
  ).toBeVisible({ timeout: 30000 });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar repetición', exact: true }).click();
  const replay = await download;
  expect(replay.suggestedFilename()).toBe('motoneta-repeticion.json');
  const exported = JSON.parse(await readFile((await replay.path())!, 'utf8'));
  expect(exported).toMatchObject({
    game: 'motoneta',
    version: 2,
    ruleset: 'motoneta-2',
    inputs: recording.inputs,
  });
});
