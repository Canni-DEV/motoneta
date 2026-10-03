import { type Race, type RaceConfig, type RaceResult } from './game';
import { crash, move, START_X } from './simulation';
import { heightAt, segmentAt } from './tracks';
import { clamp, Input, type Rider } from './types';

export function createRace(config: RaceConfig): Race {
  const c = structuredClone(config);
  if (c.bots.length > 5 || c.track.laps < 1 || c.track.laps > 9)
    throw new Error('Configuración de carrera inválida.');
  const riders: Rider[] = [c.player, ...c.bots].map((p, id) => ({
    id,
    x: START_X - (id >= 4 ? 24 : 0),
    lane: (id + 2) % 4,
    height: 0,
    vy: 0,
    speed: 0,
    tilt: 0,
    grounded: true,
    heat: 0,
    recovery: 0,
    overheated: false,
    invincible: 0,
    crashes: 0,
    targetLane: (id + 2) % 4,
    color: parseInt(p.color.slice(1), 16),
    previousA: false,
    wheelie: 0,
    wheelieVelocity: 0,
    turbo: false,
    crashKind: 'impact',
    crashAge: 0,
    crashStartTilt: 0,
    crashPhase: 'none',
    crashPhaseAge: 0,
    crashRollDuration: 0,
    crashDownRemaining: 0,
    crashVelocity: 0,
    crashExitX: null,
  }));
  const r: Race = {
    config: c,
    track: c.track,
    seed: c.seed >>> 0,
    riders,
    frame: 0,
    elapsed: 0,
    countdown: 180,
    phase: 'countdown',
    laps: [],
    previousLap: 0,
    events: [],
    rank: 0,
    timeUp: false,
    finishes: [],
    riderLaps: riders.map(() => []),
    limitTicks: Math.max(33750, Math.ceil(((c.track.length * c.track.laps) / 3.125) * 3)),
  };
  return r;
}
function random(r: Race) {
  r.seed = (Math.imul(r.seed, 1664525) + 1013904223) >>> 0;
  return r.seed / 4294967296;
}
function ai(r: Race, p: Rider): number {
  const d = r.config.difficulty;
  if (p.recovery) {
    const period = d === 'easy' ? 10 : d === 'normal' ? 4 : 2;
    return p.crashPhase === 'down' && p.crashPhaseAge >= 16 && r.elapsed % period === 0
      ? Input.A
      : 0;
  }
  const period = d === 'easy' ? 45 : d === 'normal' ? 20 : 8;
  const look = d === 'easy' ? 70 : d === 'normal' ? 150 : 230;
  if (r.elapsed % period === p.id % period) {
    const scores = Array.from({ length: 4 }, (_, lane) => {
      let cost = Math.abs(lane - p.lane) * 8;
      for (let dx = 20; dx <= look; dx += 24) {
        const s = segmentAt(r.track, p.x + dx, lane);
        if (s?.surface === 'mud' || s?.surface === 'grass') cost += 40;
        if (s?.surface === 'cool') cost -= p.heat / 12;
        cost += heightAt(r.track, p.x + dx, lane) * 0.08;
      }
      if (
        r.riders.some(
          (o) => o.id !== p.id && o.x > p.x && o.x - p.x < 70 && Math.abs(o.lane - lane) < 0.5,
        )
      )
        cost += 25;
      return cost + random(r) * (d === 'easy' ? 65 : d === 'normal' ? 18 : 3);
    });
    p.targetLane = scores.indexOf(Math.min(...scores));
  }
  let input: number = p.heat < (d === 'easy' ? 35 : d === 'normal' ? 65 : 78) ? Input.B : Input.A;
  // Easier riders occasionally hesitate; all riders retain identical speed/handling constants.
  if ((d === 'easy' && r.elapsed % 180 < 60) || (d === 'normal' && r.elapsed % 180 < 30)) input = 0;
  if (p.targetLane < p.lane - 0.08) input |= Input.UP;
  if (p.targetLane > p.lane + 0.08) input |= Input.DOWN;
  if (!p.grounded) {
    const slope = Math.atan2(
      heightAt(r.track, p.x + 18, p.lane) - heightAt(r.track, p.x + 2, p.lane),
      16,
    );
    const tolerance = d === 'easy' ? 0.3 : d === 'normal' ? 0.15 : 0.06;
    if (p.tilt > slope + tolerance) input |= Input.RIGHT;
    if (p.tilt < slope - tolerance) input |= Input.LEFT;
  }
  if (p.wheelie > 0.2) input |= Input.RIGHT;
  return input;
}
const identity = (r: Race, id: number) => (id === 0 ? r.config.player : r.config.bots[id - 1]).id;
export const isFinished = (r: Race, id: number) => r.finishes.some((f) => f.id === identity(r, id));
export function abandonPlayer(r: Race) {
  if (!isFinished(r, 0))
    r.finishes.push({
      id: r.config.player.id,
      ticks: null,
      laps: [...r.riderLaps[0]],
      crashes: r.riders[0].crashes,
    });
  r.riders[0].speed = 0;
  if (r.finishes.length === r.riders.length) r.phase = 'finished';
}
export function stepRace(r: Race, input: number) {
  r.events = [];
  if (r.phase === 'finished') return;
  r.frame++;
  if (r.countdown > 0) {
    if (--r.countdown === 0) {
      r.phase = 'racing';
      r.events.push({ type: 'start', rider: 0, frame: r.frame });
    }
    return;
  }
  r.elapsed++;
  for (const p of r.riders) {
    if (isFinished(r, p.id)) continue;
    move(r, p, p.id === 0 ? input : ai(r, p));
    const lap = clamp(Math.floor((p.x - START_X) / r.track.length), 0, r.track.laps);
    if (!p.recovery && lap > r.riderLaps[p.id].length) {
      r.riderLaps[p.id].push(r.elapsed);
      r.events.push({ type: 'lap', rider: p.id, frame: r.frame });
    }
    if (
      (!p.recovery && p.x >= START_X + r.track.length * r.track.laps) ||
      r.elapsed >= r.limitTicks
    ) {
      r.finishes.push({
        id: identity(r, p.id),
        ticks: !p.recovery && p.x >= START_X + r.track.length * r.track.laps ? r.elapsed : null,
        laps: [...r.riderLaps[p.id]],
        crashes: p.crashes,
      });
      r.events.push({ type: 'finish', rider: p.id, frame: r.frame });
      p.speed = 0;
    }
  }
  for (let i = 0; i < r.riders.length; i++)
    for (let j = i + 1; j < r.riders.length; j++) {
      if (isFinished(r, i) || isFinished(r, j)) continue;
      const a = r.riders[i],
        b = r.riders[j];
      // Racers on different laps occupy the same physical section of track.
      const delta =
        ((((a.x - b.x + r.track.length / 2) % r.track.length) + r.track.length) % r.track.length) -
        r.track.length / 2;
      if (
        !a.recovery &&
        !b.recovery &&
        !a.invincible &&
        !b.invincible &&
        Math.abs(delta) < 12 &&
        Math.abs(a.lane - b.lane) < 0.4 &&
        Math.abs(a.height - b.height) < 8
      )
        crash(r, delta < 0 ? a : b);
    }
  r.laps = r.riderLaps[0].map((n) => n * 0.016);
  r.previousLap = r.laps.length;
  const order = r.riders.filter((p) => !isFinished(r, p.id)).sort((a, b) => b.x - a.x);
  r.rank =
    r.finishes.filter((f) => f.ticks !== null).length + order.findIndex((p) => p.id === 0) + 1;
  const own = r.finishes.find((f) => f.id === r.config.player.id);
  if (own) {
    r.timeUp = own.ticks === null;
    r.rank =
      own.ticks === null
        ? r.riders.length
        : 1 + r.finishes.filter((f) => f.ticks !== null && f.ticks < own.ticks!).length;
  }
  if (r.finishes.length === r.riders.length) r.phase = 'finished';
}
export const raceResult = (r: Race): RaceResult => ({
  config: structuredClone(r.config),
  finishes: structuredClone(r.finishes),
  limitTicks: r.limitTicks,
});
export function completeRace(r: Race) {
  while (r.phase !== 'finished') stepRace(r, 0);
  return r;
}
export const clockTime = (r: Race) =>
  (r.finishes.find((f) => f.id === r.config.player.id)?.ticks ?? r.elapsed) * 0.016;
