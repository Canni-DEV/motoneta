import { expect, test } from '@playwright/test';

test('recovering riders blink without removing headlights or compiling shaders', async ({ page }, info) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.route('http://127.0.0.1:5173/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>',
    }),
  );
  await page.goto('/');
  const measurements = await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [{ World }, { loadBikeAssets }, { loadCrowdAssets }, { defaultSettings, HZ }, { testRace }] =
      await Promise.all([
        source('/src/renderer.ts'),
        source('/src/bike-model.ts'),
        source('/src/crowd-assets.ts'),
        source('/src/core/types.ts'),
        source('/tests/race-fixture.ts'),
      ]);
    const world = new World(
      document.querySelector('canvas'),
      { ...structuredClone(defaultSettings), reducedMotion: false, cameraShake: false },
      await loadBikeAssets(),
      await loadCrowdAssets(),
    );
    const race = testRace(undefined, 5);
    race.phase = 'racing';
    race.countdown = 0;
    race.riders.forEach((rider: any, i: number) => {
      rider.x = 800 + i * 12;
      rider.lane = i % 4;
      rider.speed = 0;
    });
    world.setTrack(race.track);
    world.mode = 'race';
    world.beginRace(race);
    const gl = world.renderer.getContext();
    let shaders = 0;
    const compile = gl.compileShader.bind(gl);
    gl.compileShader = (shader: WebGLShader) => {
      shaders++;
      compile(shader);
    };
    const render = (off = false, paused = false) => {
      // Select a new frame within the requested half of the real blink cycle.
      do race.frame++;
      while ((Math.floor((race.frame / HZ) * 12) % 2 === 1) !== off);
      const start = performance.now();
      world.render(race.frame / HZ, race, paused, 1);
      gl.finish();
      return performance.now() - start;
    };
    const results = [];
    try {
      for (const quality of ['high', 'low']) {
        world.settings.quality = quality;
        world.applySettings();
        for (const timeOfDay of ['morning', 'afternoon', 'night']) {
          world.setTimeOfDay(timeOfDay);
          race.riders.forEach((rider: any) => (rider.invincible = 0));
          for (let i = 0; i < 8; i++) render();
          const programs = world.renderer.info.programs.length;
          const initialShaders = shaders;
          // Cover one through five bots, and then the player as well, entering and leaving recovery.
          for (const count of [1, 2, 3, 4, 5, 6, 5, 3, 1, 0]) {
            race.riders.forEach((rider: any, i: number) => {
              rider.invincible = (i === 0 ? count === 6 : i <= count) ? 90 : 0;
            });
            for (const off of [true, false]) {
              const milliseconds = render(off);
              const bikes = world.bikes.slice(0, 6);
              let headlights = 0;
              world.scene.traverseVisible((object: any) => {
                if (bikes.some((bike: any) => bike.headlight === object)) headlights++;
              });
              results.push({
                quality,
                timeOfDay,
                count,
                off,
                hidden: bikes.filter((bike: any) => !bike.body.visible).length,
                roots: bikes.filter((bike: any) => bike.root.visible).length,
                headlights,
                newPrograms: world.renderer.info.programs.length - programs,
                newShaders: shaders - initialShaders,
                milliseconds,
              });
            }
          }
        }
      }
    } finally {
      world.dispose();
    }
    return results;
  });
  await info.attach('crash-lighting-measurements', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  for (const row of measurements) {
    expect(row.hidden).toBe(row.off ? row.count : 0);
    expect(row.roots).toBe(6);
    expect(row.headlights).toBe(row.timeOfDay === 'morning' ? 0 : 6);
    expect(row.newPrograms).toBe(0);
    expect(row.newShaders).toBe(0);
  }
  expect(errors).toEqual([]);
});
