import { expect, test } from '@playwright/test';

test.use({ video: 'on', viewport: { width: 960, height: 540 } });

test.describe('precipitation motion', () => {
  test('snow and rain stay in the world as the rider advances and the camera zooms', async ({
    page,
  }, testInfo) => {
    await page.route('http://127.0.0.1:5173/', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>',
      }),
    );
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/');
    await page.evaluate(async () => {
      const source = (path: string) => import(/* @vite-ignore */ path);
      const [
        { World },
        { loadBikeAssets },
        { loadCrowdAssets },
        { defaultSettings },
        { getTrack },
        { testRace },
      ] = await Promise.all([
        source('/src/renderer.ts'),
        source('/src/bike-model.ts'),
        source('/src/crowd-assets.ts'),
        source('/src/core/types.ts'),
        source('/src/core/tracks.ts'),
        source('/tests/race-fixture.ts'),
      ]);
      const world = new World(
        document.querySelector('canvas'),
        {
          ...defaultSettings,
          quality: 'low',
          vfx: { race: true, tracks: true, ambient: true, intensity: 'balanced' },
        },
        await loadBikeAssets(),
        await loadCrowdAssets(),
      );
      const track = getTrack(0),
        race = testRace(track, 0);
      world.setTrack(track);
      world.mode = 'race';
      race.phase = 'racing';
      (window as any).motion = { world, race, time: 0 };
    });
    for (const weather of ['snow', 'rain']) {
      const result = await page.evaluate((weather) => {
        const f = (window as any).motion,
          { world, race } = f;
        world.setWeather(weather);
        world.zoomTarget = world.camera.zoom = 1;
        race.riders[0].x = 420;
        const render = () => {
          f.time += 1 / 60;
          world.render(f.time, race);
        };
        render();
        const object = world.weatherEffects[weather];
        const stride = weather === 'snow' ? 3 : 6;
        const point = (i: number) =>
          world.camera.position
            .clone()
            .fromArray(object.geometry.attributes.position.array, i * stride)
            .applyMatrix4(object.matrixWorld);
        const visible = Array.from({ length: 192 }, (_, i) => ({ i, world: point(i) })).filter(
          ({ world: p }) => {
            const ndc = p.clone().project(world.camera);
            return Math.abs(ndc.x) < 0.6 && Math.abs(ndc.y) < 0.6 && Math.abs(ndc.z) < 1 && p.y > 2;
          },
        );
        if (!visible.length) throw new Error('No visible precipitation to verify');
        const chosen = visible[0],
          beforeScreen = chosen.world.clone().project(world.camera);
        const cameraX = world.camera.position.x;
        race.riders[0].x += 60;
        render();
        const panned = point(chosen.i),
          afterScreen = panned.clone().project(world.camera);
        const markerScreen = chosen.world.clone().project(world.camera);
        const cameraTravel = world.camera.position.x - cameraX;
        world.zoomTarget = 5;
        render();
        const zoomed = point(chosen.i);
        return {
          visible: visible.length,
          cameraTravel,
          particleTravel: Math.abs(panned.x - chosen.world.x),
          screenTravel: afterScreen.x - beforeScreen.x,
          markerError: Math.abs(afterScreen.x - markerScreen.x),
          zoomTravel: Math.abs(zoomed.x - panned.x),
          zoom: world.camera.zoom,
        };
      }, weather);
      expect(result.visible).toBeGreaterThan(0);
      expect(result.cameraTravel).toBeGreaterThan(3);
      expect(result.particleTravel).toBeLessThan(0.02);
      expect(result.screenTravel).toBeLessThan(-0.1);
      expect(result.markerError).toBeLessThan(0.002);
      expect(result.zoomTravel).toBeLessThan(0.02);
      expect(result.zoom).toBeGreaterThan(1);
      await testInfo.attach(`${weather}-world-motion`, {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      });
      // A moving visual review catches the camera attachment that static screenshots missed.
      await page.evaluate(async (weather) => {
        const f = (window as any).motion,
          { world, race } = f;
        world.setWeather(weather);
        world.zoomTarget = world.camera.zoom = 1;
        for (let i = 0; i < 150; i++) {
          await new Promise(requestAnimationFrame);
          f.time += 1 / 60;
          race.riders[0].x += 3.25;
          if (i === 100) world.zoomTarget = 3;
          world.render(f.time, race);
        }
      }, weather);
      await page.screenshot({ path: testInfo.outputPath(`${weather}-moving.png`) });
    }
    expect(errors).toEqual([]);
  });
});

