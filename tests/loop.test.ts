import { describe, expect, it } from 'vitest';
import { emptyDesign, generateMap, generatorDefaults, mapTrack, placedPiece, validateMap } from '../src/core/maps';
import { heightAt } from '../src/core/tracks';
import { move, fingerprint } from '../src/core/simulation';
import { stepRace, completeRace, raceResult, isFinished } from '../src/core/racing';
import { appendInput, newRecording, Playback, validateRecording } from '../src/core/recording';
import { DRIVE } from '../src/core/handling';
import { LOOP_DISTANCE, LOOP_ENTRY_X, LOOP_EXIT_X, LOOP_SAMPLES, LOOP_WIDTH, LOOP_LENGTH, LOOP_APPROACH, LOOP_RUNOUT, maximumLoops, sampleLane, sampleLoop, loopPosition, loopSupportMargin, wrapAngle, add, mul } from '../src/core/loop-geometry';
import { LOOP_STEERING, MAX_SPEED, ridersTouch, roadImpact } from '../src/core/loop-physics';
import { HZ, Input, type Race } from '../src/core/types';
import { testRace } from './race-fixture';
const origin = 512;
function live(loops = true) {
  const d = emptyDesign();
  d.length = 4096;
  d.laps = 1;
  d.items = loops ? [placedPiece('T', origin)] : [];
  const r = testRace(mapTrack(validateMap(d)), 0);
  r.countdown = 0;
  r.phase = 'racing';
  const p = r.riders[0];
  p.x = origin + LOOP_ENTRY_X - DRIVE.normalSpeed;
  p.progress = p.x;
  p.speed = DRIVE.normalSpeed;
  p.lane = 3;
  return r;
}
// Test driver emits only buttons. It never writes lane, speed, position or route state.
export function loopButtons(r: Race, motor: number = Input.B) {
  const p = r.riders[0];
  let buttons = motor;
  if (p.motion.kind === 'loop') {
    const target = sampleLane(sampleLoop(p.motion.distance + p.speed * 9.5));
    if (p.lane > target + 0.015)
      buttons |= Input.UP;
    if (p.lane < target - 0.015)
      buttons |= Input.DOWN;
  }
  else if (p.motion.kind === 'loop-air') {
    const error = wrapAngle(p.tilt);
    if (error > 0.05)
      buttons |= Input.RIGHT;
    if (error < -0.05)
      buttons |= Input.LEFT;
  }
  return buttons;
}
function tick(r: Race, buttons: number) { r.frame++; r.elapsed++; r.events = []; move(r, r.riders[0], buttons); }
function complete(motor: number) {
  const r = live(), p = r.riders[0];
  let reached = false, exitLane = -1, exitSpeed = 0, minMargin = 1;
  for (let i = 0; i < 450; i++) {
    const before = p.motion.kind;
    tick(r, loopButtons(r, motor));
    if (p.motion.kind === 'loop')
      minMargin = Math.min(minMargin, loopSupportMargin(sampleLoop(p.motion.distance),p.lane));
    if (before === 'loop' && (p.motion as Race['riders'][number]['motion']).kind === 'loop-air') {
      exitLane = p.lane;
      exitSpeed = p.speed;
      reached = p.speed > 5;
      break;
    }
  }
  return { r, reached, exitLane, exitSpeed, minMargin };
}
describe('loop route and driving', () => {
  it.each([Input.A, Input.B])('completes with manual input and motor %s', motor => {
    const result = complete(motor);
    expect(result.reached).toBe(true);
    expect(result.exitLane).toBeLessThan(0.5);
    expect(result.exitSpeed).toBeGreaterThan(DRIVE.turboSpeed + 1);
    expect(LOOP_STEERING).toBeLessThanOrEqual(0.034 * 1.5);
    expect(result.minMargin).toBeGreaterThan(0.01);
  });
  it.each([
    { motor: Input.A, first: 51, last: 78 },
    { motor: Input.B, first: 48, last: 71 },
  ])('accepts a broad manual steering start window with motor $motor', ({ motor, first, last }) => {
    // Only hold UP after the selected contact frame; no route-following controller.
    for (let start = first; start <= last; start++) {
      const r = live(), p = r.riders[0];
      let contactFrame = 0, reached = false;
      for (let frame = 0; frame < 300; frame++) {
        const before = p.motion;
        const steering = before.kind === 'loop' && contactFrame++ >= start ? Input.UP : 0;
        tick(r, motor | steering);
        if (before.kind === 'loop' && p.motion.kind === 'loop-air') {
          reached = before.distance >= LOOP_DISTANCE;
          break;
        }
      }
      expect(reached, `steering starts at contact frame ${start}`).toBe(true);
      expect(p.lane).toBe(0);
      expect(p.speed).toBeGreaterThan(DRIVE.turboSpeed + 1);
      expect(p.crashes).toBe(0);
    }
  });
  it('supports a tire near the real ribbon edge and still drops a rider outside it', () => {
    const r = live(), p = r.riders[0];
    p.lane = 3 - 0.47;
    tick(r, Input.A);
    tick(r, Input.A);
    expect(p.motion.kind).toBe('loop');
    expect(p.lane).toBeCloseTo(3 - 0.47, 2);
    p.lane = 3 - 0.51;
    tick(r, Input.A);
    expect(p.motion.kind).toBe('loop-air');
    expect(p.recovery).toBe(0);
    expect(p.speed).toBeLessThan(DRIVE.turboSpeed + 1);
  });
  it('supports the widened upper ribbon while retaining falls past its actual edge', () => {
    const r = live(), p = r.riders[0];
    const s = LOOP_SAMPLES.find(s => s.normal[1] < -0.99)!;
    p.lane = sampleLane(s) + 0.75 * s.lateral[2];
    const position = loopPosition(s, p.lane);
    p.x = origin + position[0];
    p.height = position[1];
    p.tilt = s.pitch;
    p.motion = { kind: 'loop', origin, distance: s.distance, age: 0, vx: 0, vy: 0, vlane: 0 };
    tick(r, Input.A);
    expect(p.motion.kind).toBe('loop');
    if (p.motion.kind !== 'loop')
      throw new Error('The widened road lost tire support');
    const next = sampleLoop(p.motion.distance);
    p.lane = sampleLane(next) - 1.1 * next.lateral[2];
    tick(r, Input.A);
    expect(p.motion.kind).toBe('loop-air');
    expect(p.recovery).toBe(0);
  });
  it.each([-1, 1])('collides with the newly widened road wing on side %s', side => {
    const r = live(), s = LOOP_SAMPLES.find(s => s.normal[1] < -0.99)!;
    const point = add(s.position, mul(s.lateral, side * 0.75 * LOOP_WIDTH));
    point[0] += origin;
    expect(roadImpact(r, add(point, mul(s.normal, 12)), add(point, mul(s.normal, -12)))).not.toBeNull();
  });
  it('requires actual steering rather than carrying the rider between lanes', () => {
    const r = live(), p = r.riders[0];
    for (let i = 0; i < 200 && p.motion.kind !== 'loop-air'; i++)
      tick(r, Input.A);
    expect(p.motion.kind).toBe('loop-air');
    expect(p.lane).toBe(3);
    expect(p.height).toBeGreaterThan(30);
    expect(p.recovery).toBe(0);
    expect(p.speed).toBeLessThan(5);
  });
  it('lets lanes 1–3 continue on the floor beneath the same x range', () => {
    const r = live();
    for (const lane of [0, 1, 2])
      expect(heightAt(r.track, origin + 60, lane)).toBe(0);
    for (const lane of [0, 1, 2]) {
      const other = live();
      other.riders[0].lane = lane;
      for (let i = 0; i < 60; i++)
        tick(other, Input.A);
      expect(other.riders[0].motion.kind).toBe('track');
      expect(other.riders[0].crashes).toBe(0);
    }
  });
  it('has monotonically increasing race progress despite backwards physical motion', () => {
    const r = live();
    let progress = r.riders[0].progress, backwards = false;
    for (let i = 0; i < 200; i++) {
      const x = r.riders[0].x;
      tick(r, loopButtons(r));
      const p = r.riders[0];
      if (p.motion.kind === 'loop') {
        expect(p.progress).toBeGreaterThanOrEqual(progress);
        backwards ||= p.x < x;
      }
      progress = p.progress;
      if (p.motion.kind === 'loop-air')
        break;
    }
    expect(backwards).toBe(true);
  });
  it.each([Input.A,Input.B])('calibrates the gain against normal-speed floor riding, with entry motor %s and B after exit', motor => {
    const loop = live(), floor = live(false), end = origin + LOOP_EXIT_X + 5 * HZ * DRIVE.normalSpeed;
    let a = 0, b = 0;
    while (loop.riders[0].x < end && a < 1200) {
      tick(loop, loopButtons(loop,loop.riders[0].x>=origin+LOOP_EXIT_X && loop.riders[0].motion.kind!=='loop' ? Input.B:motor));
      a++;
    }
    while (floor.riders[0].x < end && b < 1200) {
      tick(floor, Input.A);
      b++;
    }
    const gain = (b - a) / HZ;
    expect(loop.riders[0].crashes).toBe(0);
    expect(gain).toBeGreaterThanOrEqual(0.5);
    expect(gain).toBeLessThanOrEqual(1);
    expect(loop.riders[0].speed).toBeLessThanOrEqual(MAX_SPEED);
  });
  it('keeps lane controls in world direction while inverted and supports wheelies', () => {
    const r = live(), p = r.riders[0];
    while (p.motion.kind !== 'loop' || sampleLoop(p.motion.distance).normal[1] > -0.9)
      tick(r, loopButtons(r, Input.A));
    const lane = p.lane;
    tick(r, Input.A | Input.UP);
    expect(p.lane).toBeLessThan(lane);
    const up = p.lane;
    tick(r, Input.A | Input.DOWN);
    expect(p.lane).toBeGreaterThan(up);
    const wheelie = p.wheelie;
    tick(r, Input.A | Input.LEFT);
    expect(p.wheelie).toBeGreaterThan(wheelie);
  });
  it('does not normalize an overspeed entry or attach an airborne rider', () => {
    const r = live(), p = r.riders[0];
    p.speed = MAX_SPEED;
    tick(r, Input.B);
    expect(p.motion.kind).toBe('loop');
    expect(p.speed).toBe(MAX_SPEED);
    for (let i = 0; i < 200 && p.motion.kind === 'loop'; i++)
      tick(r, loopButtons(r));
    expect(p.motion.kind).toBe('loop-air');
    expect(p.height).toBeGreaterThan(40);
    expect(p.recovery).toBe(0);
    const air = live();
    air.riders[0].grounded = false;
    air.riders[0].height = 25;
    tick(air, Input.A);
    expect(air.riders[0].motion.kind).not.toBe('loop');
  });
  it('loses contact when slow without teleporting or awarding an impulse', () => {
    const r = live(), p = r.riders[0];
    p.speed = 0.5;
    p.x = origin + LOOP_ENTRY_X - 0.2;
    tick(r, 0);
    expect(p.motion.kind).toBe('loop');
    for (let i = 0; i < 600 && p.motion.kind === 'loop'; i++)
      tick(r, 0);
    expect(p.motion.kind).toBe('loop-air');
    expect(p.recovery).toBe(0);
    expect(p.speed).toBeLessThan(1);
    expect(p.height).toBeGreaterThan(heightAt(r.track, p.x, p.lane));
  });
  it('retains heating and can lose support after overheating', () => {
    const r = live(), p = r.riders[0];
    while (p.motion.kind !== 'loop' || p.motion.distance < 230)
      tick(r, loopButtons(r));
    p.heat = 99.99;
    tick(r, loopButtons(r));
    expect(p.overheated).toBe(true);
    for (let i = 0; i < 100 && p.motion.kind === 'loop'; i++)
      tick(r, loopButtons(r));
    expect(p.motion.kind).toBe('loop-air');
    expect(p.recovery).toBe(0);
    expect(p.speed).toBeLessThan(5);
  });
  it('keeps B boost, brakes with A and preserves the existing mud penalty', () => {
    const a = complete(Input.A).r, b = structuredClone(a), mud = structuredClone(a);
    for (let i = 0; i < 24; i++) {
      tick(a, Input.A);
      tick(b, Input.B);
    }
    expect(b.riders[0].speed).toBe(MAX_SPEED);
    expect(a.riders[0].speed).toBeLessThan(b.riders[0].speed);
    const p = mud.riders[0];
    p.motion = { kind: 'track' };
    p.grounded = true;
    p.height = 0;
    p.x = origin + 800;
    p.lane = 0;
    mud.track = { ...mud.track, segments: [placedPiece('K', p.x, 1)] };
    tick(mud, Input.B);
    expect(p.speed).toBeLessThan(MAX_SPEED);
  });
  it('can save an early side fall with air balance and counts a bad landing once', () => {
    const saved = live(), bad = live();
    for (const r of [saved, bad])
      for (let i = 0; i < 200 && r.riders[0].motion.kind !== 'loop-air'; i++)
        tick(r, Input.A | Input.UP);
    expect(saved.riders[0].height).toBeGreaterThan(0);
    for (let i = 0; i < 250 && saved.riders[0].motion.kind === 'loop-air'; i++)
      tick(saved, loopButtons(saved, Input.A));
    expect(saved.riders[0].crashes).toBe(0);
    expect(saved.riders[0].grounded).toBe(true);
    bad.riders[0].tilt = Math.PI;
    for (let i = 0; i < 250 && bad.riders[0].motion.kind === 'loop-air'; i++)
      tick(bad, Input.A);
    expect(bad.riders[0].crashes).toBe(1);
    expect(bad.riders[0].recovery).toBeGreaterThan(0);
  });
  it('resolves an inverted body impact before its head penetrates the floor', () => {
    const r = complete(Input.A).r, p = r.riders[0];
    p.x = origin + 600;
    p.tilt = Math.PI;
    p.vy = -1;
    let lastHeight = p.height;
    while (!p.recovery) {
      lastHeight = p.height;
      tick(r, Input.B);
    }
    expect(lastHeight).toBeGreaterThan(20);
    expect(p.crashes).toBe(1);
    expect(p.motion.kind).toBe('track');
  });
  it('uses solid ribbon/supports and physically separated 3D bike envelopes', () => {
    const r = live(), point = sampleLoop(250).position;
    expect(roadImpact(r, [origin + point[0], point[1] + 12, point[2]], [origin + point[0], point[1] - 12, point[2]])).not.toBeNull();
    const floor = live().riders[0], top = complete(Input.A).r.riders[0];
    floor.x = top.x;
    floor.lane = top.lane;
    expect(ridersTouch(floor, top, 0)).toBe(false);
    const falling = structuredClone(top);
    falling.height = 10;
    falling.tilt = 0;
    falling.motion.kind === 'loop-air' && (falling.motion.basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]);
    expect(ridersTouch(floor, falling, 0)).toBe(true);
  });
  it.each([null, 'impact'] as const)('a falling rider hits a floor rider, including a previous structure impact: %s', pendingCrash => {
    const r = testRace(live().track, 1);
    r.countdown = 0;
    r.phase = 'racing';
    const [air, floor] = r.riders;
    for (const p of r.riders) {
      p.x = origin - 100;
      p.progress = p.x;
      p.lane = 2;
      p.targetLane = 2;
    }
    air.height = 4;
    air.grounded = false;
    air.vy = -0.2;
    air.motion = { kind: 'loop-air', origin, age: 0, vx: 0, vlane: 0, basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], basisPitch: 0, pendingCrash, ignoreRoad: 0, contact: null };
    stepRace(r, 0);
    expect(floor.crashes).toBe(1);
    expect(air.motion.kind).toBe('loop-air');
    if (air.motion.kind === 'loop-air')
      expect(air.motion.pendingCrash).toBe('impact');
    for (let i = 0; i < 30 && !air.recovery; i++)
      stepRace(r, 0);
    expect(air.crashes).toBe(1);
    expect(floor.crashes).toBe(1);
  });
  it('honors temporary protection during a falling-rider collision', () => {
    const r = testRace(live().track, 1);
    r.countdown = 0;
    r.phase = 'racing';
    const [air, floor] = r.riders;
    floor.invincible = 90;
    for (const p of r.riders) {
      p.x = origin - 100;
      p.progress = p.x;
      p.lane = 2;
      p.targetLane = 2;
    }
    air.height = 4;
    air.grounded = false;
    air.vy = -0.2;
    air.motion = { kind: 'loop-air', origin, age: 0, vx: 0, vlane: 0, basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], basisPitch: 0, pendingCrash: null, ignoreRoad: 0, contact: null };
    stepRace(r, 0);
    expect(floor.crashes).toBe(0);
    if (air.motion.kind === 'loop-air')
      expect(air.motion.pendingCrash).toBeNull();
  });
  it.each([0, 1])('penalizes the rear rider while inverted, including a different lap %s', lap => {
    const r = testRace(live().track, 1);
    r.countdown = 0;
    r.phase = 'racing';
    r.track.laps = 2;
    const distance = LOOP_SAMPLES.find(s => s.normal[1] < -0.99)!.distance;
    r.riders.forEach((p, i) => {
      const distanceHere = distance + i * 8, s = sampleLoop(distanceHere), lane = sampleLane(s), position = loopPosition(s, lane);
      const start = origin + (i === 1 ? lap * r.track.length : 0);
      p.motion = { kind: 'loop', origin: start, distance: distanceHere, age: 0, vx: 0, vy: 0, vlane: 0 };
      p.x = start + position[0];
      p.height = position[1];
      p.lane = lane;
      p.targetLane = lane;
      p.speed = DRIVE.normalSpeed;
      p.tilt = s.pitch;
    });
    stepRace(r, Input.A);
    expect(r.riders[0].motion.kind).toBe('loop-air');
    expect(r.riders[1].motion.kind).toBe('loop');
  });
  it.each(['easy', 'normal', 'hard'] as const)('replays new physics deterministically with %s bots', difficulty => {
    const initial = live(), r = testRace(initial.track, 5);
    r.config.difficulty = difficulty;
    const recording = newRecording(r.config);
    let seenLoops = 0;
    const lastKinds = r.riders.map(p => p.motion.kind);
    while (r.phase !== 'finished' && r.frame < 12000) {
      const p = r.riders[0];
      let input: number = p.heat < 65 ? Input.B : Input.A;
      if (p.x < origin + LOOP_ENTRY_X && p.lane < 2.99)
        input |= Input.DOWN;
      else
        input = loopButtons(r, input);
      if (!isFinished(r, 0))
        appendInput(recording, input);
      stepRace(r, input);
      r.riders.forEach((p, i) => { if (p.motion.kind === 'loop' && lastKinds[i] !== 'loop')
        seenLoops++; lastKinds[i] = p.motion.kind; });
    }
    expect(r.phase).toBe('finished');
    expect(seenLoops).toBeGreaterThan(0);
    recording.result = raceResult(completeRace(r));
    const imported = validateRecording(recording), playback = new Playback(imported);
    while (!playback.done)
      playback.step();
    completeRace(playback.race);
    expect(playback.race.finishes).toEqual(r.finishes);
    expect(fingerprint(playback.race)).toBe(fingerprint(r));
  });
  it('lets a hard bot complete an unoccupied loop using actual controls', () => {
    const r = testRace(live().track, 1), bot = r.riders[1];
    r.config.difficulty = 'hard';
    r.countdown = 0;
    r.phase = 'racing';
    bot.x = origin + LOOP_ENTRY_X - DRIVE.normalSpeed;
    bot.progress = bot.x;
    bot.speed = DRIVE.normalSpeed;
    bot.lane = 3;
    bot.targetLane = 3;
    let entered = false, awarded = false;
    for (let i = 0; i < 250; i++) {
      stepRace(r, 0);
      entered ||= bot.motion.kind === 'loop';
      awarded ||= bot.motion.kind === 'loop-air' && bot.speed > 5;
    }
    expect(entered).toBe(true);
    expect(awarded).toBe(true);
    expect(bot.crashes).toBe(0);
  });
  it('recovers outside the road without advancing beyond the failure point', () => {
    const r = complete(Input.A).r, p = r.riders[0], x = p.x;
    p.lane = 3.6;
    tick(r, Input.A);
    expect(p.crashes).toBe(1);
    expect(p.recovery).toBeGreaterThan(0);
    expect(p.x).toBeLessThanOrEqual(x);
    expect(p.motion.kind).toBe('track');
  });
});
describe('loop editor and generation constraints', () => {
  it('locks dimensions and lanes and preserves floor terrain under the overpass', () => {
    const d = emptyDesign();
    d.length = 4096;
    d.items = [placedPiece('T', origin), placedPiece('K', origin + 60, 1)];
    expect(validateMap(d).items).toHaveLength(2);
    d.items.push(placedPiece('A', origin + 40, 2));
    expect(() => validateMap(d)).toThrow(/debajo/);
    d.items = [{ ...placedPiece('T', origin), lanes: 8 }];
    expect(() => validateMap(d)).toThrow(/fijos/);
    d.items = [placedPiece('T', 64)];
    expect(() => validateMap(d)).toThrow(/meta/);
  });
  it.each(['short', 'medium', 'long'] as const)('reserves exact loop counts for %s', size => {
    const length = { short: 2048, medium: 4096, long: 6144 }[size];
    for (let loops = 0; loops <= maximumLoops(length); loops++) {
      const options = { ...generatorDefaults, size, loops, seed: 'loop-reservation' };
      const a = generateMap(options), b = generateMap(options);
      expect(a.items.filter(s => s.piece === 'T')).toHaveLength(loops);
      for(const loop of a.items.filter(s => s.piece === 'T')) {
        expect(loop.x-LOOP_APPROACH).toBeGreaterThanOrEqual(0);
        expect(loop.x+LOOP_LENGTH+LOOP_RUNOUT).toBeLessThanOrEqual(length);
      }
      expect(a).toEqual(b);
      expect(validateMap(a)).toEqual(a);
    }
    expect(() => generateMap({ ...generatorDefaults, size, loops: maximumLoops(length) + 1 })).toThrow(/caben/);
  });
  it('uses a full 3D ribbon with a two-lane top and one-lane entry and exit', () => {
    expect(LOOP_DISTANCE).toBeGreaterThan(500);
    expect(LOOP_SAMPLES.some(s => s.normal[1] < -0.99)).toBe(true);
    expect(LOOP_WIDTH).toBeCloseTo(1.22 / 0.052);
    expect(LOOP_SAMPLES[0].width).toBe(LOOP_WIDTH);
    expect(LOOP_SAMPLES.at(-1)!.width).toBe(LOOP_WIDTH);
    expect(Math.max(...LOOP_SAMPLES.map(s => s.width))).toBe(2 * LOOP_WIDTH);
    expect(LOOP_SAMPLES.filter(s => s.normal[1] < -0.9).every(s => s.width === 2 * LOOP_WIDTH)).toBe(true);
    expect(LOOP_LENGTH).toBe(128); // Existing serialized loop slots remain valid.
  });
});
