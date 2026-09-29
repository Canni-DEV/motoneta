import { expect, test, type Page } from '@playwright/test';
import { editorTab, nav, ready } from './ui-helpers';

async function inWindow(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox();
  expect(box, selector).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x, selector).toBeGreaterThanOrEqual(-1);
  expect(box!.y, selector).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, selector).toBeLessThanOrEqual(viewport.width + 1);
  expect(box!.y + box!.height, selector).toBeLessThanOrEqual(viewport.height + 1);
}
test('all screens fit the window and editor owns an unobstructed canvas', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ready(page);
  for (const [width, height] of [
    [1920, 1080],
    [1440, 900],
    [1280, 720],
    [1024, 600],
    [844, 390],
    [740, 360],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    for (const screen of ['home', 'quick', 'tournament', 'versus', 'records', 'editor']) {
      await nav(page, screen);
      const size = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth,
        h: document.documentElement.scrollHeight,
      }));
      expect(size).toEqual({ w: width, h: height });
      if (screen === 'editor') {
        await inWindow(page, '.editor-footer');
        await inWindow(page, '.editor-timeline');
        await inWindow(page, '#editor-viewport');
        const rects = await page.evaluate(() => {
          const box = (selector: string) => {
            const r = document.querySelector(selector)!.getBoundingClientRect();
            return {
              x: r.x,
              y: r.y,
              right: r.right,
              bottom: r.bottom,
              width: r.width,
              height: r.height,
            };
          };
          return {
            viewport: box('#editor-viewport'),
            canvas: box('#world'),
            panel: box('.editor-sidebar'),
            lanes: box('.editor-timeline'),
          };
        });
        expect(rects.canvas).toEqual(rects.viewport);
        expect(rects.viewport.height).toBeGreaterThanOrEqual(127);
        expect(rects.viewport.right).toBeLessThanOrEqual(rects.panel.x);
        expect(rects.viewport.bottom).toBeLessThanOrEqual(rects.lanes.y);
      } else if (screen !== 'home') await inWindow(page, '.screen-footer');
      if (width === 1440 || width === 640)
        await page.screenshot({ path: info.outputPath(`${screen}-${width}.png`) });
    }
  }
  expect(errors).toEqual([]);
});

test('editor keeps focus, history and camera through edits, panels and practice', async ({
  page,
}, info) => {
  await ready(page);
  await nav(page, 'editor');
  const canvas = await page.locator('#world').evaluate((el) => {
    (window as any).firstCanvas = el;
    return true;
  });
  expect(canvas).toBe(true);
  await page.locator('[data-action="add-piece"]').click();
  await expect(page.locator('[data-piece-field="x"]')).toHaveValue('320');
  await page.locator('[data-action="camera-in"]').click();
  const target = await page.evaluate(() => (window as any).__motoneta.camera.target);
  const position = page.locator('[data-piece-field="x"]');
  await position.fill('400');
  await position.blur();
  await expect(position).toHaveValue('400');
  expect(await page.evaluate(() => (window as any).__motoneta.camera.target)).toBe(target);
  await page.locator('[data-action="undo"]').click();
  expect(await page.evaluate(() => (window as any).__motoneta.design.items[0].x)).toBe(320);
  await page.locator('[data-action="redo"]').click();
  await editorTab(page, 'track');
  await page.locator('#design-name').fill('La próxima vuelta');
  await page.locator('#design-name').blur();
  await page.locator('[data-action="save-design"]').click();
  await expect(page.locator('#draft-status')).toHaveText('Guardado');
  await page.locator('[data-action="play-design-solo"]').click();
  await page.keyboard.press('Escape');
  await page.locator('[data-action="leave-race"]').click();
  await expect(page.locator('#design-name')).toHaveValue('La próxima vuelta');
  expect(await page.evaluate(() => (window as any).__motoneta.camera.target)).toBe(target);
  expect(
    await page.evaluate(() => document.querySelector('#world') === (window as any).firstCanvas),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath('editor-properties.png') });
});

test('setup steps preserve choices and generator/library use visible previews', async ({
  page,
}, info) => {
  await ready(page);
  await nav(page, 'tournament');
  await page.locator('#bots').selectOption('5');
  await page.locator('[data-action="setup-next"]').click();
  for (let i = 0; i < 3; i++) await page.locator('.track-card').nth(i).click();
  await page.locator('[data-action="setup-next"]').click();
  await expect(page.locator('.review-courses li')).toHaveCount(3);
  await page.locator('[data-action="setup-previous"]').click();
  await page.locator('[data-action="setup-previous"]').click();
  await expect(page.locator('#bots')).toHaveValue('5');
  await page.locator('[data-action="setup-next"]').click();
  await page.locator('[data-action="generator"]').click();
  await page.locator('[data-action="generate"]').click();
  await expect(page.locator('.generated-detail')).toContainText('piezas');
  await page.screenshot({ path: info.outputPath('generator.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await inWindow(page, '.screen-footer');
  await expect(page.locator('[data-action="generate"]')).toBeInViewport();
  await expect(page.locator('[data-action="regenerate"]')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('generator-640.png') });
  await page.locator('[data-action="use-generated"]').click();
  await expect(page.locator('.course-row')).toHaveCount(4);
  await nav(page, 'editor');
  await page.locator('[data-action="editor-file"]').click();
  await page.locator('[data-action="library"]').click();
  await expect(page.locator('.library-page')).toBeVisible();
  await page.screenshot({ path: info.outputPath('library.png') });
  await inWindow(page, '.screen-footer');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath('library-1440.png') });
});
