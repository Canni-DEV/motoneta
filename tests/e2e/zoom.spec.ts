import { expect, test, type Page } from '@playwright/test';
import { nav } from './ui-helpers';

const camera = (page: Page) => page.evaluate(() => (window as any).__motoneta.camera);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'motoneta.settings.v3',
      JSON.stringify({ quality: 'low', volume: 0, cameraShake: false }),
    );
  });
  await page.goto('/');
  await nav(page, 'quick');
  await expect(page.locator('#model-status')).toBeHidden();
});

test('wheel zoom is bounded, reversible, preserves default framing and ignores menus', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, -120);
  expect((await camera(page)).target).toBe(1);
  await page.getByRole('button', { name: /Comenzar/ }).click();
  expect(await camera(page)).toEqual({ zoom: 1, target: 1 });
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await camera(page)).zoom).toBeGreaterThan(1.1);
  expect((await camera(page)).target).toBeLessThan(1.25);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, -120);
  await expect.poll(async () => (await camera(page)).zoom).toBe(5);
  await page.screenshot({ path: 'test-results/zoom-close.png' });
  await page.mouse.wheel(0, -10000);
  expect((await camera(page)).target).toBe(5);

  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await page.mouse.wheel(0, 120);
  expect((await camera(page)).target).toBe(5);
  await page.getByRole('button', { name: /Continuar/ }).click();
  // Synthetic modifier/line/page events complement real mouse wheel input.
  const ignored = await page.locator('#ui').evaluate((element) => {
    const events = [
      { deltaY: 120, ctrlKey: true },
      { deltaY: 120, metaKey: true },
      { deltaY: 120, shiftKey: true },
      { deltaX: 160, deltaY: 10 },
    ];
    return events.map((options) =>
      element.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, cancelable: true, ...options }),
      ),
    );
  });
  expect(ignored).toEqual([true, true, true, true]);
  expect((await camera(page)).target).toBe(5);
  await page.mouse.move(900, 400);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await camera(page)).zoom).toBe(1);
  await page.screenshot({ path: 'test-results/zoom-default.png' });
  await page.locator('#ui').dispatchEvent('wheel', { deltaY: -3, deltaMode: 1 });
  expect((await camera(page)).target).toBeGreaterThan(1);
  expect((await camera(page)).target).toBeLessThan(1.1);
  await page.locator('#ui').dispatchEvent('wheel', { deltaY: -1, deltaMode: 2 });
  expect((await camera(page)).target).toBeGreaterThan(1.2);
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await page.getByRole('button', { name: 'Reiniciar', exact: true }).click();
  expect(await camera(page)).toEqual({ zoom: 1, target: 1 });
  expect(errors).toEqual([]);
});

test('editor zoom respects panels and survives edits, with reduced motion and narrow windows', async ({
  page,
}) => {
  await nav(page, 'editor');
  await page.locator('.editor-sidebar').dispatchEvent('wheel', { deltaY: -120 });
  await page.locator('.editor-timeline').dispatchEvent('wheel', { deltaY: -120 });
  expect((await camera(page)).target).toBe(1);
  const preview = page.locator('#editor-viewport');
  for (let i = 0; i < 12; i++) await preview.dispatchEvent('wheel', { deltaY: -120 });
  await expect.poll(async () => (await camera(page)).zoom).toBe(5);
  await page.getByRole('button', { name: /Añadir pieza/ }).click();
  expect((await camera(page)).target).toBe(5);
  await page.setViewportSize({ width: 640, height: 360 });
  await expect(page.locator('#editor-viewport')).toBeVisible();
  expect((await camera(page)).target).toBe(5);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await camera(page)).zoom).toBe(5);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await nav(page, 'quick');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: /Comenzar/ }).click();
  await page.mouse.move(900, 400);
  await page.mouse.wheel(0, -120);
  await expect
    .poll(async () => {
      const { zoom, target } = await camera(page);
      return zoom === target && target > 1;
    })
    .toBe(true);
});
