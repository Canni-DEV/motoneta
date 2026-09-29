import { expect, test, type Page } from '@playwright/test';
import { editorTab, nav } from './ui-helpers';

const state = (page: Page) => page.evaluate(() => (window as any).__motoneta);
const action = (page: Page, name: string) => page.locator(`[data-action="${name}"]`).click();
async function ready(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'motoneta.settings.v2',
      JSON.stringify({
        quality: 'low',
        volume: 0,
        vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.evaluate(async () => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { emptyDesign, validateMap }] = await Promise.all([
      source('/src/persistence.ts'),
      source('/src/core/maps.ts'),
    ]);
    const store = new GameStore();
    await store.open();
    await store.update((s: any) => {
      if (!s.maps.length)
        s.maps = ['Corto A', 'Corto B', 'Corto C'].map((name) =>
          validateMap({ ...emptyDesign(), name, length: 640, laps: 1 }),
        );
    });
  });
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
}
async function drive(page: Page) {
  await page.keyboard.down('z');
  await expect(page.getByRole('heading', { name: 'Resultado', exact: true })).toBeVisible({
    timeout: 45000,
  });
  await page.keyboard.up('z');
}
test('quick race, personal records, replay, ghost, editor and responsive screens', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  await expect(page.locator('.home-modes button')).toHaveCount(5);
  await page.screenshot({ path: info.outputPath('home.png'), fullPage: true });
  await nav(page, 'quick');
  await page.locator('.track-card', { hasText: 'Corto A' }).click();
  await page.locator('#bots').selectOption('5');
  await page.locator('#difficulty').selectOption('hard');
  await page.getByRole('button', { name: 'Noche', exact: true }).click();
  await page.getByRole('button', { name: 'Lluvia', exact: true }).click();
  await action(page, 'start');
  await drive(page);
  expect((await state(page)).race.finishes).toHaveLength(6);
  expect((await state(page)).records).toHaveLength(1);
  await action(page, 'leave-race');
  await nav(page, 'records');
  await action(page, 'record-watch');
  await expect(page.getByRole('heading', { name: 'Repetición finalizada' })).toBeVisible({
    timeout: 45000,
  });
  expect((await state(page)).audio.history.map((e: any) => e.id)).not.toEqual(
    expect.arrayContaining(['record']),
  );
  expect((await state(page)).audio.history.map((e: any) => e.id)).toContain('finish');
  await action(page, 'leave-race');
  await action(page, 'record-race');
  await expect.poll(async () => (await state(page)).ghosts.length).toBe(1);
  expect((await state(page)).race.riders).toHaveLength(6);
  await page.keyboard.press('Escape');
  await action(page, 'retry');
  await expect.poll(async () => (await state(page)).ghosts.length).toBe(1);
  await page.keyboard.press('Escape');
  await action(page, 'leave-race');
  await nav(page, 'editor');
  await action(page, 'add-piece');
  await page.locator('[data-piece-lane="1"]').uncheck();
  await page.locator('[data-piece-lane="2"]').uncheck();
  await page.locator('[data-piece-lane="3"]').uncheck();
  await editorTab(page, 'track');
  await page.locator('#design-name').fill('Editor de prueba');
  await page.locator('#design-name').blur();
  await action(page, 'save-design');
  const before = (await state(page)).design;
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'editor');
  expect((await state(page)).design).toEqual(before);
  await page.screenshot({ path: info.outputPath('editor.png'), fullPage: true });
  for (const [width, height] of [
    [1440, 900],
    [1024, 600],
    [844, 390],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    for (const mode of ['quick', 'tournament', 'versus', 'records', 'editor']) {
      await nav(page, mode);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
  await nav(page, 'quick');
  await page.screenshot({ path: info.outputPath('mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('six-player versus keeps all ghosts, resumes, rotates and ends on a podium', async ({
  page,
}) => {
  test.setTimeout(240000);
  await ready(page);
  await action(page, 'profiles');
  for (let i = 0; i < 5; i++) {
    await action(page, 'add-profile');
    await expect(page.locator('[data-action="profile-select"]')).toHaveCount(i + 2);
  }
  await action(page, 'close-modal');
  await nav(page, 'versus');
  for (const id of (await state(page)).profiles.map((p: any) => p.id))
    await page.locator(`[data-player="${id}"]`).check();
  await action(page, 'setup-next');
  await page.locator('.track-card', { hasText: 'Corto A' }).click();
  await page.locator('.track-card', { hasText: 'Corto B' }).click();
  await action(page, 'setup-next');
  await action(page, 'start');
  for (let i = 0; i < 6; i++) {
    await action(page, 'begin-turn');
    await expect.poll(async () => (await state(page)).ghosts.length).toBe(i);
    // One real bike remains three engine layers even with five visible ghosts.
    await expect.poll(async () => (await state(page)).audio.engineVoices).toBe(3);
    await drive(page);
    await action(page, 'leave-race');
    if (i === 2) {
      await page.reload();
      await expect(page.locator('#model-status')).toBeHidden();
      await action(page, 'resume-session');
      expect((await state(page)).session.phase).toBe('results');
      expect((await state(page)).session.results).toHaveLength(3);
    }
    await action(page, 'advance');
    await expect(page.locator('[data-action="begin-turn"]')).toBeVisible();
    if (i === 3) {
      await page.reload();
      await expect(page.locator('#model-status')).toBeHidden();
      await action(page, 'resume-session');
      await expect(page.getByRole('heading', { name: 'Turno de Jugador 5' })).toBeVisible();
    }
  }
  await expect.poll(async () => (await state(page)).session.courseIndex).toBe(1);
  let s = (await state(page)).session;
  expect(s.courseIndex).toBe(1);
  expect(s.turnIndex).toBe(0);
  await expect(page.getByRole('heading', { name: 'Turno de Jugador 2' })).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await action(page, 'begin-turn');
    await expect.poll(async () => (await state(page)).ghosts.length).toBe(i);
    await drive(page);
    await action(page, 'leave-race');
    await action(page, 'advance');
  }
  await expect(page.getByRole('heading', { name: 'Podio', exact: true })).toBeVisible();
  s = (await state(page)).session;
  expect(s.phase).toBe('complete');
  expect(s.results).toHaveLength(12);
});

test('tournament requires three maps, runs bots and preserves interrupted turns', async ({
  page,
}) => {
  await ready(page);
  await nav(page, 'tournament');
  await page.locator('#bots').selectOption('5');
  await action(page, 'setup-next');
  await expect(page.locator('[data-action="setup-next"]')).toBeDisabled();
  for (const name of ['Corto A', 'Corto B', 'Corto C'])
    await page.locator('.track-card', { hasText: name }).click();
  await action(page, 'setup-next');
  await action(page, 'start');
  await action(page, 'begin-turn');
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await action(page, 'resume-session');
  expect((await state(page)).session.results).toHaveLength(0);
  for (let i = 0; i < 3; i++) {
    await action(page, 'begin-turn');
    await drive(page);
    await action(page, 'leave-race');
    expect((await state(page)).session.results).toHaveLength(i + 1);
    await action(page, 'advance');
  }
  await expect(page.getByRole('heading', { name: 'Podio', exact: true })).toBeVisible();
  expect((await state(page)).session.phase).toBe('complete');
  await expect(page.locator('.podium-place')).toHaveCount(3);
});

test('generator controls, editing revisions and saved library work in all modes', async ({
  page,
}) => {
  await ready(page);
  await nav(page, 'quick');
  await action(page, 'generator');
  await page.locator('#gen-seed').fill('my-seed');
  await page.locator('#gen-size').selectOption('short');
  await page.locator('#gen-difficulty').selectOption('hard');
  await page.locator('[data-generator="ramps"]').fill('80');
  await action(page, 'generate');
  await action(page, 'save-generated');
  await expect(page.locator('#toast')).toContainText('Mapa guardado');
  await action(page, 'edit-generated');
  await editorTab(page, 'track');
  const first = (await state(page)).design;
  await page.locator('#design-name').fill('Nuevo nombre');
  await page.locator('#design-name').blur();
  await action(page, 'save-design');
  expect((await state(page)).design.revision).toBe(first.revision);
  await action(page, 'clear-design');
  await action(page, 'save-design');
  expect((await state(page)).design.revision).not.toBe(first.revision);
  for (const mode of ['quick', 'tournament', 'versus']) {
    await nav(page, mode);
    if (mode === 'versus') {
      await page.getByRole('button', { name: 'Perfiles', exact: true }).click();
      await action(page, 'add-profile');
      await action(page, 'close-modal');
      const last = (await state(page)).profiles.at(-1);
      await page.locator(`[data-player="${last.id}"]`).check();
    }
    if (mode !== 'quick') await action(page, 'setup-next');
    await expect(page.locator('.track-card', { hasText: 'Nuevo nombre' })).toBeVisible();
  }
});

test('editor supports dragging, parallel lanes, overlap rejection and history', async ({
  page,
}) => {
  await ready(page);
  await nav(page, 'editor');
  await action(page, 'add-piece');
  for (const lane of [1, 2, 3]) await page.locator(`[data-piece-lane="${lane}"]`).uncheck();
  const original = (await state(page)).design.items[0];
  await action(page, 'duplicate-piece');
  await page.locator('[data-piece-lane="1"]').check();
  await page.locator('[data-piece-lane="0"]').uncheck();
  const position = page.locator('[data-piece-field="x"]');
  await position.fill(String(original.x));
  await position.blur();
  const parallel = (await state(page)).design;
  expect(parallel.items.map((p: any) => p.x)).toEqual([original.x, original.x]);
  await page.locator('[data-piece-lane="0"]').click();
  await expect(page.locator('#toast')).toContainText('superpuestas');
  await expect(page.locator('[data-piece-lane="0"]')).not.toBeChecked();
  expect((await state(page)).design).toEqual(parallel);
  const piece = page.locator('.lane[data-lane="1"] .placed');
  await piece.scrollIntoViewIfNeeded();
  const rect = (await piece.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  const laneHeight = (await page.locator('.lane[data-lane="1"]').boundingBox())!.height;
  await page.mouse.move(rect.x + rect.width / 2 + 60, rect.y + rect.height / 2 + laneHeight, {
    steps: 5,
  });
  await page.mouse.up();
  const moved = (await state(page)).design.items.find((p: any) => p.id !== original.id);
  expect(moved.x).toBeGreaterThan(original.x);
  expect(moved.lanes).toBe(4);
  await action(page, 'undo');
  expect((await state(page)).design).toEqual(parallel);
  await action(page, 'redo');
  expect((await state(page)).design.items.find((p: any) => p.id === moved.id)).toEqual(moved);
});

test('two-player versus records abandonments, shares no DNF points and has two podium places', async ({
  page,
}) => {
  await ready(page);
  await action(page, 'profiles');
  await action(page, 'add-profile');
  await expect(page.locator('[data-action="profile-select"]')).toHaveCount(2);
  await action(page, 'close-modal');
  await nav(page, 'versus');
  await action(page, 'setup-next');
  await page.locator('.track-card', { hasText: 'Corto A' }).click();
  await action(page, 'setup-next');
  await action(page, 'start');
  await action(page, 'begin-turn');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-action="retry"]')).toHaveCount(0);
  await action(page, 'leave-race');
  await action(page, 'confirm-abandon');
  await expect(page.getByRole('heading', { name: 'Resultado', exact: true })).toBeVisible();
  await expect(page.locator('.result-time')).toHaveText('No terminó');
  await action(page, 'leave-race');
  await action(page, 'advance');
  await action(page, 'begin-turn');
  await expect.poll(async () => (await state(page)).ghosts.length).toBe(1);
  await drive(page);
  await action(page, 'leave-race');
  await action(page, 'advance');
  await expect(page.locator('.podium-place')).toHaveCount(2);
  await expect(page.locator('.rank-1')).toContainText('Jugador 2');
  await expect(page.locator('.rank-2')).toContainText('0 puntos');
  expect((await state(page)).session.results).toHaveLength(2);
});

test('failed saving offers export and retry without announcing a saved record', async ({
  page,
}) => {
  await ready(page);
  await nav(page, 'quick');
  await page.locator('.track-card', { hasText: 'Corto A' }).click();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreStorage = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === 'replays') throw new DOMException('Sin espacio', 'QuotaExceededError');
      return put.apply(this, args as any);
    };
  });
  await action(page, 'start');
  await drive(page);
  await expect(page.getByRole('alert')).toContainText('No se pudo guardar');
  expect((await state(page)).records).toHaveLength(0);
  await expect(page.locator('[data-action="leave-unsaved"]')).toBeVisible();
  const download = page.waitForEvent('download');
  await action(page, 'export-replay');
  expect((await download).suggestedFilename()).toBe('motoneta-repeticion.json');
  await page.evaluate(() => (window as any).restoreStorage());
  await action(page, 'retry-save');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect((await state(page)).records).toHaveLength(1);
  await action(page, 'leave-race');
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  expect((await state(page)).records).toHaveLength(1);
});
