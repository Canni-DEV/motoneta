import { expect, test } from '@playwright/test';
import { editorTab, nav, ready } from './ui-helpers';

test('palette drag preserves lane patterns, invalid placements do not mutate, tap and keyboard place', async ({
  page,
}) => {
  await ready(page);
  await nav(page, 'editor');
  const lane = (await page.locator('.lane[data-lane="0"]').boundingBox())!;
  const palette = page.locator('[data-action="piece"][data-value="B"]');
  const box = (await palette.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(lane.x + 150, lane.y + lane.height / 2, { steps: 8 });
  await expect(page.locator('.placement-ghost')).toBeVisible();
  await page.mouse.up();
  const original = await page.evaluate(() => (window as any).__motoneta.design);
  expect(original.items).toHaveLength(1);
  expect(original.items[0]).toMatchObject({ piece: 'B', lanes: 15 });
  await editorTab(page, 'pieces');
  await page.locator('[data-action="piece"][data-value="A"]').click();
  await page.locator('#insert-position').fill(String(original.items[0].x));
  await page.locator('#insert-position').blur();
  await page.locator('[data-action="add-piece"]').click();
  await expect(page.locator('#toast')).toContainText('superpuestas');
  expect(await page.evaluate(() => (window as any).__motoneta.design)).toEqual(original);
  await page.locator('#insert-position').fill(String(original.items[0].x + 80));
  await page.locator('#insert-position').blur();
  await page.locator('.lane-scroll').focus();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(2);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(1);
  await editorTab(page, 'track');
  await page.locator('#design-name').focus();
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(1);
});

test('Escape cancels a drag before navigation and cancels key rebinding', async ({ page }) => {
  await ready(page);
  await nav(page, 'editor');
  const box = (await page.locator('[data-action="piece"][data-value="A"]').boundingBox())!;
  const lane = (await page.locator('.lane[data-lane="0"]').boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(lane.x + 180, lane.y + 10, { steps: 8 });
  await expect(page.locator('.placement-ghost')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('.placement-ghost')).toBeHidden();
  expect(await page.evaluate(() => (window as any).__motoneta.screen)).toBe('editor');
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(0);
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('[data-action="settings-tab"][data-value="controls"]').click();
  const key = page.locator('[data-action="rebind"][data-value="A"]');
  const before = await key.textContent();
  await key.click();
  await page.keyboard.press('Escape');
  await expect(key).toHaveText(before!);
  await expect(page.locator('#modal')).toBeVisible();
});

test('draft failures remain visible, replacement can cancel/save/discard, recovered draft stays unpublished', async ({
  page,
}) => {
  await ready(page);
  await nav(page, 'editor');
  await page.locator('[data-action="add-piece"]').click();
  await expect(page.locator('#draft-status')).toContainText('sin publicar');
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'editor');
  await expect(page.locator('#draft-status')).toContainText('recuperado');
  await page.locator('[data-action="editor-file"]').click();
  await page.locator('[data-action="new-design"]').click();
  await page.locator('[data-action="cancel-replace"]').click();
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(1);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreStore = () => {
      IDBObjectStore.prototype.put = put;
    };
    IDBObjectStore.prototype.put = function () {
      throw new DOMException('Sin espacio', 'QuotaExceededError');
    };
  });
  await editorTab(page, 'track');
  await page.locator('#design-name').fill('No perder este borrador');
  await page.locator('#design-name').blur();
  await expect(page.locator('#draft-status')).toContainText('Error');
  await page.evaluate(() => (window as any).restoreStore());
  await page.locator('[data-action="editor-file"]').click();
  await page.locator('[data-action="new-design"]').click();
  await page.locator('[data-action="save-replace"]').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.design.items.length))
    .toBe(0);
  await page.locator('[data-action="editor-file"]').click();
  await page.locator('[data-action="library"]').click();
  await expect(page.locator('.track-card', { hasText: 'No perder este borrador' })).toBeVisible();
});

test('large libraries and 2500 pieces stay bounded and retain the same canvas', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await ready(page);
  await page.evaluate(async () => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { emptyDesign, placedPiece, validateMap }] = await Promise.all([
      source('/src/persistence.ts'),
      source('/src/core/maps.ts'),
    ]);
    const store = new GameStore();
    await store.open();
    const draft = emptyDesign();
    draft.length = 30000;
    draft.name = 'Pista máxima de dos mil quinientas piezas'.slice(0, 40);
    draft.items = Array.from({ length: 2500 }, (_, i) => ({
      ...placedPiece('A', 240 + i * 8),
      length: 8,
    }));
    await store.update((s: any) => {
      s.draft = validateMap(draft);
      s.maps = Array.from({ length: 60 }, (_, i) => ({
        ...emptyDesign(),
        id: `map-${i}`,
        name: `Circuito ${String(i).padStart(2, '0')} · nombre de cuarenta letras`.slice(0, 40),
      }));
    });
  });
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'editor');
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(2500);
  await page.locator('[data-action="timeline-fit"]').click();
  await page.setViewportSize({ width: 640, height: 360 });
  const metrics = await page.evaluate(() => ({
    page: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    preview: document.querySelector('#editor-viewport')!.getBoundingClientRect().height,
    footer: document.querySelector('.editor-footer')!.getBoundingClientRect().bottom,
  }));
  expect(metrics.page).toEqual([640, 360]);
  expect(metrics.preview).toBeGreaterThanOrEqual(128);
  expect(metrics.footer).toBeLessThanOrEqual(360);
  await page.screenshot({ path: info.outputPath('large-editor.png') });
  await page.locator('[data-action="editor-file"]').click();
  await page.locator('[data-action="library"]').click();
  await page.locator('#library-search').fill('Circuito 59');
  await expect(page.locator('.track-card')).toHaveCount(1);
  await expect(page.locator('#library-search')).toBeFocused();
  await page.screenshot({ path: info.outputPath('large-library.png') });
});

test('touch selection and rotation preserve a paused race', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await ready(page);
  await nav(page, 'editor');
  await page.locator('[data-action="piece"][data-value="A"]').tap();
  const lane = (await page.locator('.lane[data-lane="0"]').boundingBox())!;
  await page.touchscreen.tap(lane.x + 100, lane.y + lane.height / 2);
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(1);
  await page.locator('[data-action="play-design-solo"]').tap();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#size-gate')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__motoneta.paused)).toBe(true);
  const frame = await page.evaluate(() => (window as any).__motoneta.race.frame);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#size-gate')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Pausa', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__motoneta.race.frame)).toBe(frame);
  await context.close();
});
