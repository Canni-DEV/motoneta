import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

test('eyes follow every vehicle, loop and crash pose; rendering resources settle across switches', async ({ page }) => {
  test.setTimeout(180000);
  await mkdir('tmp/cinematic-review', { recursive: true });
  await page.route('http://127.0.0.1:5173/', route => route.fulfill({
    contentType: 'text/html', body: '<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>',
  }));
  await page.goto('/');
  await page.evaluate(async () => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ World }, { loadVehicleAssets }, { loadCrowdAssets }, { defaultSettings }, { testRace, testTrack, placedPiece },
      { CinematicCamera }, geometry, { defaultVehicleAppearance }, { WORLD_SCALE }] = await Promise.all([
      source('/src/renderer.ts'), source('/src/bike-model.ts'), source('/src/crowd-assets.ts'), source('/src/core/types.ts'),
      source('/tests/race-fixture.ts'), source('/src/cinematic-camera.ts'), source('/src/core/loop-geometry.ts'),
      source('/src/appearance.ts'), source('/src/world-space.ts'),
    ]);
    const race = testRace(testTrack({ length: 4096, items: [placedPiece('T', 512), placedPiece('C', 2200)] }), 1);
    race.phase = 'racing'; race.countdown = 0;
    const world = new World(document.querySelector('canvas')!, { ...structuredClone(defaultSettings), quality: 'low', bloom: false },
      await loadVehicleAssets(), await loadCrowdAssets());
    world.setTrack(race.track); world.mode = 'race'; world.beginRace(race);
    let time = 0;
    const timeline = { events: [], moments: [], poses: [], lapEnds: [10000], lastFrame: 10000, slowMotion: [] };
    const freshCamera = () => { world.cinematic = new CinematicCamera(timeline); world.cinematic.setMode('firstPerson'); };
    const eyes = { position: world.riderView.position.clone(), quaternion: world.riderView.quaternion.clone() };
    const draw = () => {
      world.render(time += 1 / 60, race, false, 1);
      world.renderer.getContext().finish();
      const bike = world.bikes[0]; bike.getRiderViewPose(eyes);
      return { distance: world.cinematic.camera.position.distanceTo(eyes.position),
        direction: world.cinematic.camera.getWorldDirection(eyes.position).toArray(),
        visible: bike.body.visible && bike.riderLayer.visible,
        helmet: bike.rider.getObjectByName('Slot_helmet_core').visible,
        otherHelmet: world.bikes[1].rider.getObjectByName('Slot_helmet_core').visible,
        memory: { ...world.renderer.info.memory } };
    };
    (window as any).cameraReview = {
      show(vehicle: string, quality: string, scenario: string) {
        world.appearances = [defaultVehicleAppearance(vehicle), defaultVehicleAppearance('motocross')];
        world.ensureBikes(2); world.settings.quality = quality; world.applySettings(); world.previous = [];
        world.bikes[0].reset(); freshCamera();
        const rider = race.riders[0];
        Object.assign(rider, { x: 420, lane: 2, height: 0, tilt: 0, speed: 3, grounded: true, recovery: 0,
          invincible: 30, motion: { kind: 'track' }, crashPhase: 'none', crashPhaseAge: 0, crashKind: 'impact',
          crashRollDuration: 40, crashStartTilt: 0 });
        Object.assign(race.riders[1], { x: 440, lane: 1 });
        if (scenario === 'jump' || scenario === 'wheelie') {
          rider.height = scenario === 'jump' ? 35 : 0;
          rider.grounded = scenario !== 'jump'; rider.tilt = scenario === 'jump' ? 0.35 : 0.5;
        }
        if (scenario === 'turn') world.previous = [{ x: rider.x, lane: rider.lane - 0.034, height: rider.height,
          tilt: rider.tilt, quaternion: eyes.quaternion.clone().identity(), crashPhase: 'none', crashPhaseAge: 0 }];
        if (['rolling', 'down', 'mounting'].includes(scenario)) {
          rider.crashPhase = scenario; rider.crashPhaseAge = scenario === 'rolling' ? 9 : scenario === 'down' ? 24 : 16;
          rider.recovery = 40;
        }
        if (scenario === 'underpass') { rider.x = 512 + geometry.LOOP_ENTRY_X + 130; rider.lane = 0; }
        if (scenario === 'lap') rider.x = race.track.length + 80;
        let result;
        for (let i = 0; i < 6; i++) result = draw();
        return result;
      },
      loop(last = 60) {
        const directions = [];
        for (let i = 0; i <= last; i++) {
          const sample = geometry.sampleLoop(geometry.LOOP_DISTANCE * i / 60);
          const lane = geometry.sampleLane(sample), point = geometry.loopPosition(sample, lane);
          Object.assign(race.riders[0], { x: 512 + point[0], height: point[1], lane, tilt: sample.pitch,
            motion: { kind: 'loop', origin: 512, distance: sample.distance }, grounded: true, recovery: 0, crashPhase: 'none' });
          const result = draw(); directions.push({ ...result, pitch: sample.pitch });
        }
        return directions;
      },
      stable() {
        const samples = [];
        for (let round = 0; round < 6; round++) {
          world.setTrack(race.track); world.previous = [];
          for (const mode of ['chase', 'firstPerson', 'drone', 'tripod', 'crowd']) {
            world.cinematic.setMode(mode); draw();
          }
          samples.push({ ...world.renderer.info.memory });
        }
        return samples;
      },
      freeze() {
        const before = world.cinematic.camera.position.toArray().concat(world.cinematic.camera.quaternion.toArray());
        world.render(time += 1 / 60, race, true, 1);
        return { before, after: world.cinematic.camera.position.toArray().concat(world.cinematic.camera.quaternion.toArray()) };
      },
      reduced() { world.settings.reducedMotion = true; world.applySettings(); world.cinematic.setMode('firstPerson'); return draw(); },
      externalLoop(mode: string) {
        world.cinematic.setMode(mode);
        draw();
        const position = world.cinematic.camera.position.clone(), cuts = world.cinematic.cuts.length;
        let drift = 0;
        for (let frame = 0; frame < 12; frame++) {
          draw();
          drift = Math.max(drift, world.cinematic.camera.position.distanceTo(position));
        }
        return { shot: world.cinematic.currentShot,
          position: world.cinematic.camera.position.toArray(), target: world.cinematic.look.toArray(),
          drift, extraCuts: world.cinematic.cuts.length - cuts };
      },
      dispose() { world.dispose(); },
      scale: WORLD_SCALE,
    };
  });
  for (const vehicle of ['motocross', 'motoneta', 'tanque'])
    for (const quality of ['low', 'high']) {
      for (const scenario of ['ride', 'turn', 'wheelie', 'jump', 'rolling', 'down', 'mounting', 'underpass', 'lap']) {
        const result = await page.evaluate(args => (window as any).cameraReview.show(...args), [vehicle, quality, scenario]);
        expect(result.distance).toBeLessThan(1e-6);
        expect(result.visible).toBe(true); expect(result.helmet).toBe(false); expect(result.otherHelmet).toBe(true);
        if (scenario !== 'turn') await page.screenshot({ path: `tmp/cinematic-review/${vehicle}-${quality}-${scenario}.png` });
      }
      const loop = await page.evaluate(() => (window as any).cameraReview.loop());
      expect(loop.every((frame: any) => frame.distance < 1e-6 && frame.visible && frame.direction.every(Number.isFinite))).toBe(true);
      expect(loop.some((frame: any) => frame.direction[0] < -0.5)).toBe(true);
      if (vehicle === 'motocross') {
        await page.evaluate(() => (window as any).cameraReview.loop(30));
        await page.screenshot({ path: `tmp/cinematic-review/loop-inverted-${quality}.png` });
        for (const mode of ['chase', 'front', 'ground', 'drone', 'mounted', 'tripod', 'crowd']) {
          const external = await page.evaluate(mode => (window as any).cameraReview.externalLoop(mode), mode);
          expect(external.shot).toBe(mode);
          expect(Math.abs(external.position[2]), JSON.stringify(external)).toBeLessThanOrEqual(8.5);
          expect(external.drift, JSON.stringify(external)).toBeLessThan(1e-6);
          expect(external.extraCuts).toBe(0);
        }
      }
      const frozen = await page.evaluate(() => (window as any).cameraReview.freeze());
      expect(frozen.after).toEqual(frozen.before);
    }
  const resources = await page.evaluate(() => (window as any).cameraReview.stable());
  for (const sample of resources.slice(2)) expect(sample).toEqual(resources[1]);
  const reduced = await page.evaluate(() => (window as any).cameraReview.reduced());
  expect(reduced.direction[0]).toBeGreaterThan(0.98);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.evaluate(() => (window as any).cameraReview.show('motocross', 'low', 'ride'));
  await page.screenshot({ path: 'tmp/cinematic-review/mobile-reduced.png' });
  await page.evaluate(() => (window as any).cameraReview.dispose());
});
