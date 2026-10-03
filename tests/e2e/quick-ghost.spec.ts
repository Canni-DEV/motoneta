import { expect, test, type Page } from '@playwright/test';
import { nav, ready, runtimeModuleUrl } from './ui-helpers';

const state = (page: Page) => page.evaluate(() => (window as any).__motoneta);
const action = (page: Page, name: string) => page.locator(`[data-action="${name}"]`).click();

async function beginRace(page: Page) {
  await action(page, 'start');
  await expect.poll(async () => (await state(page)).screen).toBe('race');
}

async function fixture(page: Page) {
  await ready(page);
  await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [{ GameStore }, { emptyDesign, mapCourse, validateMap }, racing, recording, { quickRaceConfig }] = await Promise.all([
      source('/src/persistence.ts'), source('/src/core/maps.ts'), source('/src/core/racing.ts'),
      source('/src/core/recording.ts'), source('/src/core/personal-ghost.ts'),
    ]);
    const store = new GameStore();
    await store.open();
    const map = validateMap({ ...emptyDesign(), id: 'ghost-course', name: 'Pista del fantasma', length: 640, laps: 2 });
    await store.update((s: any) => {
      s.maps = [map];
      s.profiles.push({ ...structuredClone(s.profiles[0]), id: 'second', name: 'Otro jugador' });
    });
    for (const bots of [0, 2, 5]) {
      const config = quickRaceConfig(mapCourse(map), store.state.profiles[0], bots, 'normal');
      const race = racing.createRace(config), replay = recording.newRecording(config);
      while (!racing.isFinished(race, 0)) {
        const input = race.elapsed < 900 ? 0 : 1;
        recording.appendInput(replay, input);
        racing.stepRace(race, input);
      }
      replay.result = racing.raceResult(racing.completeRace(race));
      await store.commit(replay);
    }
  });
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await page.locator('.track-card', { hasText: 'Pista del fantasma' }).click();
  await page.locator('#bots').selectOption('2');
}

async function leave(page: Page) {
  await page.keyboard.press('Escape');
  await action(page, 'leave-race');
  await expect(page.getByRole('heading', { name: 'Carrera rápida', exact: true })).toBeVisible();
}

async function activateProfile(page: Page, id: string) {
  await action(page, 'profiles');
  await page.locator(`[data-action="profile-select"][data-value="${id}"]`).click();
  await action(page, 'activate-profile');
  await action(page, 'close-modal');
}

async function expectedDelta(page: Page, index: number) {
  return page.evaluate(async (index) => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [{ ghostLapComparison }, { formatGhostDelta }] = await Promise.all([
      source('/src/core/personal-ghost.ts'), source('/src/ui/personal-ghost-view.ts'),
    ]);
    const s = (window as any).__motoneta;
    const split = ghostLapComparison(s.race.riderLaps[0], s.personalGhost, index);
    return [formatGhostDelta(split.lapDeltaTicks), formatGhostDelta(split.totalDeltaTicks)];
  }, index);
}

test('quick records follow the configuration and remember only the session preference', async ({ page }) => {
  await fixture(page);
  const checkbox = page.getByRole('checkbox', { name: 'Correr contra mi fantasma' });
  await expect(page.locator('#quick-record')).toContainText('Tu récord:');
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press('Space');
  await expect(checkbox).toBeChecked();
  await expect(checkbox).toBeFocused();
  const record = await page.locator('#quick-record').textContent();
  await page.getByRole('button', { name: 'Noche', exact: true }).click();
  await page.getByRole('button', { name: 'Nieve', exact: true }).click();
  await expect(page.locator('#quick-record')).toHaveText(record!);
  await page.locator('#laps').selectOption('1');
  await expect(page.locator('#quick-record')).toHaveText('Sin récord para esta configuración');
  await expect(checkbox).toBeDisabled();
  await expect(checkbox).not.toBeChecked();
  await page.locator('#laps').selectOption('2');
  await expect(checkbox).toBeChecked();
  await page.locator('#difficulty').selectOption('hard');
  await expect(checkbox).toBeDisabled();
  await page.locator('#difficulty').selectOption('normal');
  await expect(checkbox).toBeChecked();
  await page.locator('#bots').selectOption('5');
  await expect(checkbox).toBeChecked();
  await page.locator('#bots').selectOption('0');
  const soloRecord = await page.locator('#quick-record').textContent();
  await page.locator('#difficulty').selectOption('hard');
  await expect(page.locator('#quick-record')).toHaveText(soloRecord!);
  await expect(checkbox).toBeChecked();
  await activateProfile(page, 'second');
  await expect(checkbox).toBeDisabled();
  await activateProfile(page, 'player-1');
  await expect(checkbox).toBeChecked();
  await page.locator('.track-card').first().click();
  await expect(checkbox).toBeDisabled();
  await page.locator('.track-card', { hasText: 'Pista del fantasma' }).click();
  await expect(checkbox).toBeChecked();
  await nav(page, 'records');
  await nav(page, 'quick');
  await expect(checkbox).toBeChecked();
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await page.locator('.track-card', { hasText: 'Pista del fantasma' }).click();
  await expect(checkbox).toBeEnabled();
  await expect(checkbox).not.toBeChecked();
});

