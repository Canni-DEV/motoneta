import { updateWheelie, DRIVE } from './handling';
import { heightAt, segmentAt } from './tracks';
import { clamp, Input, q, type Race, type Rider } from './types';
import { add, dot, loopInstances, loopPosition, loopSupportMargin, mul, norm, sampleLoop, sub, wrapAngle, LOOP_DISTANCE, LOOP_EDGE, LOOP_ENTRY_X, LOOP_EXIT_X, LOOP_LENGTH, LOOP_MANIFEST, LOOP_OFFSET, LOOP_SAMPLES, LOOP_WIDTH, riderBasis, riderLocalTilt, unit, type Vec3 } from './loop-geometry';
import { WORLD_SCALE } from '../world-space';
// Per simulation frame, in the same coordinates as ordinary riding. Local gravity
// keeps the approved large loop playable without changing the rest of the game.
export const LOOP_GRAVITY = 0.026;
export const LOOP_STEERING = 11 / 256; // 22% over the quantized floor response (9/256).
export const LOOP_IMPULSE = 4.25;
export const MAX_SPEED = 7.25;
export const jumpVelocity = (speed: number, tilt: number) => tilt > 0.1 ? 1.2 + speed * 0.28 + Math.max(0, tilt) * 1.5 : 0;
type Crash = (r: Race, p: Rider, kind?: Rider['crashKind'], speed?: number) => void;
const emit = (r: Race, p: Rider, type: 'jump' | 'land', speed?: number) => r.events.push({ type, rider: p.id, frame: r.frame, impactSpeed: speed, surface: segmentAt(r.track, p.x, p.lane)?.surface ?? 'dirt' });
export function enterLoop(r: Race, p: Rider, oldX: number) {
  if (!p.grounded || p.recovery || p.motion.kind !== 'track' || Math.abs(p.lane - 3) > LOOP_EDGE)
    return false;
  const instance = loopInstances(r.track, oldX).find(({ origin }) => oldX <= origin + LOOP_ENTRY_X && p.x >= origin + LOOP_ENTRY_X);
  if (!instance || Math.abs(p.height) > 1)
    return false;
  p.motion = { kind: 'loop', origin: instance.origin, distance: q(p.x - instance.origin - LOOP_ENTRY_X), age: 0, vx: p.speed, vy: 0, vlane: 0 };
  const s = sampleLoop(p.motion.distance), position = loopPosition(s, p.lane);
  p.x = q(instance.origin + position[0]);
  p.height = q(position[1]);
  p.tilt = s.pitch + p.wheelie;
  p.progress = q(instance.origin + LOOP_ENTRY_X + (LOOP_EXIT_X - LOOP_ENTRY_X) * p.motion.distance / LOOP_DISTANCE);
  return true;
}
export function detachLoop(p: Rider, pendingCrash: Rider['crashKind'] | null = null) {
  if (p.motion.kind !== 'loop')
    return;
  const m = p.motion, s = sampleLoop(m.distance);
  p.motion = { kind: 'loop-air', origin: m.origin, age: 0, vx: m.vx, vlane: m.vlane, basis: [s.tangent, s.normal, s.lateral], basisPitch: s.pitch, pendingCrash, ignoreRoad: 6, stuck: 0 };
  p.vy = m.vy;
  p.grounded = false;
  p.wheelie = 0;
  p.wheelieVelocity = 0;
  p.speed = q(Math.abs(m.vx));
}
export function stepLoop(r: Race, p: Rider, input: number) {
  if (p.motion.kind !== 'loop')
    return;
  const m = p.motion, before = sampleLoop(m.distance), oldX = p.x, oldY = p.height, oldLane = p.lane;
  if (input & Input.UP)
    p.lane -= LOOP_STEERING;
  if (input & Input.DOWN)
    p.lane += LOOP_STEERING;
  p.lane = q(clamp(p.lane, 0, 3));
  p.speed = q(clamp(p.speed - LOOP_GRAVITY * before.tangent[1], 0, MAX_SPEED));
  m.distance = q(Math.min(LOOP_DISTANCE, m.distance + p.speed));
  m.age++;
  const s = sampleLoop(m.distance), position = loopPosition(s, p.lane);
  p.x = q(m.origin + position[0]);
  p.height = q(position[1]);
  m.vx = q(p.x - oldX);
  m.vy = q(p.height - oldY);
  m.vlane = q(p.lane - oldLane);
  p.vy = m.vy;
  p.tilt = s.pitch + p.wheelie;
  p.progress = q(m.origin + LOOP_ENTRY_X + (LOOP_EXIT_X - LOOP_ENTRY_X) * m.distance / LOOP_DISTANCE);
  const fellBack = updateWheelie(p, input);
  p.tilt = s.pitch + p.wheelie;
  const support = p.speed * p.speed * s.curvature + LOOP_GRAVITY * s.normal[1];
  if (loopSupportMargin(s,p.lane) < 0 || support < -0.0001 || p.speed < 0.08 || fellBack || m.age > 1200) {
    detachLoop(p);
    emit(r, p, 'jump');
    return;
  }
  if (m.distance >= LOOP_DISTANCE) {
    const tilt = wrapAngle(p.tilt), speed = p.speed;
    detachLoop(p);
    p.tilt = tilt;
    p.vy = q(jumpVelocity(speed, tilt) + 0.5);
    p.speed = q(Math.min(MAX_SPEED, speed + LOOP_IMPULSE));
    const flight = p.motion as Rider['motion'];
    if (flight.kind === 'loop-air') {
      flight.vx = p.speed;
      flight.basis = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
      flight.basisPitch = 0;
      flight.ignoreRoad = 8;
    }
    p.progress = p.x;
    emit(r, p, 'jump');
  }
}
/** Swept bike-envelope test against both faces of the thin ribbon. */
export function roadImpact(r: Race, from: Vec3, to: Vec3) {
  for (const { origin } of loopInstances(r.track, to[0])) {
    if (Math.max(to[0], from[0]) < origin - 24 || Math.min(to[0], from[0]) > origin + LOOP_LENGTH + 24)
      continue;
    const steps = Math.max(1, Math.ceil(norm(sub(to, from)) / 3));
    for (let j = 0; j <= steps; j++) {
      const point = add(from, mul(sub(to, from), j / steps));
      point[0] -= origin;
      for (const beam of LOOP_MANIFEST.beams) {
        const a: Vec3 = [(beam.a[0] + LOOP_OFFSET) / WORLD_SCALE, beam.a[1] / WORLD_SCALE, beam.a[2] / WORLD_SCALE];
        const b: Vec3 = [(beam.b[0] + LOOP_OFFSET) / WORLD_SCALE, beam.b[1] / WORLD_SCALE, beam.b[2] / WORLD_SCALE], ab = sub(b, a);
        const t = clamp(dot(sub(point, a), ab) / dot(ab, ab), 0, 1), delta = sub(point, add(a, mul(ab, t)));
        if (norm(delta) < 5 + beam.radius / WORLD_SCALE)
          return unit(delta);
      }
      for (let i = 1; i < LOOP_SAMPLES.length; i++) {
        const a = LOOP_SAMPLES[i - 1], b = LOOP_SAMPLES[i], ab = sub(b.position, a.position);
        const t = clamp(dot(sub(point, a.position), ab) / dot(ab, ab), 0, 1);
        const delta = sub(point, add(a.position, mul(ab, t)));
        const normalDistance=dot(delta,a.normal),thickness=LOOP_MANIFEST.thickness/WORLD_SCALE;
        const width = a.width + (b.width - a.width) * t;
        if (normalDistance < 5 && normalDistance > -thickness-5 && Math.abs(dot(delta, a.lateral)) < width / 2 + 3 && Math.abs(dot(delta, a.tangent)) < 4)
          return mul(a.normal, normalDistance >= -thickness/2 ? 1 : -1);
      }
    }
  }
  return null;
}
export function pendingAirCrash(p: Rider, kind: Rider['crashKind'] = 'impact') {
  if (p.motion.kind === 'loop')
    detachLoop(p, kind);
  else if (p.motion.kind === 'loop-air')
    p.motion.pendingCrash ??= kind;
}
export function stepLoopAir(r: Race, p: Rider, input: number, crash: Crash) {
  if (p.motion.kind !== 'loop-air')
    return;
  const m = p.motion, oldX = p.x, oldY = p.height, oldLane = p.lane;
  m.age++;
  // Throttle/braking retain their ordinary effect on speed, including backwards flight.
  m.vx = q(Math.sign(m.vx || 1) * p.speed);
  if (!m.pendingCrash) {
    if (input & Input.UP)
      m.vlane = -q(0.034);
    else if (input & Input.DOWN)
      m.vlane = q(0.034);
    else
      m.vlane = 0;
    p.tilt = q(p.tilt + (input & Input.LEFT ? 0.037 : 0) - (input & Input.RIGHT ? 0.037 : 0) - 0.005);
  }
  p.x = q(p.x + m.vx);
  p.lane = q(p.lane + m.vlane);
  p.vy = q(p.vy - 0.105);
  p.height = q(p.height + p.vy);
  p.progress = p.x;
  const angle = riderLocalTilt(p), [tangent, normal] = m.basis;
  const offset = add(mul(tangent, -Math.sin(angle)), mul(normal, Math.cos(angle)));
  const center = (x: number, y: number, lane: number): Vec3 => add([x, y, (lane - 1.5) * LOOP_WIDTH], mul(offset, 10));
  if (m.ignoreRoad > 0)
    m.ignoreRoad--;
  else {
    const normal = roadImpact(r, center(oldX, oldY, oldLane), center(p.x, p.height, p.lane));
    if (normal) {
      m.pendingCrash ??= 'impact';
      const velocity: Vec3 = [m.vx, p.vy, m.vlane * LOOP_WIDTH], inward = Math.min(0, dot(velocity, normal));
      const reflected = mul(sub(velocity, mul(normal, inward * 1.05)), 0.55);
      m.vx = q(reflected[0]);
      p.speed = q(Math.abs(m.vx));
      p.vy = q(reflected[1]);
      m.vlane = q(reflected[2] / LOOP_WIDTH);
      p.x = q(oldX + normal[0] * 0.5);
      p.height = q(oldY + normal[1] * 0.5);
      p.lane = q(oldLane + normal[2] * 0.5 / LOOP_WIDTH);
      m.stuck++;
    }
    else
      m.stuck = 0;
  }
  const ground = heightAt(r.track, p.x, p.lane);
  const outside = p.lane < -0.5 || p.lane > 3.5;
  if (outside || p.height < ground - 16 || m.age > 600 || m.stuck >= 30) {
    p.x = Math.min(p.x, m.origin - 16);
    p.lane = p.lane < 1.5 ? 1 : 2;
    // Search backwards if the approach contains an elevated piece. Recovery
    // must settle on floor and can never move the racer ahead of the failure.
    for (let retreat = 0; retreat <= r.track.length; retreat += 8) {
      if (heightAt(r.track, p.x, p.lane) === 0)
        break;
      if (heightAt(r.track, p.x, 3 - p.lane) === 0) {
        p.lane = 3 - p.lane;
        break;
      }
      p.x -= 8;
    }
    p.height = heightAt(r.track, p.x, p.lane);
    p.motion = { kind: 'track' };
    p.grounded = true;
    p.progress = p.x;
    p.recovery = 0;
    crash(r, p, 'impact');
    return;
  }
  const slope = Math.atan2(heightAt(r.track, p.x + 4, p.lane) - heightAt(r.track, p.x - 4, p.lane), 8);
  const badOrientation = Math.abs(wrapAngle(p.tilt - slope)) > 0.95 && p.speed > 1.5;
  const bodyHit = (m.pendingCrash || badOrientation) && riderCapsules(p, p.x).some(capsule => [capsule.a, capsule.b].some(point => point[1] - capsule.radius <= heightAt(r.track, point[0], point[2] / LOOP_WIDTH + 1.5)));
  if (p.height <= ground || bodyHit) {
    const impact = Math.max(0, -p.vy);
    p.height = ground;
    p.vy = 0;
    p.grounded = true;
    p.lane = q(clamp(p.lane, 0, 3));
    p.motion = { kind: 'track' };
    p.wheelie = 0;
    p.wheelieVelocity = 0;
    if (m.pendingCrash || badOrientation) {
      p.tilt = wrapAngle(p.tilt);
      crash(r, p, m.pendingCrash ?? 'impact', impact);
    }
    else {
      p.speed = Math.max(0, m.vx);
      p.tilt = slope;
      emit(r, p, 'land', impact);
    }
  }
}
export const canAimForLoop = (p: Rider) => p.speed >= DRIVE.normalSpeed - 0.4 && p.speed <= DRIVE.turboSpeed + 0.5 && p.heat < 72 && !p.overheated;
function segmentDistance(a: Vec3, b: Vec3, c: Vec3, d: Vec3) {
  const u = sub(b, a), v = sub(d, c), w = sub(a, c), aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w), den = aa * cc - bb * bb;
  let s = den > 1e-8 ? clamp((bb * ee - cc * dd) / den, 0, 1) : 0;
  let t = (bb * s + ee) / cc;
  if (t < 0) {
    t = 0;
    s = clamp(-dd / aa, 0, 1);
  }
  else if (t > 1) {
    t = 1;
    s = clamp((bb - dd) / aa, 0, 1);
  }
  return norm(sub(add(a, mul(u, s)), add(c, mul(v, t))));
}
function riderCapsules(p: Rider, x: number) {
  const [t, n] = riderBasis(p), angle = riderLocalTilt(p), c = Math.cos(angle), s = Math.sin(angle);
  const point = (px: number, py: number): Vec3 => add([x, p.height, (p.lane - 1.5) * LOOP_WIDTH], add(mul(t, px * c - py * s), mul(n, px * s + py * c)));
  return [{ a: point(-8, 10), b: point(8, 10), radius: 5 }, { a: point(-2, 18), b: point(-2, 27), radius: 4 }];
}
export function ridersTouch(a: Rider, b: Rider, delta: number) {
  if (a.motion.kind === 'track' && b.motion.kind === 'track')
    return Math.abs(delta) < 12 && Math.abs(a.lane - b.lane) < 0.4 && Math.abs(a.height - b.height) < 8;
  if (Math.abs(delta) > 50 || Math.abs(a.lane - b.lane) > 1 || Math.abs(a.height - b.height) > 65)
    return false;
  return riderCapsules(a, b.x + delta).some(u => riderCapsules(b, b.x).some(v => segmentDistance(u.a, u.b, v.a, v.b) < u.radius + v.radius));
}
