import { expect, test, type Page } from '@playwright/test';
import { nav } from './ui-helpers';

async function fixture(page: Page) {
  await page.route('http://127.0.0.1:5173/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>',
    }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [
      { World },
      { loadBikeAssets },
      { loadCrowdAssets },
      { defaultSettings, HZ },
      { createRace },
      { makeBots },
      { BUILTINS },
      { heightAt },
    ] = await Promise.all([
      source('/src/renderer.ts'),
      source('/src/bike-model.ts'),
      source('/src/crowd-assets.ts'),
      source('/src/core/types.ts'),
      source('/src/core/racing.ts'),
      source('/src/core/game.ts'),
      source('/src/core/maps.ts'),
      source('/src/core/tracks.ts'),
    ]);
    const world = new World(
      document.querySelector('canvas'),
      { ...structuredClone(defaultSettings), quality: 'low' },
      await loadBikeAssets(),
      await loadCrowdAssets(),
    );
    const race = createRace({
      ...BUILTINS[0],
      mode: 'quick',
      player: { id: 'one', name: 'Jugador', color: '#e05a3b' },
      bots: makeBots(5),
      difficulty: 'normal',
      seed: 19,
    });
    race.phase = 'racing';
    race.countdown = 0;
    world.setTrack(race.track);
    world.beginRace(race);
    world.mode = 'race';
    const step = (event?: string) => {
      world.capture(race);
      race.frame++;
      race.events = [];
      race.riders.forEach((p: any, i: number) => {
        p.x = 1000 + race.frame * 2 + i * 12;
        p.lane = i % 4;
        p.speed = 3.25;
        p.turbo = true;
        p.height = heightAt(race.track, p.x, p.lane);
        p.grounded = true;
      });
      if (event)
        race.events.push({
          type: event,
          rider: 0,
          frame: race.frame,
          impactSpeed: 4,
          surface: 'dirt',
        });
      world.onSimulationStep(race);
    };
    (window as any).f = {
      world,
      race,
      step,
      HZ,
      time: 0,
      render(paused = false, results = false) {
        world.render((this.time += 1 / HZ), race, paused, 1, results);
      },
    };
  });
}

test('VFX shaders render every environment and quality, preserve pause and world coordinates', async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await fixture(page);
  for (const quality of ['low', 'high'])
    for (const time of ['morning', 'afternoon', 'night'])
      for (const weather of ['clear', 'rain', 'snow']) {
        const state = await page.evaluate(
          ({ quality, time, weather }) => {
            const f = (window as any).f;
            f.world.settings.quality = quality;
            f.world.applySettings();
            f.world.setWeather(weather);
            f.world.setTimeOfDay(time);
            for (let n = 0; n < 15; n++) f.step(n === 0 ? 'land' : undefined);
            f.render();
            return f.world.vfx.diagnostics();
          },
          { quality, time, weather },
        );
        expect(state.active).toBeGreaterThan(0);
        expect(state.active).toBeLessThanOrEqual(quality === 'high' ? 1536 : 512);
      }
  const frozen = await page.evaluate(() => {
    const f = (window as any).f;
    f.render(true);
    const before = f.world.vfx.diagnostics();
    const origins = Array.from(f.world.vfx.model.origins);
    for (let i = 0; i < 20; i++) f.render(true);
    return {
      before,
      after: f.world.vfx.diagnostics(),
      origins,
      afterOrigins: Array.from(f.world.vfx.model.origins),
    };
  });
  expect(frozen.before).toEqual(frozen.after);
  expect(frozen.origins).toEqual(frozen.afterOrigins);
  await page.screenshot({ path: info.outputPath('night-snow-high.png') });
  const moved = await page.evaluate(() => {
    const f = (window as any).f,
      world = f.world;
    const origins = Array.from(world.vfx.model.origins);
    world.zoomTarget = 5;
    f.race.riders[0].x += 30;
    f.render(true);
    const pausedTime = world.vfx.time;
    world.render((f.time += 0.02), f.race, false, 0);
    return {
      origins,
      after: Array.from(world.vfx.model.origins),
      pausedTime,
      resumedTime: world.vfx.time,
    };
  });
  expect(moved.origins).toEqual(moved.after);
  expect(moved.resumedTime).toBe(moved.pausedTime);
  expect(errors).toEqual([]);
});

