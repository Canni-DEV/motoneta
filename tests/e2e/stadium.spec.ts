import { expect, test, type Page } from '@playwright/test';
import { nav } from './ui-helpers';

async function fixture(page: Page) {
  await page.route('http://127.0.0.1:5173/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html><style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas></html>',
    }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [
      { World },
      { loadBikeAssets },
      { loadCrowdAssets },
      { defaultSettings },
      { testTrack },
      { testRace },
    ] = await Promise.all([
      source('/src/renderer.ts'),
      source('/src/bike-model.ts'),
      source('/src/crowd-assets.ts'),
      source('/src/core/types.ts'),
      source('/tests/race-fixture.ts'),
      source('/tests/race-fixture.ts'),
    ]);
    const world = new World(
      document.querySelector('canvas'),
      {
        ...defaultSettings,
        quality: 'low',
        vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
        cameraShake: false,
      },
      await loadBikeAssets(),
      await loadCrowdAssets(),
    );
    const track = testTrack({ name: 'Continuity', laps: 9, items: [] });
    const race = testRace(track, 0);
    race.phase = 'racing';
    world.mode = 'race';
    world.setTrack(track);
    const state = (x: number, paused = false) => {
      world.resize();
      race.riders[0].x = x / 0.052;
      world.render(1, race, paused, 1);
      const diagnostics = world.stadium.diagnostics();
      // Inspect real world matrices and upload revisions, not just sector identifiers.
      const actual = world.stadium.root.children
        .filter((s: any) => s.visible)
        .map((s: any) => ({
          x: s.position.x,
          matrices: s.children
            .filter((m: any) => m.isInstancedMesh)
            .map((m: any) => ({
              revision: m.instanceMatrix.version,
              first: Array.from(m.instanceMatrix.array.slice(0, 16)),
              count: m.count,
              geometry: m.geometry.uuid,
            })),
        }));
      return { diagnostics, actual, memory: { ...world.renderer.info.memory } };
    };
    (window as any).stadiumFixture = { world, track, race, state };
  });
}

test('sectors stay anchored through two laps, old snap boundaries and camera reversal', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await fixture(page);
  const result = await page.evaluate(() => {
    const { world, track, state } = (window as any).stadiumFixture;
    const failures: string[] = [],
      identities = new Map(),
      positions = new Map();
    let previous: any;
    const points = [
      ...Array.from({ length: 80 }, (_, i) => i * 0.9),
      30.001,
      30,
      29.999,
      15.001,
      15,
      14.999,
      -0.001,
      0,
    ];
    for (const x of points) {
      const current = state(x);
      for (const sector of current.diagnostics.sectors) {
        const identity = JSON.stringify([sector.signature, sector.sign, sector.people]);
        if (identities.has(sector.logical) && identities.get(sector.logical) !== identity)
          failures.push('Changed identity');
        identities.set(sector.logical, identity);
        if (positions.has(sector.absolute) && positions.get(sector.absolute) !== sector.x)
          failures.push('Moved sector');
        positions.set(sector.absolute, sector.x);
        const old = previous?.actual.find((s: any) => s.x === sector.x),
          actual = current.actual.find((s: any) => s.x === sector.x);
        if (old && JSON.stringify(old.matrices) !== JSON.stringify(actual.matrices))
          failures.push('Reuploaded visible people');
      }
      previous = current;
    }
    for (let lap = 1; lap <= 30; lap++) state(lap * track.length * 0.052);
    const before = state(0);
    for (let lap = 31; lap <= 60; lap++) state(lap * track.length * 0.052);
    const after = state(0);
    return {
      failures,
      before,
      after,
      loop: track.length * 0.052,
      pool: world.stadium.diagnostics().pool,
    };
  });
  expect(result.failures).toEqual([]);
  expect(result.after.memory).toEqual(result.before.memory);
  expect(result.pool).toBeLessThan(15);
  expect(result.after.diagnostics.sectors).toEqual(result.before.diagnostics.sectors);
  expect(errors).toEqual([]);
});

