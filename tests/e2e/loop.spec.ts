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
