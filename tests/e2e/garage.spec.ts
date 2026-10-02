import { expect, test } from '@playwright/test';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`garage saves and cancels independent parts at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.locator('#model-status')).toBeHidden();
    const current = () => page.evaluate(() => (window as any).__motoneta.profiles[0].appearance);
    const original = await current();
    const open = async () => {
      await page.getByRole('button', { name: 'Perfiles', exact: true }).click();
      await page.locator('[data-action="garage-open"]').click();
      await expect(page.locator('#garage-stage canvas')).toBeVisible();
    };
    await open();
    await page.locator('[data-action="garage-variant"][data-value="sprint"]').click();
    await page.locator('[data-garage-color="primary"]').fill('#abcdef');
    await page.locator('[data-action="garage-slot"][data-value="helmet"]').click();
    await page.locator('[data-action="garage-variant"][data-value="trail"]').click();
    await page.locator('[data-action="garage-cancel"]').click();
    await expect(page.locator('#garage-stage')).toHaveCount(0);
    expect(await current()).toEqual(original);

    await page.locator('[data-action="garage-open"]').click();
    await page.locator('[data-action="garage-variant"][data-value="sprint"]').click();
    await page.locator('[data-garage-color="primary"]').fill('#abcdef');
    await page.locator('[data-action="garage-slot"][data-value="helmet"]').click();
    await page.locator('[data-action="garage-variant"][data-value="trail"]').click();
    await page.locator('[data-action="garage-save"]').click();
    await expect(page.locator('#garage-stage')).toHaveCount(0);
    expect((await current()).parts).toMatchObject({ fairing: 'sprint', helmet: 'trail' });
    expect((await current()).paints.fairing.primary).toBe('#abcdef');
    await page.reload();
    await expect(page.locator('#model-status')).toBeHidden();
    expect((await current()).parts).toMatchObject({ fairing: 'sprint', helmet: 'trail' });
    expect((await current()).paints.fairing.primary).toBe('#abcdef');
    await open();
    await page.locator('[data-action="garage-reset-all"]').click();
    await page.locator('[data-action="garage-save"]').click();
    await expect(page.locator('#garage-stage')).toHaveCount(0);
    expect(await current()).toEqual(original);
  });
}
