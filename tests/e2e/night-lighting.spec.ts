import { expect, test } from '@playwright/test';

test('night floodlights illuminate fixed pools and cast subdued shadows', async ({
  page,
}, info) => {
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
  const result = await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [
      THREE,
      { World },
      { loadBikeAssets },
      { loadCrowdAssets },
      { defaultSettings },
      { testTrack },
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
    const track = testTrack({ name: 'Night lighting', laps: 3, items: [] });
    const race = testRace(track, 0);
    race.riders = race.riders.slice(0, 1);
    world.setTrack(track);
    world.mode = 'race';
    world.setTimeOfDay('night');
    let clock = 0;
    const render = (focus: number) => {
      race.riders[0].x = focus / 0.052;
      world.render((clock += 1 / 60), race, true);
    };
    render(20);
    const lamps = world.scene.children.filter((o: any) => o.name === 'Local track floodlight');
    const width = world.stadium.sectorWidth,
      x = width * 1.5;
    const gl = world.renderer.getContext();
    const pixel = new Uint8Array(3 * 3 * 4);
    const sample = (x: number, z: number) => {
      const ndc = new THREE.Vector3(x, 0.003, z).project(world.camera);
      if (Math.abs(ndc.x) > 0.98 || Math.abs(ndc.y) > 0.98)
        throw new Error('Lighting sample outside view');
      const sx = Math.round(((ndc.x + 1) / 2) * gl.drawingBufferWidth);
      const sy = Math.round(((ndc.y + 1) / 2) * gl.drawingBufferHeight);
      gl.readPixels(sx - 1, sy - 1, 3, 3, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      let sum = 0;
      for (let i = 0; i < pixel.length; i += 4) sum += pixel[i] + pixel[i + 1] + pixel[i + 2];
      return sum / 27;
    };
    const pools = [];
    for (const quality of ['high', 'low']) {
      world.settings.quality = quality;
      world.applySettings();
      for (const focus of [16, 20, 28]) {
        render(focus);
        const on = [sample(x, -0.7), sample(x + width / 2, -0.7)];
        lamps.forEach((light: any) => (light.intensity = 0));
        world.composer.render();
        const off = [sample(x, -0.7), sample(x + width / 2, -0.7)];
        pools.push({ quality, focus, center: on[0] - off[0], between: on[1] - off[1] });
      }
    }
    world.settings.quality = 'high';
    world.applySettings();
    render(20);
    const shadow = world.scene.getObjectByName('Track floodlight').shadow;
    const shadowSample = () => {
      let sum = 0;
      for (const dx of [-0.3, 0, 0.3]) for (const z of [0.1, 0.25, 0.4]) sum += sample(x + dx, z);
      return sum / 9;
    };
    const soft = shadowSample();
    shadow.intensity = 0;
    world.composer.render();
    const none = shadowSample();
    shadow.intensity = 1;
    world.composer.render();
    const hard = shadowSample();
    shadow.intensity = 0.28;
    // Show the effect even without bloom; the physical light and corona remain visible.
    world.composer.render();
    return { pools, shadow: { soft: none - soft, hard: none - hard } };
  });
  await info.attach('night-lighting-measurements', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: info.outputPath('night-without-bloom.png') });
  for (const quality of ['high', 'low']) {
    const samples = result.pools.filter((s) => s.quality === quality);
    for (const sample of samples) {
      expect(sample.center).toBeGreaterThan(12);
      expect(sample.center).toBeGreaterThan(sample.between * 1.3);
    }
    // Pixel rounding/road texture can vary slightly, but the light cannot follow the rider.
    expect(
      Math.max(...samples.map((s) => s.center)) - Math.min(...samples.map((s) => s.center)),
    ).toBeLessThan(3);
  }
  expect(result.shadow.hard).toBeGreaterThan(2);
  expect(result.shadow.soft).toBeGreaterThan(0);
  expect(result.shadow.soft).toBeLessThan(result.shadow.hard * 0.45);
  expect(errors).toEqual([]);
});
