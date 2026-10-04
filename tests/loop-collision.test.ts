import { describe, expect, it } from 'vitest';
import { emptyDesign, mapTrack, placedPiece, validateMap } from '../src/core/maps';
import { crash, fingerprint, move } from '../src/core/simulation';
import { DRIVE } from '../src/core/handling';
import { HZ, Input, type Race } from '../src/core/types';
import { add, dot, LOOP_ENTRY_X, LOOP_WIDTH, loopPosition, mul, sampleLane, sampleLoop, sub, type Vec3 } from '../src/core/loop-geometry';
import { roadImpact } from '../src/core/loop-physics';
import { testRace } from './race-fixture';

const origin = 512;
function race() {
  const design = emptyDesign();
  design.length = 4096;
  design.laps = 1;
  design.items = [placedPiece('T', origin)];
  const r = testRace(mapTrack(validateMap(design)), 0);
  r.countdown = 0;
  r.phase = 'racing';
  return r;
}
function tick(r: Race, input = 0) {
  r.frame++;
  r.elapsed++;
  r.events = [];
  move(r, r.riders[0], input);
}
function airborne(distance: number, speed = 0, tilt = 0) {
  const r = race(), p = r.riders[0], s = sampleLoop(distance);
  // An upright bike's collision envelope is ten units above its pivot.
  const center = add(s.position, mul(s.normal, 6));
  Object.assign(p, {
    x: origin + center[0], height: center[1] - 10,
    lane: center[2] / LOOP_WIDTH + 1.5, speed, tilt, grounded: false,
  });
  p.motion = { kind: 'loop-air', origin, age: 0, vx: speed, vlane: 0,
    basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], basisPitch: 0,
    pendingCrash: 'impact', ignoreRoad: 0, contact: null };
  return r;
}
const position = (r: Race): Vec3 => {
  const p = r.riders[0];
  return [p.x, p.height, (p.lane - 1.5) * LOOP_WIDTH];
};

