import manifest from '../../assets/track-pieces/loop-prototype/manifest.json';
import { LANE_WIDTH, WORLD_SCALE } from '../world-space';
import { clamp, type Rider, type Segment, type Track } from './types';
export type Vec3 = [number, number, number];
export const add = (a: Vec3, b: Vec3): Vec3 => a.map((v, i) => v + b[i]) as Vec3;
export const mul = (a: Vec3, n: number): Vec3 => a.map(v => v * n) as Vec3;
export const sub = (a: Vec3, b: Vec3): Vec3 => add(a, mul(b, -1));
export const dot = (a: Vec3, b: Vec3) => a.reduce((n, v, i) => n + v * b[i], 0);
export const norm = (a: Vec3) => Math.hypot(...a);
export const unit = (a: Vec3): Vec3 => mul(a, 1 / (norm(a) || 1));
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
// Lane spacing stays fixed; each sample has its own riding-surface width.
export const LOOP_WIDTH = LANE_WIDTH / WORLD_SCALE;
const minX = Math.min(...manifest.samples.map(s => s.position[0] - Math.abs(s.lateral[0]) * s.width / 2 - Math.abs(s.normal[0]) * manifest.thickness), ...manifest.beams.flatMap(b => [b.a[0] - b.radius, b.b[0] - b.radius]));
const maxX = Math.max(...manifest.samples.map(s => s.position[0] + Math.abs(s.lateral[0]) * s.width / 2 + Math.abs(s.normal[0]) * manifest.thickness), ...manifest.beams.flatMap(b => [b.a[0] + b.radius, b.b[0] + b.radius]));
export const LOOP_OFFSET = -minX;
export const LOOP_LENGTH = Math.ceil((maxX - minX) / WORLD_SCALE / 8) * 8;
export const LOOP_APPROACH = 320;
export const LOOP_RUNOUT = 320;
export const LOOP_SPACING = LOOP_APPROACH + LOOP_LENGTH + LOOP_RUNOUT;
export const LOOP_FINISH_MARGIN = 24; // Full bike envelope beside the reserved structure volume.
export const LOOP_ENTRY_LANE = 3;
export const LOOP_EXIT_LANE = 0;
// Tire support uses 98% of the real ribbon width, without extending past its edges.
export const LOOP_EDGE = 0.49;
export const isLoop = (s: Pick<Segment, 'piece'>) => s.piece === 'T';
export interface LoopSample {
  position: Vec3;
  tangent: Vec3;
  lateral: Vec3;
  normal: Vec3;
  distance: number;
  pitch: number;
  curvature: number;
  width: number;
}
let distance = 0, lastPitch = 0;
export const LOOP_SAMPLES: LoopSample[] = manifest.samples.map((s, i, all) => {
  const position: Vec3 = [(s.position[0] + LOOP_OFFSET) / WORLD_SCALE, s.position[1] / WORLD_SCALE, s.position[2] / WORLD_SCALE];
  if (i)
    distance += norm(mul(sub(s.position as Vec3, all[i - 1].position as Vec3), 1 / WORLD_SCALE));
  let pitch = Math.atan2(s.tangent[1], s.tangent[0]);
  if (i)
    pitch = lastPitch + wrapAngle(pitch - lastPitch);
  lastPitch = pitch;
  const before = all[Math.max(0, i - 1)], after = all[Math.min(all.length - 1, i + 1)];
  const ds = norm(sub(after.position as Vec3, before.position as Vec3)) / WORLD_SCALE;
  const curvature = dot(sub(after.tangent as Vec3, before.tangent as Vec3), s.normal as Vec3) / (ds || 1);
  return { position, tangent: s.tangent as Vec3, lateral: s.lateral as Vec3, normal: s.normal as Vec3, distance, pitch, curvature, width: s.width / WORLD_SCALE };
});
export const LOOP_DISTANCE = distance;
export const LOOP_ENTRY_X = LOOP_SAMPLES[0].position[0];
export const LOOP_EXIT_X = LOOP_SAMPLES.at(-1)!.position[0];
export const LOOP_EXIT_HEIGHT = LOOP_SAMPLES.at(-1)!.position[1];
export const LOOP_HEIGHT = manifest.height / WORLD_SCALE;
export const LOOP_MANIFEST = manifest;
export function sampleLoop(s: number): LoopSample {
  s = clamp(s, 0, LOOP_DISTANCE);
  let lo = 0, hi = LOOP_SAMPLES.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (LOOP_SAMPLES[mid].distance <= s)
      lo = mid;
    else
      hi = mid;
  }
  const a = LOOP_SAMPLES[lo], b = LOOP_SAMPLES[hi], t = (s - a.distance) / (b.distance - a.distance);
  const mix = (u: Vec3, v: Vec3) => add(u, mul(sub(v, u), t));
  const tangent = unit(mix(a.tangent, b.tangent));
  const lateral = unit(sub([0, 0, 1], mul(tangent, tangent[2])));
  return { position: mix(a.position, b.position), tangent, lateral, normal: cross(lateral, tangent), distance: s,
    pitch: a.pitch + (b.pitch - a.pitch) * t, curvature: a.curvature + (b.curvature - a.curvature) * t,
    width: a.width + (b.width - a.width) * t };
}
export const sampleLane = (s: LoopSample) => s.position[2] / LOOP_WIDTH + 1.5;
export const loopSupportMargin = (s: LoopSample, lane: number) =>
  LOOP_EDGE * s.width / LOOP_WIDTH - Math.abs(lane - sampleLane(s)) / s.lateral[2];