test('two bots and one personal ghost show splits, frozen results and the newest ghost on retry', async ({ page }, info) => {
  await fixture(page);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).check();
  await page.screenshot({ path: info.outputPath('quick-record-desktop.png') });
  await beginRace(page);
  const target = (await state(page)).personalGhost;
  expect((await state(page)).race.riders).toHaveLength(3);
  expect((await state(page)).ghosts).toHaveLength(1);
  await expect.poll(async () => (await state(page)).ghosts[0].opacity).toBeCloseTo(0.1);
  await expect(page.locator('#ghost-comparison')).toHaveText('Sin parciales todavía');
  await page.keyboard.down('z');
  await expect.poll(async () => (await state(page)).race.riderLaps[0].length).toBeGreaterThanOrEqual(1);
  await page.keyboard.press('Escape');
  await page.keyboard.up('z');
  const paused = await state(page);
  const splits = await expectedDelta(page, paused.race.riderLaps[0].length - 1);
  await expect(page.locator('#ghost-comparison h3')).toHaveText(`Vuelta ${paused.race.riderLaps[0].length}`);
  await expect(page.locator('#ghost-comparison dd').nth(0)).toHaveText(splits[0]);
  await expect(page.locator('#ghost-comparison dd').nth(1)).toHaveText(splits[1]);
  await expect.poll(async () => ({
    real: (await state(page)).race.frame, ghost: (await state(page)).ghosts[0].frame,
    opacity: (await state(page)).ghosts[0].opacity,
  })).toEqual({ real: paused.race.frame, ghost: paused.ghosts[0].frame, opacity: paused.ghosts[0].opacity });
  // Close the pause dialog without resuming while inspecting the HUD.
  await page.evaluate(() => (document.querySelector('#modal') as HTMLDialogElement).close());
  for (const [width, height] of [[1440, 900], [640, 360]]) {
    await page.setViewportSize({ width, height });
    for (const selector of ['#ghost-comparison', '#race-time', '#speed', '#heat-label'])
      await expect(page.locator(selector)).toBeInViewport();
    const overlap = await page.evaluate(() => {
      const ghost = document.querySelector('#ghost-comparison')!.getBoundingClientRect();
      const header = document.querySelector('.race-top')!.getBoundingClientRect();
      const lower = document.querySelector('.race-bottom')!.getBoundingClientRect();
      return ghost.top < header.bottom || ghost.bottom > lower.top;
    });
    expect(overlap).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.screenshot({ path: info.outputPath(`ghost-hud-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.keyboard.press('Escape');
  await action(page, 'resume');
  await page.keyboard.down('z');
  await expect(page.getByRole('heading', { name: 'Resultado', exact: true })).toBeVisible({ timeout: 45000 });
  await page.keyboard.up('z');
  await expect(page.locator('.ghost-results')).toContainText('Diferencia total');
  await expect(page.getByRole('table', { name: 'Comparación por vuelta' }).locator('tbody tr')).toHaveCount(2);
  const finished = await state(page);
  expect(finished.personalGhost).toEqual(target);
  const record = finished.records.find((r: any) => r.key === target.key);
  expect(record.ticks).toBeLessThan(target.ticks);
  expect(record.replayId).not.toBe(target.replayId);
  for (const [width, height] of [[1440, 900], [640, 360]]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('[data-action="retry"]')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    await page.locator('.ghost-results').scrollIntoViewIfNeeded();
    await expect(page.locator('.ghost-results h3')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`ghost-results-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await action(page, 'retry');
  await expect.poll(async () => (await state(page)).personalGhost?.replayId).toBe(record.replayId);
  expect((await state(page)).ghosts).toHaveLength(1);
  await expect.poll(async () => (await state(page)).ghosts[0].opacity).toBeCloseTo(0.1);
  await expect(page.locator('#ghost-comparison')).toHaveText('Sin parciales todavía');
  await leave(page);
  await expect(page.getByRole('checkbox', { name: 'Correr contra mi fantasma' })).toBeChecked();
  expect(errors).toEqual([]);
});

test('unchecked attempts have no ghost, while solo and five bots each add exactly one ghost', async ({ page }) => {
  await fixture(page);
  await beginRace(page);
  expect((await state(page)).ghosts).toEqual([]);
  expect((await state(page)).personalGhost).toBeNull();
  await expect(page.locator('#ghost-comparison')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await action(page, 'retry');
  expect((await state(page)).ghosts).toEqual([]);
  await leave(page);
  for (const bots of [0, 5]) {
    await page.locator('#bots').selectOption(String(bots));
    await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).check();
    await beginRace(page);
    expect((await state(page)).race.riders).toHaveLength(bots + 1);
    expect((await state(page)).ghosts).toHaveLength(1);
    await expect(page.locator('#position')).toHaveText(`1 / ${bots + 1}`);
    await leave(page);
  }
  await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).uncheck();
  await beginRace(page);
  expect((await state(page)).personalGhost).toBeNull();
  await expect(page.locator('#ghost-comparison')).toHaveCount(0);
});

test('missing or invalid ghost replays keep configuration usable and allow a race without the ghost', async ({ page }) => {
  await fixture(page);
  await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).check();
  await page.evaluate(async (moduleUrl) => {
    const { GameStore } = await import(/* @vite-ignore */ moduleUrl);
    const original = GameStore.prototype.replay;
    (window as any).ghostReadMode = 'missing';
    GameStore.prototype.replay = async function (id: string) {
      if ((window as any).ghostReadMode === 'missing') return undefined;
      if ((window as any).ghostReadMode === 'error') throw new Error('Error de lectura del fantasma');
      const replay = await original.call(this, id);
      return { ...replay, ruleset: 'incompatible' };
    };
  }, await runtimeModuleUrl(page, '/src/persistence.ts'));
  for (const [mode, message] of [
    ['missing', 'No se encontró la repetición de tu récord'],
    ['invalid', 'Repetición incompatible o dañada'],
    ['error', 'Error de lectura del fantasma'],
  ]) {
    await page.evaluate((mode) => { (window as any).ghostReadMode = mode; }, mode);
    await action(page, 'start');
    await expect(page.locator('#toast')).toContainText(message);
    expect((await state(page)).screen).toBe('quick');
    await expect(page.locator('[data-action="start"]')).toBeEnabled();
    await expect(page.getByRole('checkbox', { name: 'Correr contra mi fantasma' })).toBeChecked();
  }
  await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).uncheck();
  await action(page, 'start');
  expect((await state(page)).ghosts).toEqual([]);
});

