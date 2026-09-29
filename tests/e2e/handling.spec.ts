import { expect, test } from '@playwright/test';
import { editorTab } from './ui-helpers';

test('turbo and rear-wheel balance can be felt and corrected during a race', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() =>
    localStorage.setItem('motoneta.settings.v2', JSON.stringify({ quality: 'low', volume: 0 })),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await editorTab(page, 'track');
  await page.getByRole('button', { name: 'Vaciar circuito', exact: true }).click();
  await page.locator('#design-laps').selectOption('9');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: 'Probar pista' }).click();
  await page.waitForFunction(() => (window as any).__motoneta.race.phase === 'racing');
  await page.keyboard.down('z');
  await page.waitForFunction(() => (window as any).__motoneta.race.riders[0].speed === 3.125);
  await page.keyboard.down('x');
  await page.waitForFunction(() => (window as any).__motoneta.race.riders[0].speed === 3.25);
  await expect(page.locator('#turbo-state')).toHaveClass('active');
  await page.keyboard.up('x');
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(() => (window as any).__motoneta.race.riders[0].wheelie > 0.55);
  await page.keyboard.press('Escape');
  await page.keyboard.up('ArrowLeft');
  const lifted = await page.evaluate(() => (window as any).__motoneta.race.riders[0]);
  expect(lifted.tilt).toBeGreaterThan(0.5);
  expect(lifted.crashes).toBe(0);
  await page.screenshot({
    path: 'test-results/wheelie.png',
    style:
      'dialog {visibility:hidden} dialog::backdrop {background:transparent;backdrop-filter:none}',
  });
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.keyboard.down('z');
  await page.keyboard.down('ArrowRight');
  await page.waitForFunction(() => (window as any).__motoneta.race.riders[0].wheelie === 0);
  expect(await page.evaluate(() => (window as any).__motoneta.race.riders[0].crashes)).toBe(0);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowLeft');
  await page.waitForFunction(() => {
    const p = (window as any).__motoneta.race.riders[0];
    return p.recovery > 0 && p.crashKind === 'backflip' && p.crashAge >= 24;
  });
  await page.keyboard.press('Escape');
  await page.keyboard.up('ArrowLeft');
  await page.keyboard.up('z');
  const fallen = await page.evaluate(() => (window as any).__motoneta.race.riders[0]);
  expect(fallen.crashPhase).toBe('rolling');
  expect(fallen.x).toBeGreaterThan(80);
  expect(fallen.crashes).toBe(1);
  await page.screenshot({
    path: 'test-results/backflip.png',
    style:
      'dialog {visibility:hidden} dialog::backdrop {background:transparent;backdrop-filter:none}',
  });
  await page.getByRole('button', { name: 'Continuar' }).click();
  await page.waitForFunction(() => {
    const p = (window as any).__motoneta.race.riders[0];
    return p.crashPhase === 'down' && p.crashPhaseAge >= 24;
  });
  await page.keyboard.press('Escape');
  await page.screenshot({
    path: 'test-results/crash-down.png',
    style: 'dialog {visibility:hidden} dialog::backdrop {background:transparent;backdrop-filter:none}',
  });
  expect(errors).toEqual([]);
});
