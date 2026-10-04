// Review actual simulation states in the game's renderer. No saved game is changed.
import { chromium } from '@playwright/test';
import validator from 'gltf-validator';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = 'assets/track-pieces/loop-prototype/review/integration';
await mkdir(directory, { recursive: true });
const gltf = await validator.validateBytes(new Uint8Array(await readFile('assets/track-pieces/loop-prototype/loop-prototype.glb')), {
  format: 'glb', maxIssues: 100, writeTimestamp: false,
});
if (gltf.issues.numErrors || gltf.issues.numWarnings) throw new Error(JSON.stringify(gltf.issues));
const browser = await chromium.launch({headless: true, args: ['--enable-webgl', '--enable-gpu', '--use-angle=d3d11']});
const errors = [], screenshots = [], states = [];
try {
  const page = await browser.newPage({viewport: {width: 1695, height: 928}});
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => {if (e.type() === 'error') errors.push(e.text());});
  await page.goto('http://127.0.0.1:5173/loop-prototype.html');
  await page.waitForFunction(() => window.__loopPrototype?.ready, undefined, {timeout: 60000});
  await page.locator('#guides').uncheck();
  const scenarios = await page.evaluate(async () => {
    const [{placedPiece, emptyDesign, mapTrack, validateMap}, {createRace}, {move}, geometry, {Input}, {DRIVE}, {WORLD_SCALE}] = await Promise.all([
      import('/src/core/maps.ts'), import('/src/core/racing.ts'), import('/src/core/simulation.ts'), import('/src/core/loop-geometry.ts'),
      import('/src/core/types.ts'), import('/src/core/handling.ts'), import('/src/world-space.ts'),
    ]);
    const review = window.__loopPrototype;
    const origin = (16 - geometry.LOOP_OFFSET) / WORLD_SCALE;
    const design = emptyDesign(); design.laps = 1; design.items = [placedPiece('T', origin)];
    const track = mapTrack(validateMap(design));
    const r = createRace({...review.race.config, track});
    r.countdown = 0; r.phase = 'racing';
    const p = r.riders[0]; p.x = origin + geometry.LOOP_ENTRY_X - DRIVE.normalSpeed; p.progress = p.x;
    p.lane = 3; p.speed = DRIVE.normalSpeed;
    r.riders.slice(1).forEach((other, i) => {other.x = origin + 65; other.progress = other.x; other.lane = i;});
    const initial = structuredClone(r);
    const result = [];
    function snapshot(name) {result.push({name, race: structuredClone(r)});}
    for (let frame = 0; frame < 400; frame++) {
      let input = Input.A;
      if (p.motion.kind === 'loop') {
        const s = geometry.sampleLoop(p.motion.distance + p.speed * 9.5);
        const bias = -0.5 * Math.min(1, Math.max(0, (p.motion.distance / geometry.LOOP_DISTANCE - 0.55) / 0.25));
        const target = geometry.sampleLane(s) + bias * s.lateral[2];
        if (p.lane > target + .015) input |= Input.UP;
        if (p.lane < target - .015) input |= Input.DOWN;
      } else if (p.motion.kind === 'loop-air') {
        const pitch = geometry.wrapAngle(p.tilt);
        if (pitch > .05) input |= Input.RIGHT;
        if (pitch < -.05) input |= Input.LEFT;
        input = (input & ~Input.A) | Input.B;
      }
      r.frame++; r.elapsed++; r.events = []; move(r, p, input);
      const has = name => result.some(s => s.name === name);
      if (p.motion.kind === 'loop') {
        const s = geometry.sampleLoop(p.motion.distance);
        if (!has('entry')) snapshot('entry');
        if (!has('climbing') && s.pitch > 1.25) snapshot('climbing');
        if (!has('inverted') && s.normal[1] < -.99) snapshot('inverted');
        if (!has('descending') && s.pitch > 4.5) snapshot('descending');
      }
      if (!has('boost') && p.motion.kind === 'loop-air' && p.speed > 5) snapshot('boost');
      if (has('boost') && p.motion.kind === 'track') {snapshot('landing'); break;}
    }
    Object.assign(r, structuredClone(initial));
    for (let frame = 0; frame < 400; frame++) {
      const rider = r.riders[0];
      let input = Input.A;
      if (rider.motion.kind === 'loop') {
        const s = geometry.sampleLoop(rider.motion.distance + rider.speed * 9.5);
        const bias = 0.5 * Math.min(1, Math.max(0, (rider.motion.distance / geometry.LOOP_DISTANCE - 0.55) / 0.25));
        const target = geometry.sampleLane(s) + bias * s.lateral[2];
        if (rider.lane > target + .015) input |= Input.UP;
        if (rider.lane < target - .015) input |= Input.DOWN;
      } else if (rider.motion.kind === 'loop-air') {
        const pitch = geometry.wrapAngle(rider.tilt);
        input = Input.B;
        if (pitch > .05) input |= Input.RIGHT;
        if (pitch < -.05) input |= Input.LEFT;
      }
      r.frame++; r.elapsed++; r.events = []; move(r, rider, input);
      const has = name => result.some(s => s.name === name);
      if (!has('boost-lane-2') && rider.motion.kind === 'loop-air' && rider.speed > 5) snapshot('boost-lane-2');
      if (has('boost-lane-2') && rider.motion.kind === 'track') { snapshot('landing-lane-2'); break; }
    }
    Object.assign(r, structuredClone(initial));
    for (let frame = 0; frame < 200; frame++) {
      r.frame++; move(r, r.riders[0], Input.A);
      if (r.riders[0].motion.kind === 'loop-air') {
        for(let air=0;air<8;air++){r.frame++;move(r,r.riders[0],Input.A);}
        snapshot('side-fall'); break;
      }
    }
    review.world.setTrack(track);
    window.__loopScenarios = result;
    return result.map(s => s.name);
  });
  for (const name of scenarios) {
    const state = await page.evaluate(name => {
      const review = window.__loopPrototype, snapshot = window.__loopScenarios.find(s => s.name === name);
      Object.assign(review.race, structuredClone(snapshot.race));
      review.world.bikes.forEach(bike => bike.reset());
      review.world.capture(review.race);
      review.world.render(performance.now() / 1000, review.race, false, 1, false);
      review.setView('game');
      const p = review.race.riders[0];
      return {name, frame: review.race.frame, kind: p.motion.kind, x: p.x, progress: p.progress,
        lane: p.lane + 1, height: p.height, speed: p.speed, tilt: p.tilt, crashes: p.crashes,
        rootQuaternion: review.world.bikes[0].root.quaternion.toArray()};
    }, name);
    states.push(state);
    await page.waitForTimeout(150);
    const path = `${directory}/${name}.png`;
    await page.locator('main').screenshot({path}); screenshots.push(path);
    if (name === 'inverted') {
      await page.locator('[data-view="side"]').click();
      await page.waitForTimeout(150);
      const side = `${directory}/inverted-side.png`;
      await page.locator('main').screenshot({path: side}); screenshots.push(side);
    }
  }
  if (states.length !== 9 || Math.abs(states.find(s => s.name === 'boost')?.lane - 1) > .1 ||
      Math.abs(states.find(s => s.name === 'boost-lane-2')?.lane - 2) > .1 ||
      states.filter(s => s.name.startsWith('landing')).some(s => s.crashes !== 0) || errors.length)
    throw new Error(JSON.stringify({states, errors}));
  const report = {gltf: {errors: gltf.issues.numErrors, warnings: gltf.issues.numWarnings, triangles: gltf.info.totalTriangleCount}, states, screenshots, errors};
  await writeFile(`${directory}/validation.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {await browser.close();}
