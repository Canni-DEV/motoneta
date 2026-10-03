import { expect, test } from '@playwright/test';

test('surface shaders preserve soil, distinguish snow profiles and anchor controls to the course', async ({
  page,
}) => {
  await page.setViewportSize({ width: 480, height: 320 });
  await page.route('http://127.0.0.1:5173/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0}</style><canvas></canvas>',
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
    const [T, { WeatherSurfaces }] = await Promise.all([
      source('/node_modules/three/build/three.module.js'),
      source('/src/weather-surfaces.ts'),
    ]);
    const renderer = new T.WebGLRenderer({
      canvas: document.querySelector('canvas'),
      antialias: false,
    });
    renderer.setSize(480, 320);
    const scene = new T.Scene();
    const camera = new T.OrthographicCamera(-9, 9, 6, -6, 0.1, 100);
    camera.position.set(0, 15, 0);
    camera.up.set(0, 0, -1);
    camera.lookAt(0, 0, 0);
    scene.add(new T.HemisphereLight('#dceef9', '#79654e', 2));
    const light = new T.DirectionalLight('#d7e6ee', 1.5);
    light.position.set(-14, 12, 10);
    scene.add(light);
    const surfaces = new WeatherSurfaces();
    surfaces.setTrack(1234);
    const geometry = new T.PlaneGeometry(100, 100);
    const mesh = new T.Mesh(geometry);
    mesh.rotation.x = -Math.PI / 2;
    scene.add(mesh);
    const whiteMap = new T.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    whiteMap.needsUpdate = true;
    const materials = ['track', 'dirt', 'field', 'mud', 'grass', 'cool', 'bump'].map((profile) =>
      surfaces.register(
        new T.MeshStandardMaterial({
          color: '#a66437',
          roughness: 0.82,
          ...(profile === 'track' ? { map: whiteMap } : {}),
        }),
        { profile },
      ),
    );
    const pixels = () => {
      renderer.render(scene, camera);
      const gl = renderer.getContext(),
        bytes = new Uint8Array(480 * 320 * 4);
      gl.readPixels(0, 0, 480, 320, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
      return bytes;
    };
    const difference = (a: Uint8Array, b: Uint8Array) =>
      a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    const stats = (bytes: Uint8Array) => {
      let r = 0,
        g = 0,
        b = 0,
        squared = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        r += bytes[i];
        g += bytes[i + 1];
        b += bytes[i + 2];
        squared += bytes[i] ** 2;
      }
      const n = bytes.length / 4;
      return {
        red: r / n,
        green: g / n,
        blue: b / n,
        deviation: Math.sqrt(squared / n - (r / n) ** 2),
      };
    };
    const appearances = materials.map((material: any) => {
      mesh.material = material;
      surfaces.update(0, 0);
      const clear = pixels();
      surfaces.update(1, 0);
      const rain = pixels();
      surfaces.update(0, 1);
      const snow = pixels();
      surfaces.update(0, 0);
      const restored = pixels();
      return {
        clear: stats(clear),
        rain: stats(rain),
        snow: stats(snow),
        restored: difference(clear, restored),
      };
    });
    mesh.material = materials[1];
    surfaces.update(0, 1);
    const detailed = pixels();
    surfaces.setDetail('light');
    const reduced = pixels();
    surfaces.update(0, 0);
    const lightClear = pixels();
    surfaces.setDetail('detailed');
    const detailedClear = pixels();
    surfaces.update(0, 1);
    const detailRestored = pixels();
    const anchors = [];
    for (const weather of [
      [1, 0],
      [0, 1],
    ]) {
      surfaces.update(...weather);
      mesh.position.x = 0;
      const fixed = pixels();
      mesh.position.x = 7;
      const movedMesh = pixels();
      mesh.position.x = 0;
      camera.position.x = 1234 * 0.052;
      mesh.position.x = camera.position.x;
      const nextLap = pixels();
      camera.position.x = 0;
      mesh.position.x = 0;
      anchors.push({
        movedMesh: difference(fixed, movedMesh),
        nextLap: difference(fixed, nextLap),
      });
    }
    // A vertical face keeps its base appearance even with a nonuniform model scale.
    mesh.rotation.x = 0;
    mesh.scale.set(2, 3, 1);
    camera.position.set(0, 0, 15);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    surfaces.update(0, 0);
    const wall = pixels();
    surfaces.update(0, 1);
    const snowyWall = pixels();
    const before = { ...renderer.info.memory },
      programs = renderer.info.programs.length;
    for (let i = 0; i < 12; i++) {
      surfaces.setTrack(317 + i * 11);
      surfaces.setDetail(i % 2 ? 'light' : 'detailed');
      surfaces.update(i % 2, 1 - (i % 2));
      pixels();
    }
    const after = { ...renderer.info.memory },
      afterPrograms = renderer.info.programs.length;
    surfaces.dispose();
    materials.forEach((m: any) => m.dispose());
    whiteMap.dispose();
    geometry.dispose();
    renderer.dispose();
    return {
      appearances,
      detailDifference: difference(detailed, reduced),
      detailRestored: difference(detailed, detailRestored),
      clearDetailDifference: difference(lightClear, detailedClear),
      anchors,
      wallDifference: difference(wall, snowyWall),
      before,
      after,
      programs,
      afterPrograms,
    };
  });
  for (const appearance of result.appearances) {
    expect(appearance.rain.red).toBeLessThan(appearance.clear.red);
    expect(appearance.rain.red / appearance.rain.blue).toBeGreaterThan(1.6);
    expect(appearance.restored).toBeLessThan(0.01);
  }
  const [, dirt, field, mud, grass, cool] = result.appearances;
  expect(field.snow.blue).toBeGreaterThan(dirt.snow.blue);
  expect(dirt.snow.blue).toBeGreaterThan(grass.snow.blue + 20);
  expect(grass.snow.blue).toBeGreaterThan(mud.snow.blue + 10);
  expect(mud.snow.blue).toBeGreaterThan(cool.snow.blue + 10);
  expect(dirt.snow.deviation).toBeGreaterThan(3);
  for (const anchor of result.anchors) {
    expect(anchor.movedMesh).toBeLessThan(0.02);
    expect(anchor.nextLap).toBeLessThan(0.02);
  }
  expect(result.wallDifference).toBeLessThan(0.01);
  expect(result.detailDifference).toBeGreaterThan(1);
  expect(result.detailRestored).toBeLessThan(0.01);
  expect(result.clearDetailDifference).toBeLessThan(0.01);
  expect(result.after).toEqual(result.before);
  expect(result.afterPrograms).toBe(result.programs);
  expect(errors).toEqual([]);
});