test('resize, quality, pause, reduced motion and finish preserve the crowd', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 3200, height: 800 });
  const wide = await page.evaluate(() => (window as any).stadiumFixture.state(0));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (window as any).stadiumFixture.state(0));
  await page.setViewportSize({ width: 3200, height: 800 });
  const restored = await page.evaluate(() => (window as any).stadiumFixture.state(0));
  expect(restored.diagnostics.sectors).toEqual(wide.diagnostics.sectors);
  const result = await page.evaluate(() => {
    const { world, race, state } = (window as any).stadiumFixture;
    const initial = state(0).diagnostics.sectors;
    for (const q of ['high', 'low', 'high', 'low']) {
      world.settings.quality = q;
      world.applySettings();
      state(0);
    }
    const quality = state(0).diagnostics.sectors;
    race.frame = 100;
    world.stadium.onSimulationStep(race);
    state(0);
    const time = world.stadium.diagnostics().time;
    for (let i = 0; i < 5; i++) world.render(2 + i * 0.02, race, true, 0);
    const paused = world.stadium.diagnostics().time;
    const still = world.canvas.toDataURL();
    world.render(2.2, race, true, 0);
    const frozenPixels = world.canvas.toDataURL() === still;
    race.frame = 125;
    world.stadium.onSimulationStep(race);
    world.render(2.3, race, false, 1);
    const animatedPixels = world.canvas.toDataURL() !== still;
    world.reduced = true;
    state(0);
    const reduced = world.stadium.diagnostics().time;
    world.reduced = false;
    race.frame = 300;
    race.phase = 'finished';
    race.events = [{ type: 'finish', rider: 0, frame: 300 }];
    world.stadium.onSimulationStep(race);
    for (let i = 0; i < 55; i++) world.render(3 + i * 0.04, race, false, 1);
    const end = world.stadium.diagnostics().time;
    world.render(8, race, false, 1);
    const held = world.stadium.diagnostics().time;
    return { initial, quality, time, paused, reduced, end, held, frozenPixels, animatedPixels };
  });
  expect(result.quality).toEqual(result.initial);
  expect(result.paused).toBe(result.time);
  expect(result.frozenPixels).toBe(true);
  expect(result.animatedPixels).toBe(true);
  expect(result.reduced).toBe(0);
  expect(result.end).toBe(result.held);
});

test('close camera follows jumps and zoom keeps visible stadium sectors anchored', async ({
  page,
}) => {
  await fixture(page);
  const result = await page.evaluate(() => {
    const { world, race, state } = (window as any).stadiumFixture;
    const initial = state(0);
    world.reduced = true;
    world.zoomBy(-120);
    state(0);
    const intermediate = world.camera.zoom;
    for (let i = 0; i < 12; i++) world.zoomBy(-120);
    const close = state(0);
    const poses = [];
    // Both outside lanes and a high jump: the bike and head stay inside the image.
    for (const lane of [0, 3]) {
      for (const height of [0, 40, 100]) {
        race.riders[0].lane = lane;
        race.riders[0].height = height;
        state(0);
        const root = world.bikes[0].root.position;
        poses.push(
          ...[-0.85, 0.85].flatMap((x) =>
            [0, 1.5].map((y) => {
              const p = root.clone();
              p.x += x;
              p.y += y;
              p.project(world.camera);
              return { x: p.x, y: p.y };
            }),
          ),
        );
      }
    }
    race.riders[0].height = 0;
    world.resetZoom();
    const restored = state(0);
    return { initial, intermediate, close, poses, restored };
  });
  expect(result.intermediate).toBeGreaterThan(1);
  expect(result.intermediate).toBeLessThan(1.25);
  for (const pose of result.poses) {
    expect(Math.abs(pose.x)).toBeLessThan(1);
    expect(Math.abs(pose.y)).toBeLessThan(1);
  }
  for (const sector of result.close.actual)
    expect(sector).toEqual(result.initial.actual.find((s: any) => s.x === sector.x));
  expect(result.restored.diagnostics.sectors).toEqual(result.initial.diagnostics.sectors);
});

test('failed crowd download retries without reloading successful assets', async ({ page }) => {
  let fail = true;
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/models/')) requests.push(new URL(r.url()).pathname);
  });
  await page.route('**/models/crowd/low.json', (route) =>
    fail ? route.abort('failed') : route.continue(),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Reintentar', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => (window as any).__motoneta.race)).toBeNull();
  fail = false;
  await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await page.getByRole('button', { name: /Comenzar/ }).click();
  await expect(page.locator('.race-identity')).toBeVisible();
  expect(requests.filter((n) => n.endsWith('low.json'))).toHaveLength(2);
  expect(requests.filter((n) => n.endsWith('high.json'))).toHaveLength(1);
  expect(requests.filter((n) => n.endsWith('animation.bin'))).toHaveLength(1);
});