test('pending ghost reads cannot launch duplicate races or a stale configuration after navigation', async ({ page }) => {
  await fixture(page);
  await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).check();
  await page.evaluate(async (moduleUrl) => {
    const { GameStore } = await import(/* @vite-ignore */ moduleUrl);
    const original = GameStore.prototype.replay;
    (window as any).ghostReadCount = 0;
    GameStore.prototype.replay = function (id: string) {
      (window as any).ghostReadCount++;
      return new Promise((resolve, reject) => {
        (window as any).releaseGhostRead = () => original.call(this, id).then(resolve, reject);
      });
    };
  }, await runtimeModuleUrl(page, '/src/persistence.ts'));
  await action(page, 'start');
  await expect(page.locator('[data-action="start"]')).toBeDisabled();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).ghostReadCount)).toBe(1);
  await page.locator('#laps').selectOption('1');
  await page.evaluate(() => (window as any).releaseGhostRead());
  await expect(page.locator('[data-action="start"]')).toBeEnabled();
  expect((await state(page)).screen).toBe('quick');
  await page.locator('#laps').selectOption('2');
  await action(page, 'start');
  await nav(page, 'home');
  await page.evaluate(() => (window as any).releaseGhostRead());
  await expect(page.locator('.home-modes')).toBeVisible();
  expect((await state(page)).screen).toBe('home');
  await nav(page, 'quick');
  await expect(page.locator('[data-action="start"]')).toBeEnabled();
});

