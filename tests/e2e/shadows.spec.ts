import { expect, test } from '@playwright/test';

test('ramps keep complete shadows while approaching; the stadium fits every lighting view', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
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
      THREE,
      { World },
      { loadBikeAssets },
      { loadCrowdAssets },
      { defaultSettings },
      { testTrack, placedPiece },
      { testRace },
    ] = await Promise.all([
      source('/node_modules/three/build/three.module.js'),
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
        quality: 'high',
        vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
        bloom: false,
        cameraShake: false,
        reducedMotion: true,
      },
      await loadBikeAssets(),
      await loadCrowdAssets(),
    );
    const track = testTrack({
      name: 'Shadow regression',
      laps: 3,
      length: 640 + 18 * (72 + placedPiece('C', 0).length),
      items: Array.from({ length: 18 }, (_, i) =>
        placedPiece('C', 392 + i * (72 + placedPiece('C', 0).length)),
      ),
    });
    const race = testRace(track, 0);
    world.setTrack(track);
    world.mode = 'race';
    (window as any).shadows = { world, race, track, THREE, time: 0 };
  });

  const contrasts = await page.evaluate(() => {
    const f = (window as any).shadows,
      { world, race, THREE } = f;
    const ramp = world.pieces[4],
      base = ramp.base;
    world.setTimeOfDay('afternoon');
    const result = [];
    for (const weather of ['clear', 'rain', 'snow']) {
      world.setWeather(weather);
      for (const distance of [20.5, 17, 10]) {
        race.riders[0].x = (base - distance) / 0.052;
        world.render((f.time += 1 / 60), race, true);
        const gl = world.renderer.getContext();
        const sample = () => {
          const values: number[] = [];
          const data = new Uint8Array(3 * 3 * 4);
          for (const dx of [-0.9, -0.6, -0.3])
            for (const z of [-1.5, -0.5, 0.5]) {
              const ndc = new THREE.Vector3(base + dx, 0.003, z).project(world.camera);
              if (Math.abs(ndc.x) > 0.99 || Math.abs(ndc.y) > 0.99)
                throw new Error('Shadow sample outside view');
              const x = Math.round(((ndc.x + 1) / 2) * gl.drawingBufferWidth);
              const y = Math.round(((ndc.y + 1) / 2) * gl.drawingBufferHeight);
              gl.readPixels(x - 1, y - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, data);
              let brightness = 0;
              for (let i = 0; i < data.length; i += 4)
                brightness += data[i] + data[i + 1] + data[i + 2];
              values.push(brightness / 27);
            }
          return values;
        };
        const shadowed = sample();
        ramp.group.traverse((o: any) => {
          if (o.isMesh) o.castShadow = false;
        });
        world.composer.render();
        const unshadowed = sample();
        ramp.group.traverse((o: any) => {
          if (o.isMesh) o.castShadow = true;
        });
        result.push({
          weather,
          distance,
          contrast:
            unshadowed.reduce((sum: number, n: number, i: number) => sum + n - shadowed[i], 0) /
            shadowed.length,
        });
      }
    }
    world.setWeather('clear');
    race.riders[0].x = (base - 20.5) / 0.052;
    world.render((f.time += 1 / 60), race, true);
    return result;
  });
  await info.attach('shadow-contrast', {
    body: JSON.stringify(contrasts, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('afternoon-shadows.png') });
  for (const weather of ['clear', 'rain', 'snow']) {
    const samples = contrasts.filter((s) => s.weather === weather);
    expect(Math.min(...samples.map((s) => s.contrast))).toBeGreaterThan(5);
    expect(samples[0].contrast / samples[2].contrast).toBeGreaterThan(0.8);
    expect(samples[0].contrast / samples[2].contrast).toBeLessThan(1.2);
  }

  // Exercise the real render order, moving instances, quality switches and sector recycling.
  for (const viewport of [
    { width: 1920, height: 480 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const result = await page.evaluate(() => {
      const f = (window as any).shadows,
        { world, race, track, THREE } = f;
      let checked = 0;
      const failures: string[] = [];
      for (const time of ['morning', 'afternoon', 'night'])
        for (const zoom of [1, 5])
          for (const lap of [0, 7]) {
            world.setTimeOfDay(time);
            world.zoomTarget = world.camera.zoom = zoom;
            race.riders[0].x = 650 + lap * track.length;
            world.render((f.time += 1 / 60), race, true);
            const light = world.scene.children.find(
              (o: any) => o.isDirectionalLight && o.castShadow,
            );
            const point = new THREE.Vector3();
            const check = (p: any, name: string) => {
              const ndc = p.clone().project(world.camera);
              if (Math.abs(ndc.x) > 0.98 || Math.abs(ndc.y) > 0.98 || Math.abs(ndc.z) > 1) return;
              const uv = p.clone().applyMatrix4(light.shadow.matrix);
              if (Math.min(uv.x, uv.y, uv.z) <= 0 || Math.max(uv.x, uv.y, uv.z) >= 1)
                failures.push(`${time}/${zoom}/${lap}: ${name} outside shadow map`);
              checked++;
            };
            for (const p of world.pieces) {
              const bounds = p.bounds.clone().translate(p.group.position);
              for (const x of [bounds.min.x, bounds.max.x])
                for (const y of [bounds.min.y, bounds.max.y])
                  for (const z of [bounds.min.z, bounds.max.z]) {
                    point.set(x, y, z);
                    const ndc = point.clone().project(world.camera);
                    if (Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && !p.group.visible)
                      failures.push('Visible track piece was culled');
                    check(point, 'track');
                  }
            }
            for (const s of world.stadium.diagnostics().sectors) {
              check(point.set(s.x + world.stadium.sectorWidth / 2, 7.85, -5.65), 'floodlight');
              check(point.set(s.x + world.stadium.sectorWidth / 2, 4.65, -14.8), 'rear railing');
              check(point.set(s.x + world.stadium.sectorWidth / 2, 0, 4.3), 'walkway');
            }
          }
      world.settings.quality = 'low';
      world.applySettings();
      world.render((f.time += 1 / 60), race, true);
      const lowShadows = world.scene.children.filter((o: any) => o.isLight && o.castShadow).length;
      world.settings.quality = 'high';
      world.applySettings();
      world.render((f.time += 1 / 60), race, true);
      return { checked, failures, lowShadows };
    });
    expect(result.failures).toEqual([]);
    expect(result.checked).toBeGreaterThan(30);
    expect(result.lowShadows).toBe(0);
    await page.screenshot({ path: info.outputPath(`night-${viewport.width}.png`) });
  }
  expect(errors).toEqual([]);
});
