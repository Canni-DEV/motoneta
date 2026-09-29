import { expect, test } from '@playwright/test';
import { editorTab, nav } from './ui-helpers';
test('settings, key bindings, editor history and export/import stay functional', async ({
  page,
}, info) => {
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('#volume').fill('0');
  await page.locator('[data-action="settings-tab"][data-value="image"]').click();
  await page.locator('#quality').selectOption('low');
  await page.locator('[data-action="settings-tab"][data-value="controls"]').click();
  await page.locator('[data-action="rebind"][data-value="A"]').click();
  await page.keyboard.press('w');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await nav(page, 'editor');
  await page.getByRole('button', { name: 'Añadir pieza', exact: true }).click();
  await editorTab(page, 'track');
  await page.getByRole('button', { name: 'Vaciar circuito', exact: true }).click();
  await page.getByRole('button', { name: 'Deshacer', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(1);
  await page.getByRole('button', { name: 'Rehacer', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__motoneta.design.items.length)).toBe(0);
  await page.locator('#design-name').fill('Prueba');
  await page.locator('#design-name').blur();
  await page.locator('#design-length').fill('640');
  await page.locator('#design-length').blur();
  await page.locator('#design-laps').selectOption('1');
  const download = page.waitForEvent('download');
  await page.locator('[data-action="editor-file"]').click();
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const path = info.outputPath('map.json');
  await (await download).saveAs(path);
  await page.getByRole('button', { name: 'Nuevo', exact: true }).click();
  await page.locator('[data-action="discard-replace"]').click();
  await page.locator('#import-file').setInputFiles(path);
  await expect(page.locator('#design-name')).toHaveValue('Prueba');
  await page.getByRole('button', { name: 'Probar pista', exact: true }).click();
  await page.keyboard.down('w');
  await expect(page.getByRole('heading', { name: 'Resultado', exact: true })).toBeVisible({
    timeout: 45000,
  });
  await page.keyboard.up('w');
  expect(await page.evaluate(() => (window as any).__motoneta.records.length)).toBe(0);
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('[data-action="settings-tab"][data-value="image"]').click();
  await expect(page.locator('#quality')).toHaveValue('low');
  await page.locator('[data-action="settings-tab"][data-value="controls"]').click();
  await expect(page.locator('[data-action="rebind"][data-value="A"]')).toContainText('W');
});

test('touch controls accelerate and pause at narrow sizes', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() =>
    localStorage.setItem('motoneta.settings.v2', JSON.stringify({ quality: 'low', volume: 0 })),
  );
  await page.goto('http://127.0.0.1:5173');
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await page.locator('[data-action="start"]').click();
  await expect(page.locator('.touch-controls')).toBeVisible();
  await page.waitForFunction(() => (window as any).__motoneta.race.phase === 'racing');
  const box = await page.locator('[data-input="B"]').boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await expect
    .poll(async () => page.evaluate(() => (window as any).__motoneta.race.riders[0].speed))
    .toBeGreaterThan(1);
  await page.mouse.up();
  await page.getByRole('button', { name: 'Pausar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pausa', exact: true })).toBeVisible();
  const frame = await page.evaluate(() => (window as any).__motoneta.race.frame);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).__motoneta.race.frame)).toBe(frame);
  await context.close();
});

test('gamepad drives, pauses and resumes; text fields never start races', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('motoneta.settings.v2', JSON.stringify({ quality: 'low', volume: 0 }));
    const buttons = Array.from({ length: 16 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    (window as any).padButtons = buttons;
    Object.defineProperty(navigator, 'getGamepads', {
      value: () => [{ connected: true, buttons, axes: [0, 0] }],
    });
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'editor');
  await editorTab(page, 'track');
  await page.locator('#design-name').fill('Pista Z X');
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__motoneta.screen)).toBe('editor');
  await nav(page, 'quick');
  await page.locator('[data-action="start"]').click();
  await page.evaluate(() => {
    (window as any).padButtons[0].pressed = true;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.race.riders[0].speed))
    .toBeGreaterThan(1);
  await page.evaluate(() => {
    (window as any).padButtons[9].pressed = true;
  });
  await expect(page.getByRole('heading', { name: 'Pausa', exact: true })).toBeVisible();
  const frozen = await page.evaluate(() => (window as any).__motoneta.race.frame);
  await page.evaluate(() => {
    (window as any).padButtons[9].pressed = false;
  });
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).__motoneta.race.frame)).toBe(frozen);
  await page.evaluate(() => {
    (window as any).padButtons[9].pressed = true;
  });
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.paused)).toBe(false);
  await page.evaluate(() => {
    (window as any).padButtons[9].pressed = false;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__motoneta.race.frame))
    .toBeGreaterThan(frozen);
});
