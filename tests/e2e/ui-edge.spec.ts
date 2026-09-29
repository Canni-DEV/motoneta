import { expect, test } from '@playwright/test';
import { editorTab, nav, ready } from './ui-helpers';

test('compact dialogs keep navigation and actions visible, fullscreen rejection is recoverable', async ({
  page,
}, info) => {
  await ready(page);
  await page.setViewportSize({ width: 640, height: 360 });
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  for (const tab of ['audio', 'image', 'interface', 'controls']) {
    await page.locator(`[data-action="settings-tab"][data-value="${tab}"]`).click();
    await page.locator('.dialog-body').evaluate((el) => {
      el.scrollTop = 10000;
    });
    await expect(page.locator('.dialog-heading [role="tablist"]')).toBeInViewport();
    for (const selector of ['.dialog-heading', '.dialog-actions']) {
      const r = (await page.locator(selector).boundingBox())!;
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.height).toBeLessThanOrEqual(360);
    }
    await page.screenshot({ path: info.outputPath(`settings-${tab}.png`) });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.screenshot({ path: info.outputPath(`settings-${tab}-1440.png`) });
    await page.setViewportSize({ width: 640, height: 360 });
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Ajustes', exact: true })).toBeFocused();
  await page.evaluate(() => {
    document.documentElement.requestFullscreen = () => Promise.reject(new Error('denied'));
  });
  await page.getByRole('button', { name: 'Pantalla completa', exact: true }).click();
  await expect(page.locator('#toast')).toContainText('juego sigue disponible');
  await page.getByRole('button', { name: 'Perfiles', exact: true }).click();
  for (let i = 0; i < 5; i++) await page.locator('[data-action="add-profile"]').click();
  await page.screenshot({ path: info.outputPath('profiles.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath('profiles-1440.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.keyboard.press('Escape');
  await nav(page, 'quick');
  await page.locator('[data-action="setup-tab"][data-value="options"]').click();
  await page.screenshot({ path: info.outputPath('quick-options.png') });
  await nav(page, 'tournament');
  await page.locator('[data-action="setup-next"]').click();
  for (let i = 0; i < 3; i++) await page.locator('.track-card').nth(i).click();
  await page.screenshot({ path: info.outputPath('calendar.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath('calendar-1440.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.locator('[data-action="setup-next"]').click();
  await page.screenshot({ path: info.outputPath('review.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath('review-1440.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.locator('[data-action="start"]').click();
  await expect(page.locator('[data-action="begin-turn"]')).toBeVisible();
  await page.screenshot({ path: info.outputPath('competition.png') });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: info.outputPath('competition-1440.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.locator('[data-action="begin-turn"]')).toBeInViewport();
  await page.setViewportSize({ width: 600, height: 340 });
  await expect(page.locator('#size-gate')).toBeVisible();
  await page.screenshot({ path: info.outputPath('insufficient-size.png') });
});

test('software keyboard layout applies or cancels a focused editor field', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await ready(page);
  await nav(page, 'editor');
  await editorTab(page, 'track');
  const original = await page.locator('#design-name').inputValue();
  async function keyboard(height: number) {
    await page.evaluate((height) => {
      Object.defineProperty(window.visualViewport!, 'height', {
        configurable: true,
        get: () => height,
      });
      window.visualViewport!.dispatchEvent(new Event('resize'));
    }, height);
  }
  await page.locator('#design-name').focus();
  await keyboard(210);
  await expect(page.locator('#focused-field')).toBeVisible();
  await page.locator('#focused-field input').fill('No aplicar');
  await page.screenshot({ path: info.outputPath('focused-field.png') });
  await page.locator('[data-field-action="cancel"]').click();
  await expect(page.locator('#design-name')).toHaveValue(original);
  await keyboard(390);
  await page.waitForTimeout(650);
  await page.locator('#design-name').focus();
  await keyboard(210);
  await page.locator('#focused-field input').fill('Campo confirmado');
  await page.locator('[data-field-action="done"]').click();
  await keyboard(390);
  await expect(page.locator('#design-name')).toHaveValue('Campo confirmado');
  await expect(page.locator('#size-gate')).toBeHidden();
  await expect(page.locator('.editor-timeline')).toBeInViewport();
  await context.close();
});

test('renderer and editor listeners stay stable across repeated screen visits', async ({
  page,
}) => {
  await ready(page);
  await nav(page, 'editor');
  await page.evaluate(() => {
    (window as any).canvas = document.querySelector('#world');
  });
  const memory = [];
  for (let i = 0; i < 12; i++) {
    await nav(page, 'quick');
    await page
      .locator('.track-card')
      .nth(i % 5)
      .click();
    await nav(page, 'editor');
    await page.locator('[data-action="camera-in"]').click();
    memory.push(await page.evaluate(() => (window as any).__motoneta.memory));
  }
  // Visibility and zoom affect lazy geometry allocation; repeated cycles must not grow the resource ceiling.
  expect(Math.max(...memory.slice(7).map((m) => m.geometries))).toBeLessThanOrEqual(
    Math.max(...memory.slice(2, 7).map((m) => m.geometries)),
  );
  expect(memory.at(-1).textures).toBe(memory[2].textures);
  expect(
    await page.evaluate(() => document.querySelector('#world') === (window as any).canvas),
  ).toBe(true);
  await page.locator('[data-action="add-piece"]').click();
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(0);
});

test('WebGL and invalid-import errors remain bounded and recoverable', async ({ page }, info) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    (window as any).restoreContext = () => {
      HTMLCanvasElement.prototype.getContext = original;
    };
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      type: string,
      ...args: any[]
    ) {
      if (type.startsWith('webgl')) return null;
      return (original as any).call(this, type, ...args);
    } as typeof original;
  });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.goto('/');
  await expect(page.locator('#model-status')).toContainText('No se pudo cargar');
  await page.screenshot({ path: info.outputPath('webgl-error.png') });
  await page.evaluate(() => (window as any).restoreContext());
  await page.locator('[data-action="retry-models"]').click();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'editor');
  await page.locator('[data-action="editor-file"]').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-action="import-design"]').click();
  await (
    await chooser
  ).setFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"version":2}'),
  });
  await expect(page.locator('#toast')).toContainText('compatible con MotoNeta');
  await expect(page.locator('#dialog-feedback')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('invalid-import.png') });
  expect(
    await page.evaluate(() => [
      document.documentElement.scrollWidth,
      document.documentElement.scrollHeight,
    ]),
  ).toEqual([640, 360]);
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(0);
});