test('surface detail persists independently of quality and effects and resets to detailed', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('motoneta.settings.v3'))
      localStorage.setItem(
        'motoneta.settings.v3',
        JSON.stringify({
          quality: 'low',
          vfx: { race: true, tracks: true, ambient: true, intensity: 'balanced' },
          volume: 0,
        }),
      );
  });
  await page.goto('/');
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
    await page.locator('[data-action="settings-tab"][data-value="image"]').click();
  };
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('motoneta.settings.v3')!));
  await openSettings();
  await expect(page.locator('#surface-detail')).toHaveValue('detailed');
  await page.locator('#surface-detail').selectOption('light');
  expect(await saved()).toMatchObject({
    surfaceDetail: 'light',
    quality: 'low',
    vfx: { race: true, tracks: true, ambient: true, intensity: 'balanced' },
  });
  await page.reload();
  await openSettings();
  await expect(page.locator('#surface-detail')).toHaveValue('light');
  await page.locator('#quality').selectOption('high');
  expect(await saved()).toMatchObject({
    surfaceDetail: 'light',
    quality: 'high',
    vfx: { race: true, tracks: true, ambient: true, intensity: 'balanced' },
  });
  await page.getByRole('button', { name: 'Restablecer', exact: true }).click();
  await page.locator('[data-action="settings-tab"][data-value="image"]').click();
  await expect(page.locator('#surface-detail')).toHaveValue('detailed');
  expect(await saved()).toMatchObject({
    surfaceDetail: 'detailed',
    quality: 'high',
    vfx: { race: true, tracks: true, ambient: true, intensity: 'balanced' },
  });
});
