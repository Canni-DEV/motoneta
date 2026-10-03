import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  await page.route('http://127.0.0.1:5173/', (route) => route.fulfill({
    contentType: 'text/html',
    body: '<style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>',
  }));
  await page.goto('/');
  await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [{ World }, { loadBikeAssets }, { loadCrowdAssets }, { defaultSettings },
      { testRace, testTrack }, { defaultAppearance }] = await Promise.all([
      source('/src/renderer.ts'), source('/src/bike-model.ts'), source('/src/crowd-assets.ts'),
      source('/src/core/types.ts'), source('/tests/race-fixture.ts'), source('/src/appearance.ts'),
    ]);
    const world = new World(document.querySelector('canvas'), {
      ...defaultSettings, quality: 'low', cameraShake: false,
      vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
    }, await loadBikeAssets(), await loadCrowdAssets());
    const race = testRace(testTrack({ laps: 3 }), 2);
    race.phase = 'racing';
    race.riders[0].x = 300;
    race.riders[1].x = race.riders[2].x = 450;
    const colors = ['#147ca8', '#7a45bf', '#38a556', '#e9bf39', '#d65482'];
    const ghosts = colors.map((_, i) => ({ ...structuredClone(race.riders[0]), id: 3 + i }));
    race.riders.push(...ghosts);
    world.ensureBikes(race.riders.length);
    world.ghostStart = 3;
    world.appearances = [race.config.player.appearance, ...race.config.bots.map((b: any) => b.appearance),
      ...colors.map((color, i) => {
        const appearance = defaultAppearance(color);
        appearance.parts.helmet = ['core', 'sprint', 'trail'][i % 3];
        return appearance;
      })];
    world.setTrack(race.track);
    world.beginRace(race);
    world.mode = 'race';
    let clock = 0;
    const render = (dt = 1 / 60, paused = false) => world.render(clock += dt, race, paused);
    const opacities = () => world.bikes.slice(3).map((bike: any) => bike.ghostOpacity);
    (window as any).ghostFixture = { world, race, ghosts, render, opacities };
    render();
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`five ghosts fade smoothly without losing colors or resources at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await fixture(page);
    const transitions = await page.evaluate(() => {
      const { world, race, ghosts, render, opacities } = (window as any).ghostFixture;
      const initial = opacities();
      ghosts.forEach((g: any) => { g.x = 450; }); // Overlap each other and the bots, away from the player.
      render(0.125);
      const recovering = opacities();
      render(0.125);
      const separated = opacities();
      ghosts.forEach((g: any) => { g.x = race.riders[0].x + race.track.length; });
      render(0.075); // The track wrap puts ghosts over the player again.
      const fading = opacities();
      render(1, true);
      const paused = opacities();
      world.settings.quality = 'high'; world.applySettings();
      render(1, true);
      const changedQuality = opacities();
      render(0.075);
      const overlapping = opacities();
      world.settings.reducedMotion = true; world.applySettings();
      ghosts.forEach((g: any) => { g.x = 450; });
      render();
      const reduced = opacities();
      world.setTrack(race.track); world.beginRace(race);
      ghosts.forEach((g: any) => { g.x = 300; });
      render();
      const reset = opacities();
      return { initial, recovering, separated, fading, paused, changedQuality, overlapping, reduced, reset };
    });
    for (const [key, expected] of Object.entries({
      initial: 0.1, recovering: 0.225, separated: 0.35, fading: 0.225, paused: 0.225,
      changedQuality: 0.225, overlapping: 0.1, reduced: 0.35, reset: 0.1,
    })) for (const opacity of transitions[key as keyof typeof transitions]) expect(opacity).toBeCloseTo(expected);

    for (const quality of ['low', 'high']) for (const time of ['morning', 'night']) {
      const resources = await page.evaluate(({ quality, time }) => {
        const { world, race, ghosts, render, opacities } = (window as any).ghostFixture;
        world.settings.quality = quality; world.applySettings();
        world.setTimeOfDay(time);
        for (const rider of [race.riders[0], ...ghosts]) {
          rider.x = 300; rider.lane = 2; rider.height = 0; rider.tilt = 0;
          rider.crashPhase = 'none'; rider.recovery = 0;
        }
        render();
        const memory = { ...world.renderer.info.memory }, calls = world.renderer.info.render.calls;
        const owned = world.bikes.map((b: any) => b.ownedMaterials.length);
        for (let frame = 0; frame < 20; frame++) {
          ghosts.forEach((g: any) => { g.x = frame % 2 ? 300 : 450; });
          render();
        }
        ghosts.forEach((g: any) => { g.x = 300; }); render();
        const paint = world.bikes.slice(3).map((b: any) => {
          const material = [...b.ghostMaterials.values()].find((m: any) => m.name === 'TeamPaint');
          return `#${material.color.getHexString()}`;
        });
        const lights = world.bikes.slice(3).map((b: any) => ({
          intensity: b.headlight.intensity,
          emissive: [...b.ghostMaterials.values()].filter((m: any) => /^Lamp/.test(m.name)).map((m: any) => m.emissiveIntensity),
        }));
        return { memory, after: { ...world.renderer.info.memory }, calls, afterCalls: world.renderer.info.render.calls,
          owned, afterOwned: world.bikes.map((b: any) => b.ownedMaterials.length), paint, lights, opacities: opacities() };
      }, { quality, time });
      expect(resources.after).toEqual(resources.memory);
      expect(resources.afterCalls).toBe(resources.calls);
      expect(resources.afterOwned).toEqual(resources.owned);
      expect(resources.paint).toEqual(['#147ca8', '#7a45bf', '#38a556', '#e9bf39', '#d65482']);
      for (const light of resources.lights) {
        expect(light.intensity).toBe(0);
        expect(light.emissive.every((intensity: number) => intensity === 0)).toBe(true);
      }
      for (const opacity of resources.opacities) expect(opacity).toBeCloseTo(0.1);
      await page.screenshot({ path: info.outputPath(`overlap-${quality}-${time}.png`) });
      await page.evaluate(() => {
        const { world, race, ghosts, render } = (window as any).ghostFixture;
        world.zoomBy(-600);
        for (const rider of [race.riders[0], ...ghosts]) { rider.height = 24; rider.tilt = 0.65; rider.grounded = false; }
        render();
      });
      await page.screenshot({ path: info.outputPath(`jump-${quality}-${time}.png`) });
      const crashOpacities = await page.evaluate(() => {
        const { world, race, ghosts, render, opacities } = (window as any).ghostFixture;
        world.resetZoom();
        for (const rider of [race.riders[0], ...ghosts]) {
          rider.height = 0; rider.tilt = 0; rider.grounded = true;
          rider.recovery = 20; rider.crashPhase = 'down'; rider.crashPhaseAge = 30;
        }
        render();
        return opacities();
      });
      for (const opacity of crashOpacities) expect(opacity).toBeCloseTo(0.1);
      await page.screenshot({ path: info.outputPath(`crash-${quality}-${time}.png`) });
    }
    expect(errors).toEqual([]);
    await page.evaluate(() => (window as any).ghostFixture.world.dispose());
  });
}
