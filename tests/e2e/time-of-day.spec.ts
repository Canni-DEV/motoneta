import { expect, test } from '@playwright/test';

test('night uses actual light, respects budgets and preserves resources across switches and laps', async ({
  page,
}) => {
  await page.route('http://127.0.0.1:5173/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>',
    }),
  );
  await page.goto('/');
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  const result = await page.evaluate(async () => {
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
        vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
      },
      await loadBikeAssets(),
      await loadCrowdAssets(),
    );
    const track = getTrack(0),
      race = testRace(track, 3);
    world.setTrack(track);
    world.mode = 'race';
    let clock = 0;
    const render = (paused = false) => {
      clock += 0.05;
      world.render(clock, race, paused);
    };
    const pixels = () => {
      const gl = world.renderer.getContext(),
        size = gl.drawingBufferWidth * gl.drawingBufferHeight;
      const data = new Uint8Array(size * 4);
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
    const brightness = (data: Uint8Array) => {
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += data[i] + data[i + 1] + data[i + 2];
      return sum / (data.length / 4) / 3;
    };
    world.setTimeOfDay('night');
    render();
    const lit = brightness(pixels());
    world.scene.traverse((o: any) => {
      if (o.isSpotLight || o.name.endsWith('floodlight')) o.intensity = 0;
    });
    world.renderer.render(world.scene, world.camera);
    const unlit = brightness(pixels());
    // Warm every combination before comparing GPU resource counts.
    const observations: {
      quality: string;
      time: string;
      lights: number;
      localLights: number;
      shadows: number;
    }[] = [];
    const cycle = () => {
      for (const quality of ['high', 'low'])
        for (const time of ['morning', 'afternoon', 'night']) {
          world.settings.quality = quality;
          world.applySettings();
          world.setTimeOfDay(time);
          render();
          const active: any[] = [];
          world.scene.traverseVisible((o: any) => {
            if ((o.isSpotLight || o.name.endsWith('floodlight')) && o.intensity > 0) active.push(o);
          });
          observations.push({
            quality,
            time,
            lights: active.length,
            localLights: active.filter((o) => o.name === 'Local track floodlight').length,
            shadows: active.filter((o) => o.castShadow).length,
          });
        }
    };
    cycle();
    cycle();
    const memory = { ...world.renderer.info.memory };
    for (let i = 0; i < 3; i++) cycle();
    const afterSwitches = { ...world.renderer.info.memory };
    world.settings.quality = 'low';
    world.applySettings();
    let warmedLaps;
    for (let lap = 0; lap < 60; lap++) {
      race.riders.forEach((p: any, i: number) => {
        p.x = lap * track.length + 80 + i * 7;
      });
      render();
      if (lap === 29) warmedLaps = { ...world.renderer.info.memory };
    }
    const afterLaps = { ...world.renderer.info.memory };
    const frozen = world.environment.diagnostics();
    render(true);
    return {
      lit,
      unlit,
      memory,
      afterSwitches,
      warmedLaps,
      afterLaps,
      observations,
      frozen,
      held: world.environment.diagnostics(),
    };
  });
  expect(result.lit).toBeGreaterThan(result.unlit + 3);
  expect(result.afterSwitches).toEqual(result.memory);
  expect(result.afterLaps).toEqual(result.warmedLaps);
  for (const o of result.observations) {
    expect(o.lights).toBe(o.time === 'morning' ? 0 : 6 + o.localLights);
    expect(o.localLights).toBeLessThanOrEqual(8);
    expect(o.localLights > 0).toBe(o.time === 'night');
    expect(o.shadows).toBe(o.time === 'night' && o.quality === 'high' ? 1 : 0);
  }
  expect(errors).toEqual([]);
  expect(result.held).toEqual(result.frozen);
});