describe('solid loop contacts and blocked falls', () => {
  it.each([-1, 1])('preserves tangential velocity and displacement at ribbon face %s', side => {
    const r = airborne(100), p = r.riders[0], s = sampleLoop(100);
    const normal = mul(s.normal, side), center = add(s.position, mul(normal, side === 1 ? 6 : 8));
    const velocity = sub(mul(s.tangent, 2), mul(normal, 2));
    p.x = origin + center[0];
    p.height = center[1] - 10;
    p.lane = center[2] / LOOP_WIDTH + 1.5;
    p.speed = Math.abs(velocity[0]);
    p.vy = velocity[1] + 0.105;
    if (p.motion.kind !== 'loop-air') throw new Error('Expected flight');
    p.motion.vx = velocity[0];
    p.motion.vlane = velocity[2] / LOOP_WIDTH;
    const before = position(r);
    tick(r);
    expect(p.motion.kind).toBe('loop-air');
    if (p.motion.kind !== 'loop-air') throw new Error('Unexpected floor impact');
    expect(p.motion.contact).not.toBeNull();
    expect(dot([p.motion.vx, p.vy, p.motion.vlane * LOOP_WIDTH], s.tangent)).toBeGreaterThan(1.8);
    expect(dot(sub(position(r), before), s.tangent)).toBeGreaterThan(1.8);
    expect(dot([p.motion.vx, p.vy, p.motion.vlane * LOOP_WIDTH], normal)).toBeGreaterThan(-0.1);
    expect(p.crashes).toBe(0); // Counted once when the visible fall reaches floor.
  });

  it('does not collide again with a separating envelope already clear of the ribbon', () => {
    const r = race(), s = sampleLoop(100), center = add(s.position, [origin, 0, 0]);
    expect(roadImpact(r, add(center, mul(s.normal, 4.9)), add(center, mul(s.normal, 10)))).toBeNull();
  });

  it.each([100, 150, 250, 300, 360, 390, 420, 450])('lets a crashed rider slide and fall from route distance %s', distance => {
    const r = race(), p = r.riders[0], s = sampleLoop(distance);
    const point = loopPosition(s, sampleLane(s));
    Object.assign(p, { x: origin + point[0], height: point[1], lane: sampleLane(s),
      speed: DRIVE.normalSpeed, tilt: s.pitch, grounded: false });
    p.motion = { kind: 'loop', origin, distance, age: 0, vx: 0, vy: 0, vlane: 0 };
    tick(r, Input.A);
    crash(r, p); // A reach collision can confirm a fall anywhere on the route.
    let frames = 0;
    while (r.riders[0].motion.kind === 'loop-air' && frames < 2 * HZ) {
      tick(r);
      frames++;
      expect(r.riders[0].motion.kind).not.toBe('loop');
    }
    expect(frames).toBeLessThan(2 * HZ);
    expect(p.motion.kind).toBe('track');
    expect(p.height).toBe(0);
    expect(p.crashes).toBe(1);
    expect(p.recovery).toBe(130);
  });

  it('finishes the former repeated-collision wheelie fall without the ten-second timeout', () => {
    const r = race(), p = r.riders[0];
    Object.assign(p, { x: origin + LOOP_ENTRY_X - DRIVE.normalSpeed,
      lane: 3, speed: DRIVE.normalSpeed, wheelie: 0.8, tilt: 0.8 });
    let flightFrames = 0;
    for (let frame = 0; frame < 400 && !p.recovery; frame++) {
      let input: number = Input.A;
      if (p.motion.kind === 'loop') {
        const target = sampleLane(sampleLoop(p.motion.distance + p.speed * 9.5));
        if (p.lane > target + 0.015) input |= Input.UP;
        if (p.lane < target - 0.015) input |= Input.DOWN;
        if (p.motion.distance >= 300) input |= Input.LEFT;
      } else if (p.motion.kind === 'loop-air') flightFrames++;
      tick(r, input);
    }
    expect(flightFrames).toBeGreaterThan(0);
    expect(flightFrames).toBeLessThan(2 * HZ);
    expect(p.crashes).toBe(1);
    expect(p.recovery).toBe(130);
  });

  it.each([0, 0.8])('recovers a stalled fall once on safe floor with no gifted progress, tilt %s', tilt => {
    const r = airborne(450, 0, tilt), p = r.riders[0], failedX = p.x;
    let lastContactAge = 0;
    for (let frame = 0; frame < 180 && p.motion.kind === 'loop-air'; frame++) {
      lastContactAge = p.motion.contact?.age ?? 0;
      tick(r);
    }
    expect(lastContactAge).toBe(Math.ceil(HZ) - 1);
    expect(p.motion.kind).toBe('track');
    expect(p.x).toBe(origin - 16);
    expect(p.progress).toBe(p.x);
    expect(p.progress).toBeLessThan(failedX);
    expect(p.height).toBe(0);
    expect(p.crashes).toBe(1);
    expect(p.recovery).toBe(130);
    expect(r.events.filter(e => e.type === 'crash')).toHaveLength(1);
    for (let frame = 0; frame < 150; frame++) tick(r);
    expect(p.crashes).toBe(1);
    expect(p.recovery).toBe(0);
    expect(p.grounded).toBe(true);
  });

  it('keeps a blocked-contact cluster through a brief bounce and a serialized continuation', () => {
    const r = airborne(450), p = r.riders[0];
    for (let frame = 0; frame < 180 && p.motion.kind === 'loop-air' && (p.motion.contact?.age ?? 0) < 40; frame++) tick(r);
    if (p.motion.kind !== 'loop-air') throw new Error('Expected a stalled contact');
    const age = p.motion.contact!.age;
    p.vy = 0.3; // A small outward bounce clears the ribbon for a few frames.
    const resumed = JSON.parse(JSON.stringify(r)) as Race;
    let gapSeen = false, returned = false;
    for (let frame = 0; frame < 100 && p.motion.kind === 'loop-air'; frame++) {
      tick(r);
      tick(resumed);
      expect(fingerprint(resumed)).toBe(fingerprint(r));
      if (p.motion.kind === 'loop-air' && p.motion.contact) {
        gapSeen ||= p.motion.contact.gap > 0;
        if (gapSeen && !returned && p.motion.contact.gap === 0) {
          returned = true;
          expect(p.motion.contact.age).toBeGreaterThan(age);
        }
      }
    }
    expect(gapSeen).toBe(true);
    expect(returned).toBe(true);
    expect(p.crashes).toBe(1);
    expect(p.x).toBe(origin - 16);
  });

  it('does not shorten a failed flight that is freely falling clear of the structure', () => {
    const r = airborne(450), p = r.riders[0];
    p.x = origin + 500;
    p.height = 800;
    for (let frame = 0; frame < 90; frame++) tick(r);
    expect(p.motion.kind).toBe('loop-air');
    if (p.motion.kind !== 'loop-air') throw new Error('Unexpected early recovery');
    expect(p.motion.contact).toBeNull();
    expect(p.height).toBeGreaterThan(300);
    expect(p.crashes).toBe(0);
    for (let frame = 0; frame < 100 && p.motion.kind === 'loop-air'; frame++) tick(r);
    expect(p.motion.kind).toBe('track');
    expect(p.crashes).toBe(1);
    expect(p.x).toBe(origin + 500);
  });
});