test('long races, ghosts, quality switches and disposal retain bounded resources', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    const f = (window as any).f,
      { world, race } = f;
    const cycle = () => {
      for (const quality of ['low', 'high'])
        for (const weather of ['clear', 'rain', 'snow']) {
          world.settings.quality = quality;
          world.applySettings();
          world.setWeather(weather);
          f.step('crash');
          f.render();
        }
    };
    cycle();
    cycle();
    // Warm every obstacle and sector variant before checking retained allocations.
    for (const quality of ['low', 'high']) {
      world.settings.quality = quality;
      world.applySettings();
      for (let n = 0; n < 40; n++) {
        race.riders.forEach((p: any, i: number) => (p.x = (race.track.length * n) / 40 + i * 12));
        f.render();
      }
    }
    cycle();
    const before = { ...world.renderer.info.memory };
    for (let n = 0; n < 60; n++) {
      f.step('land');
      race.riders.forEach((p: any) => (p.x += race.track.length * n));
      f.render();
    }
    cycle();
    const after = { ...world.renderer.info.memory };
    const counts = world.vfx.diagnostics().counts;
    const withGhosts = {
      ...race,
      riders: [race.riders[0], ...race.riders.slice(1).map((p: any) => ({ ...p, id: 0 }))],
    };
    world.ghostStart = 1;
    world.render((f.time += 0.02), withGhosts, false, 1);
    const ghostCounts = world.vfx.diagnostics().counts;
    const resources = {
      particles: world.vfx.model.styles.length,
      tracks: world.vfx.model.trackPositions.length,
    };
    const objects = [
      world.vfx.renderer.particles,
      world.vfx.renderer.tracks,
      world.flags.cloth,
      world.flags.poles,
    ];
    world.vfx.dispose();
    world.flags.dispose();
    return {
      before,
      after,
      counts,
      ghostCounts,
      resources,
      removed: objects.every((o) => o.parent === null),
    };
  });
  expect(result.after).toEqual(result.before);
  expect(result.ghostCounts).toEqual(result.counts);
  expect(result.resources).toEqual({ particles: 1536 * 4, tracks: 512 * 18 });
  expect(result.removed).toBe(true);
});

test('group settings persist, disabled groups stay quiet and reduced motion has precedence', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('motoneta.settings.v2'))
      localStorage.setItem(
        'motoneta.settings.v2',
        JSON.stringify({
          vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
          quality: 'low',
          volume: 0,
        }),
      );
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('[data-action="settings-tab"][data-value="image"]').click();
  for (const id of ['vfx-race', 'vfx-tracks', 'vfx-ambient'])
    await expect(page.locator('#' + id)).not.toBeChecked();
  for (const id of ['vfx-race', 'vfx-tracks', 'vfx-ambient']) await page.locator('#' + id).check();
  await page.locator('#vfx-intensity').selectOption('strong');
  await page.getByRole('button', { name: 'Listo', exact: true }).click();
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('motoneta.settings.v2')!).vfx),
  ).toEqual({ race: true, tracks: true, ambient: true, intensity: 'strong' });
  await nav(page, 'quick');
  await page.locator('[data-action="weather"][data-value="rain"]').click();
  await page.locator('[data-action="start"]').click();
  await page.keyboard.down('z');
  await expect
    .poll(
      async () =>
        page.evaluate(
          () =>
            (window as any).__motoneta.vfx.counts.clod +
            (window as any).__motoneta.vfx.counts.water,
        ),
      { timeout: 30000 },
    )
    .toBeGreaterThan(0);
  await page.keyboard.up('z');
  await page.keyboard.press('Escape');
  const before = await page.evaluate(() => (window as any).__motoneta.vfx);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).__motoneta.vfx)).toEqual(before);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(async () => page.evaluate(() => (window as any).__motoneta.vfx.active)).toBe(0);
  await expect
    .poll(async () => page.evaluate(() => (window as any).__motoneta.precipitation.draws))
    .toBe(0);
});
