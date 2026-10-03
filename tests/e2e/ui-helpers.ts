import { expect, type Page } from '@playwright/test';

/** Match the running module, including Vite's HMR query, before patching its prototype. */
export async function runtimeModuleUrl(page: Page, path: string): Promise<string> {
  return page.evaluate((path) => {
    const loaded = performance.getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname === path);
    if (!loaded) throw new Error(`El módulo ${path} no está cargado en la página.`);
    return loaded.name;
  }, path);
}

export async function nav(page: Page, mode: string) {
  if (await page.locator('#modal').isVisible()) {
    const close = page.locator('#modal [data-action="close-modal"]');
    if (await close.count()) await close.click();
    else await page.keyboard.press('Escape');
  }
  if (!(await page.locator('.home-modes').isVisible())) {
    const home = page.locator('.topbar [data-action="home"]');
    if (await home.isVisible()) await home.click();
    else {
      await page.locator('[data-action="editor-file"]').click();
      await page.locator('#modal [data-action="home"]').click();
    }
  }
  if (mode !== 'home') await page.locator(`.home-modes [data-value="${mode}"]`).click();
  if (mode === 'tournament') await page.getByRole('button', { name: 'Torneo personalizado', exact: true }).click();
}
export async function ready(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      'motoneta.settings.v3',
      JSON.stringify({
        quality: 'low',
        volume: 0,
        vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
}
export async function editorTab(page: Page, tab: string) {
  await page.locator(`[data-action="editor-tab"][data-value="${tab}"]`).click();
}