export function loopPosition(s: LoopSample, lane: number): Vec3 {
  return add(s.position, mul(s.lateral, ((lane - 1.5) * LOOP_WIDTH - s.position[2]) / s.lateral[2]));
}
export function riderBasis(p: Readonly<Rider>): Vec3[] {
  if (p.motion.kind === 'loop') {
    const s = sampleLoop(p.motion.distance);
    return [s.tangent, s.normal, s.lateral];
  }
  return p.motion.kind === 'loop-air' ? p.motion.basis : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
}
export const riderLocalTilt = (p: Readonly<Rider>) => p.motion.kind === 'loop' ? p.wheelie : p.motion.kind === 'loop-air' ? p.tilt - p.motion.basisPitch : p.tilt;
const loopIndices = new WeakMap<Track, Segment[]>();
export function loopInstances(track: Track, x: number): {
  segment: Segment;
  origin: number;
}[] {
  let loops = loopIndices.get(track);
  if (!loops) {
    loops = track.segments.filter(isLoop);
    loopIndices.set(track, loops);
  }
  return loops.flatMap(segment => {
    const lap = Math.floor((x - segment.x) / track.length);
    return [lap, lap + 1].map(n => ({ segment, origin: segment.x + n * track.length }));
  });
}
export function maximumLoops(length: number) {
  // Each slot includes its own clear approach and runout. The first slot leaves
  // the start line on floor, and the final runout can reach the end of the lap.
  return Math.max(0, Math.floor(length / LOOP_SPACING));
}
export function loopPlacementError(loop: Segment, items: Segment[], length: number): string | null {
  if (loop.length !== LOOP_LENGTH || loop.lanes !== 15 || loop.surface !== 'dirt' || !loop.boost || loop.profile.length !== 2 || loop.profile.some(p => p[1] !== 0))
    return 'El loop tiene dimensiones y carriles fijos: entrada 4, salida 1.';
  if (loop.x < 80 + LOOP_FINISH_MARGIN && loop.x + LOOP_LENGTH > 80 - LOOP_FINISH_MARGIN)
    return 'El loop debe dejar libre la línea de salida/meta.';
  if (loop.x < 0 || loop.x + LOOP_LENGTH > length)
    return 'El loop debe quedar dentro de la pista.';
  for (const other of items) {
    if (other === loop || other.x >= loop.x + LOOP_LENGTH || other.x + other.length <= loop.x)
      continue;
    if (isLoop(other))
      return 'Los loops no pueden superponerse.';
    if (other.profile.some(p => p[1] > 0))
      return 'No se permiten rampas ni resaltos debajo del loop.';
    if (other.lanes & 8 && LOOP_SAMPLES.some(s => s.position[1] < 36 && loop.x + s.position[0] >= other.x && loop.x + s.position[0] <= other.x + other.length))
      return 'La entrada del loop en el carril 4 debe quedar despejada.';
  }
  return null;
}
export function loopWarnings(items: Segment[]): string[] {
  return items.filter(isLoop).flatMap(loop => items.some(s => s !== loop && !isLoop(s) && s.lanes & 1 && s.x < loop.x + LOOP_EXIT_X + LOOP_RUNOUT && s.x + s.length > loop.x + LOOP_LENGTH)
    ? ['Loop: hay piezas en la zona de aterrizaje del carril 1; el caballito puede alargar el salto.'] : []);
}
