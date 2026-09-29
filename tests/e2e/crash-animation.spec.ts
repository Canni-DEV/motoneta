import { expect, test } from '@playwright/test';

test('steering and detached recovery render on desktop and mobile in both qualities', async ({ page }) => {
  test.setTimeout(180000);
  await page.route('http://127.0.0.1:5173/', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>' }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [{ World }, { loadBikeAssets }, { loadCrowdAssets }, { defaultSettings }, { testRace }, { heightAt }] =
      await Promise.all([
        source('/src/renderer.ts'), source('/src/bike-model.ts'), source('/src/crowd-assets.ts'),
        source('/src/core/types.ts'), source('/tests/race-fixture.ts'), source('/src/core/tracks.ts'),
      ]);
    const race = testRace();
    race.phase = 'racing';
    race.countdown = 0;
    const p = race.riders[0];
    p.x = 500;
    p.lane = 2;
    p.height = heightAt(race.track, p.x, p.lane);
    const world = new World(document.querySelector('canvas')!,
      { ...structuredClone(defaultSettings), quality: 'high', bloom: false, vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' } },
      await loadBikeAssets(), await loadCrowdAssets());
    world.setTrack(race.track);
    world.mode = 'race';
    world.beginRace(race);
    (window as any).__animationReview = {
      show(quality: 'high' | 'low', kind: 'steer' | 'down') {
        world.settings.quality = quality;
        world.applySettings();
        if (kind === 'steer') {
          p.crashPhase = 'none'; p.recovery = 0; p.speed = 3;
          world.bikes[0].reset();
          world.previous = [{ x: p.x, lane: p.lane - 0.034, height: p.height, tilt: p.tilt,
            crashPhase: 'none', crashPhaseAge: 0 }];
        } else {
          p.crashPhase = 'down'; p.crashPhaseAge = 24; p.crashAge = 64;
          p.crashKind = 'impact'; p.crashRollDuration = 40; p.crashStartTilt = 0;
          p.recovery = 66; p.speed = 0;
          world.previous = [{ x: p.x, lane: p.lane, height: p.height, tilt: p.tilt,
            crashPhase: 'down', crashPhaseAge: 24 }];
        }
        for (let i = 1; i <= 22; i++) world.render(i / 60, race, false, 1);
        const bike = world.bikes[0];
        return {
          steer: bike.variants[quality].getObjectByName('Handlebar')!.rotation.y,
          lean: bike.body.rotation.x,
          separation: bike.riderLayer.position.distanceTo(bike.body.position),
        };
      },
      dispose() { world.dispose(); },
    };
  });
  for (const mobile of [false, true]) {
    await page.setViewportSize(mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 });
    for (const quality of ['high', 'low'] as const) {
      const steering = await page.evaluate((q) => (window as any).__animationReview.show(q, 'steer'), quality);
      expect(steering.steer).toBeLessThan(-0.15);
      expect(steering.lean).toBeGreaterThan(0.09);
      await page.screenshot({ path: `test-results/steer-${mobile ? 'mobile' : 'desktop'}-${quality}.png` });
      const down = await page.evaluate((q) => (window as any).__animationReview.show(q, 'down'), quality);
      expect(down.separation).toBeGreaterThan(0.8);
      await page.screenshot({ path: `test-results/crash-${mobile ? 'mobile' : 'desktop'}-${quality}.png` });
    }
  }
  await page.evaluate(() => (window as any).__animationReview.dispose());
});
