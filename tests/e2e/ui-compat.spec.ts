import { writeFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { ready, nav, editorTab } from './ui-helpers';

test('menus, editor viewport, forms and modal focus work across browser engines', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const consoleErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await ready(page);
  await nav(page, 'editor');
  await page.locator('[data-action="add-piece"]').click();
  await expect(page.locator('[data-piece-field="x"]')).toHaveValue('320');
  await editorTab(page, 'track');
  await page.locator('#design-name').fill('Compatibilidad');
  await page.locator('#design-name').blur();
  await page.locator('[data-action="save-design"]').click();
  await expect(page.locator('#draft-status')).toHaveText('Guardado');
  for (const [width, height] of [
    [1024, 600],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    const sizes = await page.evaluate(() => {
      const canvas = document.querySelector('#world')!.getBoundingClientRect();
      const host = document.querySelector('#editor-viewport')!.getBoundingClientRect();
      return {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        canvas: [canvas.width, canvas.height],
        host: [host.width, host.height],
        footer: document.querySelector('.editor-footer')!.getBoundingClientRect().bottom,
      };
    });
    expect(sizes.width).toBe(width);
    expect(sizes.height).toBe(height);
    expect(sizes.canvas).toEqual(sizes.host);
    expect(sizes.footer).toBeLessThanOrEqual(height);
  }
  await page.screenshot({ path: info.outputPath('editor-compact.png') });
  const graphics = await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
          const gl = canvas.getContext('webgl2')!;
          const pixels = new Uint8Array(4 * gl.drawingBufferWidth * gl.drawingBufferHeight);
          gl.readPixels(
            0,
            0,
            gl.drawingBufferWidth,
            gl.drawingBufferHeight,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            pixels,
          );
          const colors = new Set<string>();
          for (let i = 0; i < pixels.length; i += 64)
            colors.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
          resolve({
            colors: colors.size,
            contextLost: gl.isContextLost(),
            renderer: gl.getParameter(gl.RENDERER),
            error: gl.getError(),
          });
        }),
      ),
  );
  await writeFile(info.outputPath('graphics-diagnostics.json'), JSON.stringify(graphics));
  console.log('Graphics', graphics);
  expect((graphics as { colors: number }).colors).toBeGreaterThan(64);
  await nav(page, 'home');
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('[data-action="settings-tab"][data-value="interface"]').click();
  await page.locator('#reducedMotion').check();
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Ajustes', exact: true })).toBeFocused();
  await nav(page, 'quick');
  await page.locator('[data-action="start"]').click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Pausa', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('pause-compact.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath('pause-desktop.png') });
  expect(errors).toEqual([]);
  await info.attach('console-errors.json', {
    body: JSON.stringify(consoleErrors),
    contentType: 'application/json',
  });
  expect(consoleErrors).toEqual([]);
});
