import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { ready, nav, editorTab } from './ui-helpers';
test('loop editor operations, fixed properties and generator counts', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await ready(page);
  await nav(page, 'editor');
  await page.locator('[data-action="piece"][data-value="T"]').click();
  await page.locator('[data-action="add-piece"]').click();
  await expect(page.locator('#piece-length')).toBeDisabled();
  await expect(page.locator('#piece-height')).toBeDisabled();
  await expect(page.locator('.piece-inspector').locator('..').getByRole('heading')).toHaveText('Loop · entrada 4 → salida 1 y 2');
  await page.locator('#piece-x').fill('352');
  await page.locator('#piece-x').blur();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.design.items[0].x)).toBe(352);
  await page.locator('[data-action="duplicate-piece"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(2);
  await page.locator('[data-action="undo"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(1);
  await page.locator('[data-action="redo"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(2);
  await page.locator('.placed-loop').last().click();
  await page.locator('[data-action="move-right"]').click();
  await page.locator('[data-action="remove-piece"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(1);
  await page.locator('.placed-loop').first().click();
  for (const piece of ['A', 'T']) {
    await editorTab(page, 'pieces');
    await page.locator(`[data-action="piece"][data-value="${piece}"]`).click();
    await editorTab(page, 'properties');
    await page.locator('[data-action="replace-piece"]').click();
    await expect.poll(() => page.evaluate(() => (window as any).__motoneta.design.items[0].piece)).toBe(piece);
  }
  await expect(page.locator('#editor-hint')).not.toContainText('superponerse');
  await page.locator('[data-action="camera-center"]').click();
  await page.waitForTimeout(800); // Let the normal editor camera settle before the visual review.
  await page.screenshot({ path: info.outputPath('loop-editor.png') });
  await page.locator('[data-action="save-design"]').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-action="editor-file"]').click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const exported = await download, path = await exported.path();
  const data = JSON.parse(await readFile(path!, 'utf8'));
  expect(data.version).toBe(3);
  expect(data.items[0].piece).toBe('T');
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.locator('#import-file').setInputFiles(path!);
  await expect(page.locator('.placed-loop')).toHaveCount(4);
  await page.locator('[data-action="save-design"]').click();
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'editor');
  await expect(page.locator('.placed-loop')).toHaveCount(4);
  await page.locator('[data-action="play-design-solo"]').click();
  await page.keyboard.down('ArrowDown');
  await page.keyboard.down('z');
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.race?.riders[0].motion.kind), { timeout: 20000 }).toBe('loop');
  await page.keyboard.up('ArrowDown');
  await page.keyboard.up('z');
  await page.keyboard.press('Escape');
  await page.locator('[data-action="leave-race"]').click();
  await nav(page, 'quick');
  await page.locator('[data-action="generator"]').click();
  await expect(page.locator('#gen-loops')).toHaveValue('1');
  await page.locator('#gen-difficulty').selectOption('hard');
  await expect(page.locator('#gen-loops')).toHaveValue('2');
  await page.locator('#gen-size').selectOption('short');
  await page.locator('#gen-loops').fill('3');
  await page.locator('#gen-loops').blur();
  await page.locator('[data-action="generate"]').click();
  await expect(page.locator('#toast')).toContainText('hasta 2 loops');
  await page.locator('#gen-loops').fill('2');
  await page.locator('#gen-loops').blur();
  await page.locator('[data-action="generate"]').click();
  await page.screenshot({ path: info.outputPath('loop-generator.png') });
  await page.locator('[data-action="edit-generated"]').click();
  const discard = page.getByRole('button', { name: 'Descartar cambios', exact: true });
  if (await discard.isVisible())
    await discard.click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.design.items.filter((p: any) => p.piece === 'T').length)).toBe(2);
  expect(errors).toEqual([]);
});

