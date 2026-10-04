import { DRIVE, updateWheelie } from './handling';
import { heightAt, segmentAt } from './tracks';
import { clamp, Input, q, type Race, type Rider } from './types';
import { enterLoop, stepLoop, stepLoopAir, pendingAirCrash, roadImpact, jumpVelocity } from './loop-physics';
import { LOOP_WIDTH } from './loop-geometry';

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
  if (p.motion.kind !== 'track') { pendingAirCrash(p,kind); return; }
  const impactSpeed = Math.max(contactSpeed, p.speed);
  const segment = segmentAt(r.track, p.x, p.lane);
  const localX = ((p.x % r.track.length) + r.track.length) % r.track.length;
  const elevated = segment && segment.profile.some((point) => point[1] > 0);
  const exitX = elevated ? p.x + segment!.x + segment!.length - localX + 11 : null;
  p.crashKind = kind;
  p.crashAge = 0;
  p.crashStartTilt = p.tilt;
  p.crashPhase = 'rolling';
  p.crashPhaseAge = 0;
  p.crashRollDuration =
    exitX === null ? 40 : clamp(Math.ceil((exitX - p.x) / Math.max(1.8, p.speed)), 40, 84);
  p.crashDownRemaining = 68;
  p.crashVelocity = Math.max(0, p.speed);
  p.crashExitX = exitX;
  p.wheelieVelocity = 0;
  p.turbo = false;
  p.recovery = p.crashRollDuration + 68 + 22;
  p.crashes++;
  p.vy = 0;
  p.grounded = true;
  p.height = heightAt(r.track, p.x, p.lane);
  event(r, 'crash', p, {
    impactSpeed,
    surface: segmentAt(r.track, p.x, p.lane)?.surface ?? 'dirt',
    cause: kind,
  });
}
function moveInternal(r: Race, p: Rider, input: number) {
  if(p.motion.kind==='loop-air' && p.motion.pendingCrash) input=0;
  const a = !!(input & Input.A),
    b = !!(input & Input.B),
    edgeA = a && !p.previousA;
  p.previousA = a;
  p.turbo = b && !p.overheated && !p.recovery;
  if (p.invincible) p.invincible--;
  if (p.recovery) {
    p.crashAge++;
    p.crashPhaseAge++;
    p.heat = Math.max(0, p.heat - 0.28);
    if (p.crashPhase === 'rolling') {
      const remaining = p.crashRollDuration - p.crashPhaseAge + 1;
      const needed = p.crashExitX === null ? 0 : Math.max(0, (p.crashExitX - p.x) / remaining);
      p.crashVelocity = q(Math.max(p.crashVelocity * 0.96, needed));
      p.speed = p.crashVelocity;
      p.x = q(p.x + p.speed);
      if (p.crashPhaseAge >= p.crashRollDuration && p.crashExitX !== null)
        p.x = Math.max(p.x, p.crashExitX);
      p.height = heightAt(r.track, p.x, p.lane);
      if (p.crashPhaseAge >= p.crashRollDuration) {
        p.crashPhase = 'down';
        p.crashPhaseAge = 0;
        p.crashVelocity = p.speed = 0;
        p.tilt = 0;
      }
      p.recovery = p.crashRollDuration - p.crashAge + p.crashDownRemaining + 22;
    } else if (p.crashPhase === 'down') {
      p.crashDownRemaining = Math.max(
        0,
        p.crashDownRemaining - 1 - (p.crashPhaseAge > 16 && edgeA ? 18 : 0),
      );
      p.recovery = p.crashDownRemaining + 22;
      if (!p.crashDownRemaining) {
        p.crashPhase = 'mounting';
        p.crashPhaseAge = 0;
      }
    } else if (p.crashPhase === 'mounting') {
      p.recovery = Math.max(0, 22 - p.crashPhaseAge);
    }
    if (p.recovery <= 0) {
      p.crashPhase = 'none';
      p.crashPhaseAge = 0;
      p.crashExitX = null;
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
  if(p.motion.kind === 'loop') { stepLoop(r,p,input); return; }
  if(p.motion.kind === 'loop-air') { stepLoopAir(r,p,input,crash); return; }
  const oldX = p.x,
    oldY = p.height,
    oldGround = heightAt(r.track, p.x, p.lane);
  if (input & Input.UP) p.lane = clamp(p.lane - 0.034, 0, 3);
  if (input & Input.DOWN) p.lane = clamp(p.lane + 0.034, 0, 3);
  p.x = q(p.x + p.speed);
  if (enterLoop(r,p,oldX)) return;
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
      p.vy = jumpVelocity(p.speed,p.tilt);
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
    if (roadImpact(r,[oldX,oldY+10,(p.lane-1.5)*LOOP_WIDTH],[p.x,p.height+10,(p.lane-1.5)*LOOP_WIDTH])) {
      p.motion={kind:'loop-air',origin:oldX,age:0,vx:p.speed,vlane:0,basis:[[1,0,0],[0,1,0],[0,0,1]],basisPitch:0,pendingCrash:'impact',ignoreRoad:0,stuck:0};
      p.speed=q(p.speed*0.45); p.motion.vx=p.speed; p.vy=Math.min(p.vy,-0.5); return;
    }
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
export function move(r: Race, p: Rider, input: number) {
  moveInternal(r,p,input);
  if(p.motion.kind !== 'loop') p.progress=p.x;
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
  return clamp(Math.floor((r.riders[0].progress - START_X) / r.track.length) + 1, 1, r.track.laps);
}
export function fingerprint(r: Race) {
  return JSON.stringify([r.frame, r.elapsed, r.phase, r.seed, r.riders, r.laps]);
}
