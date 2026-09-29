import { DRIVE, updateWheelie } from './handling';
import { heightAt, segmentAt } from './tracks';
import { clamp, Input, q, type Race, type Rider } from './types';

export const START_X = 80;
function event(
  r: Race,
  type: Race['events'][number]['type'],
  rider: Rider,
  context: Partial<Pick<Race['events'][number], 'impactSpeed' | 'surface' | 'cause'>> = {},
) {
  r.events.push({ type, rider: rider.id, frame: r.frame, ...context });
}
export function crash(
  r: Race,
  p: Rider,
  kind: Rider['crashKind'] = 'impact',
  contactSpeed = Math.abs(p.vy),
) {
  if (p.recovery || (p.invincible && kind === 'impact')) return;
  const impactSpeed = Math.max(contactSpeed, p.speed);
  p.crashKind = kind;
  p.crashAge = 0;
  p.crashStartTilt = p.tilt;
  p.wheelieVelocity = 0;
  p.turbo = false;
  p.recovery = 108;
  p.crashes++;
  p.speed = 0;
  p.vy = 0;
  p.grounded = true;
  p.height = heightAt(r.track, p.x, p.lane);
  event(r, 'crash', p, {
    impactSpeed,
    surface: segmentAt(r.track, p.x, p.lane)?.surface ?? 'dirt',
    cause: kind,
  });
}
export function move(r: Race, p: Rider, input: number) {
  const a = !!(input & Input.A),
    b = !!(input & Input.B),
    edgeA = a && !p.previousA;
  p.previousA = a;
  p.turbo = b && !p.overheated && !p.recovery;
  if (p.invincible) p.invincible--;
  if (p.recovery) {
    p.recovery = Math.max(0, p.recovery - 1 - (edgeA ? 7 : 0));
    p.crashAge++;
    const t = Math.min(1, p.crashAge / 24);
    const fallenTilt = p.crashKind === 'backflip' ? 2.05 : -1.15;
    p.tilt = q(p.crashStartTilt + (fallenTilt - p.crashStartTilt) * (1 - (1 - t) ** 2));
    p.heat = Math.max(0, p.heat - 0.28);
    if (!p.recovery) {
      p.tilt = 0;
      p.wheelie = 0;
      p.wheelieVelocity = 0;
      p.invincible = 90;
      p.overheated = false;
    }
    return;
  }
  if (p.overheated) {
    p.speed = Math.max(0, p.speed - 0.15);
    p.heat = Math.max(0, p.heat - 0.65);
    if (p.heat <= 20) {
      p.overheated = false;
      event(r, 'cool', p, { cause: 'recovered' });
    }
  } else {
    if (r.frame % 4 === 0) {
      if (b && p.speed < DRIVE.turboSpeed)
        p.speed = Math.min(DRIVE.turboSpeed, p.speed + DRIVE.turboAcceleration);
      else if (a && !b)
        p.speed =
          p.speed < DRIVE.normalSpeed
            ? Math.min(DRIVE.normalSpeed, p.speed + DRIVE.normalAcceleration)
            : Math.max(DRIVE.normalSpeed, p.speed - DRIVE.normalDrag);
      else if (!b) p.speed = Math.max(0, p.speed - 0.055);
    }
    p.heat = clamp(p.heat + (b ? 0.14 : a ? -0.105 : -0.25), 0, 100);
    if (p.heat >= 100) {
      p.overheated = true;
      p.turbo = false;
      event(r, 'overheat', p);
    }
  }
  const oldX = p.x,
    oldY = p.height,
    oldGround = heightAt(r.track, p.x, p.lane);
  if (input & Input.UP) p.lane = clamp(p.lane - 0.034, 0, 3);
  if (input & Input.DOWN) p.lane = clamp(p.lane + 0.034, 0, 3);
  p.x = q(p.x + p.speed);
  const ground = heightAt(r.track, p.x, p.lane),
    next = heightAt(r.track, p.x + 4, p.lane);
  const prev = heightAt(r.track, p.x - 4, p.lane),
    slope = Math.atan2(next - prev, 8);
  const s = segmentAt(r.track, p.x, p.lane),
    oldS = segmentAt(r.track, oldX, p.lane);
  if (p.grounded) {
    p.height = ground;
    const previousWheelie = p.wheelie;
    const fellBack = updateWheelie(p, input);
    const terrainTilt = p.tilt - previousWheelie;
    p.tilt = terrainTilt + (slope - terrainTilt) * 0.24 + p.wheelie;
    const wheelie = p.wheelie > 0.2;
    if (fellBack) {
      crash(r, p, 'backflip');
      return;
    }
    if (
      (p.speed > 1.3 && ground < oldGround - 0.4 && p.tilt > 0.1) ||
      (oldS?.boost && s !== oldS) ||
      oldGround - ground > 3
    ) {
      p.height = Math.max(oldY, ground);
      p.vy = p.tilt > 0.1 ? 1.2 + p.speed * 0.28 + Math.max(0, p.tilt) * 1.5 : 0;
      p.grounded = false;
      p.tilt = clamp(p.tilt, -0.2, Math.max(0.65, p.wheelie));
      p.wheelie = 0;
      p.wheelieVelocity = 0;
      if (oldS?.boost) {
        p.speed = clamp(p.speed + 1, 0, 7.25);
        p.vy += 0.5;
      }
      event(r, 'jump', p);
    }
    if (s?.surface === 'cool' && s !== oldS) {
      p.heat = 0;
      p.overheated = false;
      event(r, 'cool', p, { cause: 'surface', surface: 'cool' });
    }
    if (s?.surface === 'mud' || s?.surface === 'grass')
      p.speed = Math.max(0.5, p.speed * (wheelie ? 0.996 : 0.94));
    if (s?.surface === 'bump' && s !== oldS && !wheelie) p.speed *= 0.75;
  } else {
    p.vy -= 0.105;
    p.height = q(p.height + p.vy);
    p.tilt = clamp(
      p.tilt + (input & Input.LEFT ? 0.037 : 0) - (input & Input.RIGHT ? 0.037 : 0) - 0.005,
      -1.65,
      1.65,
    );
    if (p.height <= ground) {
      const impactSpeed = Math.max(0, -p.vy);
      p.height = ground;
      p.vy = 0;
      p.grounded = true;
      p.wheelie = 0;
      p.wheelieVelocity = 0;
      if (Math.abs(p.tilt - slope) > 0.95 && p.speed > 1.5) crash(r, p, 'impact', impactSpeed);
      else {
        p.tilt = slope;
        event(r, 'land', p, { impactSpeed, surface: s?.surface ?? 'dirt' });
      }
    }
  }
  p.lane = q(p.lane);
  p.speed = q(p.speed);
  p.heat = q(p.heat);
  p.tilt = q(p.tilt);
}
export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds * 100 + 1e-7));
  return `${Math.floor(total / 6000)
    .toString()
    .padStart(
      2,
      '0',
    )}:${Math.floor(total / 100) % 60 < 10 ? '0' : ''}${Math.floor(total / 100) % 60}.${(total % 100).toString().padStart(2, '0')}`;
}
export function currentLap(r: Race) {
  return clamp(Math.floor((r.riders[0].x - START_X) / r.track.length) + 1, 1, r.track.laps);
}
export function fingerprint(r: Race) {
  return JSON.stringify([r.frame, r.elapsed, r.phase, r.seed, r.riders, r.laps]);
}