test('touch configuration and ghost splits leave race feedback and touch controls unobstructed', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await fixture(page);
    await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).check();
    await page.setViewportSize({ width: 640, height: 360 });
    await page.locator('[data-action="setup-tab"][data-value="options"]').click();
    await expect(page.locator('#quick-record')).toBeInViewport();
    await expect(page.locator('#quick-ghost')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('quick-record-touch.png') });
    await beginRace(page);
    await page.keyboard.down('z');
    await expect.poll(async () => (await state(page)).race.riderLaps[0].length).toBeGreaterThanOrEqual(1);
    await page.keyboard.press('Escape');
    await page.keyboard.up('z');
    await page.evaluate(() => (document.querySelector('#modal') as HTMLDialogElement).close());
    await expect(page.locator('.touch-controls')).toBeVisible();
    await expect(page.locator('#ghost-comparison')).toBeInViewport();
    await page.screenshot({ path: info.outputPath('ghost-hud-touch.png') });
    const collisions = await page.evaluate(async () => {
      const source = (path: string) => import(/* @vite-ignore */ path);
      const [{ updateHud }, { defaultSettings }] = await Promise.all([
        source('/src/ui/race-view.ts'), source('/src/core/types.ts'),
      ]);
      const s = (window as any).__motoneta;
      s.race.riders[0].crashPhase = 'down';
      // Exercise presentation on a copy, without changing the running simulation.
      updateHud(s.race, defaultSettings, s.personalGhost);
      const ghost = document.querySelector('#ghost-comparison')!.getBoundingClientRect();
      return ['#race-message', '.touch-dpad', '.touch-throttle'].filter((selector) => {
        const other = document.querySelector(selector)!.getBoundingClientRect();
        return ghost.left < other.right && ghost.right > other.left && ghost.top < other.bottom && ghost.bottom > other.top;
      });
    });
    expect(collisions).toEqual([]);
  } finally {
    await context.close();
  }
});

test('watching the finished replay cancels a pending retry on the same race screen', async ({ page }) => {
  await fixture(page);
  await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).check();
  await beginRace(page);
  await page.keyboard.down('z');
  await expect(page.getByRole('heading', { name: 'Resultado', exact: true })).toBeVisible({ timeout: 45000 });
  await page.keyboard.up('z');
  await page.evaluate(async (moduleUrl) => {
    const { GameStore } = await import(/* @vite-ignore */ moduleUrl);
    const original = GameStore.prototype.replay;
    GameStore.prototype.replay = function (id: string) {
      return new Promise((resolve, reject) => {
        (window as any).releaseGhostRead = () => original.call(this, id).then(resolve, reject);
      });
    };
  }, await runtimeModuleUrl(page, '/src/persistence.ts'));
  await action(page, 'retry');
  await expect(page.locator('[data-action="retry"]')).toBeDisabled();
  await action(page, 'watch');
  await expect(page.locator('.race-identity span')).toHaveText('Repetición');
  await page.evaluate(() => (window as any).releaseGhostRead());
  await expect(page.locator('.race-identity span')).toHaveText('Repetición');
  expect((await state(page)).personalGhost).toBeNull();
  expect((await state(page)).ghosts).toEqual([]);
});