test('weather shaders restore clear pixels, keep special surfaces distinct and reuse GPU resources', async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 480 });
  await page.route('http://127.0.0.1:5173/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>',
    }),
  );
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [
      { World },
      { loadBikeAssets },
      { loadCrowdAssets },
      { defaultSettings },
      { testTrack, PIECES, placedPiece },
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
      },
      await loadBikeAssets(),
      await loadCrowdAssets(),
    );
    const track = testTrack({
      name: 'Surface review',
      laps: 1,
      length: 2000,
      items: ['mud', 'cool', 'grass', 'bump'].map((surface, i) =>
        placedPiece(PIECES.find((p: any) => p.surface === surface).id, 320 + i * 320),
      ),
    });
    const race = testRace(track, 3);
    race.riders.forEach((p: any, i: number) => {
      p.x = 420 + i * 15;
    });
    world.setTrack(track);
    world.mode = 'race';
    const render = () => world.render(1, race, true);
    const pixels = () => {
      const gl = world.renderer.getContext();
      const data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(
        0,
        0,
        gl.drawingBufferWidth,
        gl.drawingBufferHeight,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        data,
      );
      return data;
    };
    render();
    render();
    const clear = pixels();
    world.setWeather('rain');
    render();
    const rain = pixels();
    world.setWeather('snow');
    render();
    const snow = pixels();
    world.setWeather('clear');
    render();
    const restored = pixels();
    const difference = (a: Uint8Array, b: Uint8Array) =>
      a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    world.settings.vfx = { race: true, tracks: true, ambient: true, intensity: 'balanced' };
    const counts: number[] = [],
      draws: number[] = [];
    const cycle = () => {
      for (const quality of ['high', 'low'])
        for (const time of ['morning', 'afternoon', 'night'])
          for (const weather of ['clear', 'rain', 'snow']) {
            world.settings.quality = quality;
            world.applySettings();
            world.setTimeOfDay(time);
            world.setWeather(weather);
            world.render(1, race);
            counts.push(
              world.weatherEffects.rain.geometry.drawRange.count / 2 +
                world.weatherEffects.snow.geometry.drawRange.count,
            );
            draws.push(world.weatherEffects.diagnostics().draws);
          }
    };
    cycle();
    cycle();
    const before = { ...world.renderer.info.memory };
    cycle();
    cycle();
    const after = { ...world.renderer.info.memory };
    world.settings.quality = 'low';
    world.applySettings();
    world.setTimeOfDay('morning');
    world.setWeather('snow');
    render();
    return {
      rainDifference: difference(clear, rain),
      snowDifference: difference(clear, snow),
      restoredDifference: difference(clear, restored),
      before,
      after,
      counts,
      draws,
    };
  });
  expect(result.rainDifference).toBeGreaterThan(2);
  expect(result.snowDifference).toBeGreaterThan(5);
  expect(result.restoredDifference).toBeLessThan(0.01);
  expect(result.after).toEqual(result.before);
  expect(result.counts.every((n) => n <= 512)).toBe(true);
  expect(result.draws.every((n, i) => n === (i % 3 === 0 ? 0 : 1))).toBe(true);
  await page.screenshot({ path: 'test-results/weather-special-surfaces.png' });
  expect(errors).toEqual([]);
});