test('selective loop cleanup preserves maps, progression and current or unrelated race data', async ({ page }) => {
  await page.goto('/loop-prototype.html');
  const result = await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [{ GameStore }, maps, recording, racing] = await Promise.all([
      source('/src/persistence.ts'), source('/src/core/maps.ts'), source('/src/core/recording.ts'), source('/src/core/racing.ts'),
    ]);
    const store = new GameStore();
    await store.open();
    const loop = maps.validateMap({ ...maps.emptyDesign(), id: 'keep-loop-map', items: [maps.placedPiece('T', 512)] });
    const flat = maps.validateMap({ ...maps.emptyDesign(), id: 'flat-map' });
    const profile = store.state.profiles[0];
    profile.name = 'Conservar piloto';
    profile.unlockedMotoneta = true;
    const config = (track: any, version?: number) => {
      const c = { ...maps.mapCourse(track), mode: 'quick', player: profile, bots: [], difficulty: 'normal', seed: 1984 };
      if (track === loop) {
        if (version === undefined) delete c.loopGeometryVersion;
        else c.loopGeometryVersion = version;
      }
      return c;
    };
    const configs = { flat: config(flat), missing: config(loop), old: config(loop, 1), current: config(loop, 2) };
    const replay = (c: any) => {
      const value = recording.newRecording(c);
      // Seed records produced by older builds; newRecording normalizes new races.
      value.config = structuredClone(c);
      value.result.config = structuredClone(c);
      return value;
    };
    const record = (id: string, c: any) => ({ key: id, profileId: profile.id, ref: c.ref, config: c,
      ticks: 500, bestLap: 500, date: '2026-10-04', replayId: id, lapReplayId: id });
    const session = (id: string, c: any, resultConfig = c) => ({ id, mode: 'versus', players: [profile], bots: [], difficulty: 'normal',
      courses: [c], courseIndex: 0, turnIndex: 0, phase: 'ready', seed: 1984,
      results: [{ course: 0, player: profile.id, result: racing.raceResult(racing.createRace(resultConfig)), replayId: id }] });
    const state = structuredClone(store.state);
    state.maps = [loop, flat]; state.draft = structuredClone(loop);
    state.records = Object.entries(configs).map(([id, c]) => record(id, c));
    state.sessions = { tournament: session('bad-session', configs.missing), versus: session('current-session', configs.current) };
    state.motonetaSessions = { old: session('old', configs.old), flat: session('flat-session', configs.flat), current: session('current', configs.current) };
    const settings = JSON.stringify({ quality: 'low', volume: 0.15 });
    localStorage.setItem('motoneta.settings.v3', settings);
    const preserved = JSON.stringify([state.profiles, state.activeProfile, state.maps, state.draft]);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motoneta-game', 4);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['data', 'replays'], 'readwrite');
      tx.objectStore('data').put(state, 'state');
      for (const [id, c] of Object.entries(configs)) tx.objectStore('replays').put(replay(c), id);
      tx.objectStore('replays').put(replay(configs.old), 'orphan-old-loop');
      tx.objectStore('replays').put(replay(configs.flat), 'orphan-flat');
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    db.close();
    // Failure after the state write but during replay deletion must roll back both stores.
    const originalDelete = IDBCursor.prototype.delete;
    let cleanupRejected = false;
    IDBCursor.prototype.delete = function () { throw new DOMException('Cleanup failure', 'QuotaExceededError'); };
    try {
      await new GameStore().open();
    } catch {
      cleanupRejected = true;
    } finally {
      IDBCursor.prototype.delete = originalDelete;
    }
    const rawDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('motoneta-game', 4);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const rawTx = rawDb.transaction(['data', 'replays'], 'readonly');
    const [rawState, rawReplay] = await Promise.all([
      rawTx.objectStore('data').get('state'), rawTx.objectStore('replays').get('missing'),
    ].map(request => new Promise<any>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    })));
    rawDb.close();
    const atomicRollback = cleanupRejected && JSON.stringify(rawState) === JSON.stringify(state) && !!rawReplay;
    const loaded = new GameStore(); await loaded.open();
    const backup = await loaded.backup();
    const after = JSON.stringify(backup);
    await loaded.open();
    return {
      preserved: JSON.stringify([loaded.state.profiles, loaded.state.activeProfile, loaded.state.maps, loaded.state.draft]) === preserved,
      settings: localStorage.getItem('motoneta.settings.v3') === settings,
      records: loaded.state.records.map((r: any) => r.key), sessions: Object.keys(loaded.state.sessions),
      motoneta: Object.keys(loaded.state.motonetaSessions), replayIds: Object.keys(backup.replays).sort(),
      missing: await loaded.replay('missing') === undefined, old: await loaded.replay('old') === undefined,
      current: (await loaded.replay('current')).config.loopGeometryVersion,
      unchangedSecondLoad: JSON.stringify(await loaded.backup()) === after,
      atomicRollback,
    };
  });
  expect(result).toEqual({ preserved: true, settings: true, records: ['flat', 'current'], sessions: ['versus'],
    motoneta: ['flat', 'current'], replayIds: ['current', 'flat', 'orphan-flat'], missing: true, old: true,
    current: 2, unchangedSecondLoad: true, atomicRollback: true });
});
test('storage upgrade removes development data and accepts only format 3', async ({ page }) => {
  await page.goto('/loop-prototype.html');
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('motoneta-game', 3);
      request.onupgradeneeded = () => { request.result.createObjectStore('data'); request.result.createObjectStore('replays'); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction(['data', 'replays'], 'readwrite');
        tx.objectStore('data').put({ version: 2, profiles: [{ id: 'old-test' }], maps: [{ id: 'old-map' }] }, 'state');
        tx.objectStore('replays').put({ version: 2 }, 'old-replay');
        tx.oncomplete = () => { db.close(); resolve(); };
      };
    });
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { emptyDesign, validateMap }] = await Promise.all([source('/src/persistence.ts'), source('/src/core/maps.ts')]);
    const store = new GameStore();
    await store.open();
    if (store.state.version !== 3 || store.state.maps.length || store.state.profiles.some((p: any) => p.id === 'old-test') || await store.replay('old-replay'))
      throw new Error('No se reinició el guardado');
    let rejected = false;
    try {
      validateMap({ ...emptyDesign(), version: 2 });
    }
    catch {
      rejected = true;
    }
    if (!rejected)
      throw new Error('Se aceptó el formato anterior');
  });
});
