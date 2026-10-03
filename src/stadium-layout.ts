import { HZ, type Race, type Track } from './core/types';
import { heightAt } from './core/tracks';

import { WORLD_SCALE } from './world-space';
export { WORLD_SCALE } from './world-space';
export const ROWS = 10;
export const ROW_DEPTH = 0.76;
export const ROW_RISE = 0.37;
export const FRONT_Z = -7;

export function hash(text: string): number {
  let n = 2166136261;
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return n >>> 0;
}
export function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export const modulo = (x: number, length: number) => ((x % length) + length) % length;
export interface StadiumLayout {
  seed: number;
  count: number;
  width: number;
  loop: number;
}
export function stadiumLayout(track: Track): StadiumLayout {
  const loop = track.length * WORLD_SCALE,
    count = Math.max(1, Math.ceil(loop / 18));
  return {
    seed: hash(JSON.stringify([track.id, track.length, track.segments])),
    count,
    width: loop / count,
    loop,
  };
}
export interface Seat {
  x: number;
  y: number;
  z: number;
  occupied: boolean;
  variant: number;
  standing: boolean;
  phase: number;
  speed: number;
  clap: number;
  scale: number;
  shirt: number;
  skin: number;
  hair: number;
}
export function sectorSeats(layout: StadiumLayout, logical: number): Seat[] {
  const next = random(hash(`${layout.seed}:${modulo(logical, layout.count)}`));
  // Leave a full stair aisle at every boundary. Column spacing closes each loop exactly.
  const columns = Math.floor((layout.width - 1.4) / 0.55);
  const spacing = (layout.width - 1.4) / columns;
  const seats: Seat[] = [];
  for (let row = 0; row < ROWS; row++)
    for (let c = 0; c < columns; c++) {
      seats.push({
        x: 0.7 + (c + 0.5) * spacing,
        y: 0.22 + row * ROW_RISE,
        z: FRONT_Z - row * ROW_DEPTH,
        occupied: next() < 0.92,
        variant: next() < 0.5 ? 0 : 1,
        standing: next() < 0.12,
        phase: next(),
        speed: 0.45 + next() * 0.35,
        clap: next() < 0.36 ? 0.85 : 0,
        scale: 0.94 + next() * 0.08,
        shirt: Math.floor(next() * 8),
        skin: Math.floor(next() * 5),
        hair: Math.floor(next() * 4),
      });
    }
  return seats;
}

/** Pure visual state: never uses or mutates the simulation's RNG. */
export class StadiumMotion {
  time = 0;
  frame = 0;
  finished = false;
  finishTime = 0;
  jumped = false;
  private flights = new Set<number>();
  private positions = new Map<number, number>();
  reactions = new Map<number, { time: number; strength: number }>();
  constructor(public layout: StadiumLayout) {}
  reset(layout = this.layout) {
    this.layout = layout;
    this.time = 0;
    this.frame = 0;
    this.finished = false;
    this.finishTime = 0;
    this.jumped = false;
    this.flights.clear();
    this.positions.clear();
    this.reactions.clear();
  }
  react(x: number, startled = false) {
    const local = x * WORLD_SCALE;
    const center = Math.floor(local / this.layout.width);
    for (let offset = -1; offset <= 1; offset++) {
      const absolute = center + offset,
        logical = modulo(absolute, this.layout.count);
      const distance = Math.abs((absolute + 0.5) * this.layout.width - local);
      const strength = Math.max(0, 1 - distance / (this.layout.width * 1.55));
      const previous = this.reactions.get(logical);
      if (previous?.time === this.time) {
        if (startled || previous.strength >= 0)
          previous.strength = (startled ? -1 : 1) * Math.max(Math.abs(previous.strength), strength);
        continue;
      }
      if (strength <= 0 || (previous && this.time - previous.time < 3)) continue;
      this.reactions.set(logical, { time: this.time, strength: startled ? -strength : strength });
    }
  }
  step(race: Race) {
    if (race.frame <= this.frame) return;
    this.frame = race.frame;
    this.time = race.frame / HZ;
    for (const p of race.riders) {
      if (p.grounded) this.flights.delete(p.id);
      if (
        !p.grounded &&
        !this.flights.has(p.id) &&
        p.height - heightAt(race.track, p.x, p.lane) > 16
      ) {
        this.react(p.x);
        this.flights.add(p.id);
      }
      for (const other of race.riders) {
        if (other.id <= p.id || p.recovery || other.recovery) continue;
        const a = this.positions.get(p.id),
          b = this.positions.get(other.id);
        // Continuous race progress, not wrapped screen positions; ignore teleports and starts.
        if (
          a === undefined ||
          b === undefined ||
          Math.abs(p.x - a) > 10 ||
          Math.abs(other.x - b) > 10
        )
          continue;
        if (
          (a - b) * (p.x - other.x) < 0 &&
          race.phase === 'racing' &&
          Math.abs(p.x - other.x) < 30
        )
          this.react((p.x + other.x) / 2);
      }
    }
    for (const p of race.riders) this.positions.set(p.id, p.x);
    this.jumped = this.flights.has(0);
    for (const event of race.events) {
      const p = race.riders.find((p) => p.id === event.rider);
      if (!p) continue;
      if (event.type === 'crash') this.react(p.x, true);
      if (event.type === 'lap' || (event.type === 'finish' && !race.timeUp)) this.react(p.x);
    }
    if (race.phase === 'finished' && !this.finished) {
      this.finished = true;
      this.finishTime = this.time;
    }
    for (const [key, reaction] of this.reactions)
      if (this.time - reaction.time > 3) this.reactions.delete(key);
  }
}
