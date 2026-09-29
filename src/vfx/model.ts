import { HZ, type Settings, type Track, type Weather } from '../core/types';
import { DRIVE } from '../core/handling';
import { heightAt, segmentAt } from '../core/tracks';
import { hash } from '../stadium-layout';
import { landingLevel, materialFor, type Material } from '../presentation-material';
import { LANE, SCALE, TRACK_LIFE, VFX_INTENSITY, VFX_LIMITS, vfxSettings, windAt } from './config';
import type { Point, VfxFrame, VfxRider } from './frame';

export const KINDS = [
  'dust',
  'clod',
  'water',
  'snow',
  'grass',
  'smoke',
  'steam',
  'air',
  'splash',
] as const;
type Kind = (typeof KINDS)[number];
const linear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const rgb = (n: number) => [
  linear((n >> 16) / 255),
  linear(((n >> 8) & 255) / 255),
  linear((n & 255) / 255),
];
const colors: Record<Material, number[]> = {
  dirt: rgb(0xb79770),
  mud: rgb(0x665447),
  grass: rgb(0x839063),
  wet: rgb(0xb2ccd0),
  snow: rgb(0xe4edf1),
};
const neutral = { smoke: rgb(0xa1a8ae), steam: rgb(0xe3e7e5), air: rgb(0xe3eef2) };

/** Stateless visual randomness: extra draws, quality changes and culling cannot consume a stream. */
export function visualRandom(
  seed: number,
  frame: number,
  rider: number,
  stream: number,
  index: number,
) {
  let h =
    seed ^
    Math.imul(frame + 1, 0x9e3779b1) ^
    Math.imul(rider + 2, 0x85ebca6b) ^
    Math.imul(stream + 3, 0xc2b2ae35) ^
    Math.imul(index + 1, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Fixed-capacity, analytic particles. No objects or integration loop per particle. */
export class VfxModel {
  readonly origins = new Float32Array(1536 * 4); // xyz, birth
  readonly velocities = new Float32Array(1536 * 4); // xyz, lifetime
  readonly styles = new Float32Array(1536 * 4); // size, kind, rotation, opacity
  readonly forces = new Float32Array(1536 * 4); // wind x,z,gravity,ground height
  readonly colors = new Float32Array(1536 * 3);
  readonly priorities = new Int8Array(1536);
  readonly trackPositions = new Float32Array(512 * 18); // six vertices, sampled on terrain
  readonly trackBirth = new Float32Array(512);
  readonly trackColors = new Float32Array(512 * 3);
  readonly trackGroups = new Int8Array(512);
  readonly counts = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  frame = -1;
  time = 0;
  seed = 0;
  finishTime: number | null = null;
  particleRevision = 0;
  trackRevision = 0;
  eventsConsumed = 0;
  discarded = 0;
  cameraAt = -100;
  cameraStrength = 0;
  private cursor = 0;
  private trackCursor = 0;
  private previous = new Map<number, VfxRider>();
  private lastMarks = new Map<number, Point>();
  private ambientFrame = 0;
  private settings!: Settings;
  private reduced = false;
  constructor(
    public track: Track,
    settings: Settings,
  ) {
    this.applySettings(settings);
    this.reset(track);
  }
  applySettings(settings: Settings, reduced = false) {
    this.settings = settings;
    this.reduced = reduced;
    const groups = vfxSettings(settings),
      limit = VFX_LIMITS[settings.quality];
    for (let i = 0; i < 1536; i++) {
      if (
        i >= limit.particles ||
        reduced ||
        (this.priorities[i] === 0 ? !groups.ambient : !groups.race)
      )
        this.styles[i * 4] = 0;
    }
    if (!groups.tracks) this.trackBirth.fill(-100);
    this.trackBirth.fill(-100, limit.tracks);
    this.lastMarks.clear();
    this.particleRevision++;
    this.trackRevision++;
    if (reduced || !settings.cameraShake) this.cameraStrength = 0;
  }
  reset(track = this.track, initialSeed = 0) {
    this.track = track;
    this.seed = hash(JSON.stringify([track.id, track.length, track.segments, initialSeed]));
    this.frame = -1;
    this.time = 0;
    this.finishTime = null;
    this.ambientFrame = 0;
    this.styles.fill(0);
    this.velocities.fill(0);
    this.trackBirth.fill(-100);
    this.previous.clear();
    this.lastMarks.clear();
    this.cursor = this.trackCursor = 0;
    this.eventsConsumed = this.discarded = 0;
    this.cameraAt = -100;
    this.cameraStrength = 0;
    for (const kind of KINDS) this.counts[kind] = 0;
    this.particleRevision++;
    this.trackRevision++;
  }
  private rand(rider: number, stream: number, index: number) {
    return visualRandom(this.seed, this.frame, rider, stream, index);
  }
  private slot(priority: number) {
    const capacity = VFX_LIMITS[this.settings.quality].particles;
    // Last quarter is reserved for bursts; ambient never displaces race contact.
    const limit = priority === 2 ? capacity : Math.floor(capacity * 0.75);
    let replace = -1,
      oldest = Infinity;
    for (let n = 0; n < limit; n++) {
      const i = (this.cursor + n) % limit,
        o = i * 4;
      if (!this.styles[o] || this.origins[o + 3] + this.velocities[o + 3] <= this.time) {
        this.cursor = (i + 1) % limit;
        return i;
      }
      if (this.priorities[i] < priority && this.origins[o + 3] < oldest) {
        oldest = this.origins[o + 3];
        replace = i;
      }
    }
    this.discarded++;
    return replace;
  }
  private emit(
    point: Point,
    material: Material,
    kind: Kind,
    amount: number,
    power: number,
    rider: number,
    stream: number,
    priority: number,
    speed = 0,
  ) {
    const intensity = VFX_INTENSITY[vfxSettings(this.settings).intensity];
    const density = this.settings.quality === 'low' ? 0.55 : 1;
    const expected = amount * intensity * density;
    const count = Math.floor(expected) + Number(this.rand(rider, stream, 900) < expected % 1);
    const wind = windAt(this.time, this.seed);
    for (let n = 0; n < count; n++) {
      const i = this.slot(priority);
      if (i < 0) break;
      const o = i * 4,
        r = this.rand(rider, stream, n * 3),
        s = this.rand(rider, stream, n * 3 + 1),
        t = this.rand(rider, stream, n * 3 + 2);
      const cloud = ['dust', 'smoke', 'steam'].includes(kind),
        air = kind === 'air',
        splash = kind === 'splash';
      const life = cloud ? 0.55 + t * 0.65 : air ? 0.22 : splash ? 0.3 : 0.32 + t * 0.4;
      this.origins.set([point.x, point.y + 0.025, point.z, this.time], o);
      this.velocities.set(
        [
          air
            ? -3.6
            : kind === 'smoke' || kind === 'steam'
              ? speed * SCALE * HZ * 0.12 - 0.4
              : -power * (0.5 + r * 1.3) + speed * SCALE * HZ * 0.16,
          air || splash ? 0 : cloud ? 0.35 + s * power * 0.22 : 0.5 + s * power * 1.5,
          (r - 0.5) * (cloud ? 0.6 : 1.3) * power,
          life,
        ],
        o,
      );
      const size = cloud
        ? 0.22 + r * 0.22
        : air
          ? 0.52
          : splash
            ? 0.13
            : kind === 'snow'
              ? 0.07
              : 0.035 + r * 0.04;
      this.styles.set(
        [
          size * Math.min(1.6, 0.7 + power * 0.3),
          KINDS.indexOf(kind),
          r * Math.PI * 2,
          (cloud ? 0.24 : air ? 0.1 : splash ? 0.3 : 0.8) * Math.min(1.2, intensity),
        ],
        o,
      );
      const floor = heightAt(this.track, point.x / SCALE, point.z / LANE + 1.5) * SCALE;
      this.forces.set(
        [wind.x, wind.z, cloud || air || splash ? 0 : kind === 'snow' ? 1.8 : 6, floor],
        o,
      );
      this.colors.set(
        kind in neutral ? neutral[kind as keyof typeof neutral] : colors[material],
        i * 3,
      );
      if (kind === 'clod') for (let c = 0; c < 3; c++) this.colors[i * 3 + c] *= 0.55;
      this.priorities[i] = priority;
      this.counts[kind]++;
      this.particleRevision++;
    }
  }
  private contact(
    point: Point,
    material: Material,
    count: number,
    power: number,
    p: VfxRider,
    stream: number,
    priority = 1,
  ) {
    const kind: Kind =
      material === 'wet'
        ? 'water'
        : material === 'snow'
          ? 'snow'
          : material === 'grass'
            ? 'grass'
            : 'clod';
    this.emit(point, material, kind, count, power, p.id, stream, priority, p.speed);
    if (material === 'wet')
      this.emit(
        point,
        'mud',
        'clod',
        count * 0.25,
        power * 0.8,
        p.id,
        stream + 2,
        priority,
        p.speed,
      );
    else if (this.weather === 'rain' && (material === 'mud' || material === 'grass'))
      this.emit(
        point,
        'wet',
        'water',
        count * 0.3,
        power * 0.8,
        p.id,
        stream + 2,
        priority,
        p.speed,
      );
    if (material === 'dirt' || material === 'mud' || material === 'snow')
      this.emit(
        point,
        material,
        'dust',
        count * (material === 'mud' ? 0.1 : 0.35),
        power,
        p.id,
        stream + 1,
        priority,
        p.speed,
      );
  }
  private mark(p: VfxRider, point: Point, wheel: number) {
    const key = p.id * 2 + wheel,
      prev = this.lastMarks.get(key);
    this.lastMarks.set(key, point);
    if (!prev) return;
    const dx = point.x - prev.x,
      dz = point.z - prev.z,
      distance = Math.hypot(dx, dz);
    if (distance < 0.25) {
      this.lastMarks.set(key, prev);
      return;
    }
    if (distance > 0.9 || Math.abs(point.y - prev.y) > distance * 1.4 + 0.06) return;
    const mx = (point.x + prev.x) / 2,
      mz = (point.z + prev.z) / 2;
    const middle = heightAt(this.track, mx / SCALE, mz / LANE + 1.5) * SCALE;
    if (Math.abs(middle - (point.y + prev.y) / 2) > 0.09) return;
    const index = this.trackCursor++ % VFX_LIMITS[this.settings.quality].tracks;
    const w = 0.047,
      nx = (-dz / distance) * w,
      nz = (dx / distance) * w;
    const corners = [
      [prev.x + nx, prev.z + nz],
      [prev.x - nx, prev.z - nz],
      [point.x + nx, point.z + nz],
      [point.x - nx, point.z - nz],
    ];
    const order = [0, 1, 2, 2, 1, 3];
    for (let j = 0; j < 6; j++) {
      const [x, z] = corners[order[j]],
        lane = z / LANE + 1.5;
      const segment = segmentAt(this.track, x / SCALE, lane);
      const y =
        heightAt(this.track, x / SCALE, lane) * SCALE +
        (segment && segment.surface !== 'dirt' && !segment.profile.some((v) => v[1] > 0)
          ? 0.04
          : 0.014);
      this.trackPositions.set([x, y, z], index * 18 + j * 3);
    }
    const material = materialFor(p.surface, this.weather);
    const tint =
      material === 'snow'
        ? rgb(0x8a9aa1)
        : material === 'wet'
          ? rgb(0x685342)
          : colors[material].map((v) => v * 0.34);
    this.trackColors.set(tint, index * 3);
    this.trackBirth[index] = this.time;
    this.trackGroups[index] = p.id;
    this.trackRevision++;
  }
  private weather: Weather = 'clear';
  step(f: VfxFrame) {
    if (f.frame <= this.frame || this.finishTime !== null) return;
    this.frame = f.frame;
    this.time = f.frame / HZ;
    this.weather = f.weather;
    const groups = vfxSettings(this.settings),
      enabled = groups.race && !this.reduced;
    const player = f.riders[0];
    const seen = new Set<string>();
    for (const e of f.events) {
      const key = `${e.frame}:${e.rider}:${e.type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.eventsConsumed++;
      const p = f.riders.find((p) => p.id === e.rider);
      if (!p) continue;
      const distance =
        Math.abs(
          ((((p.x - player.x + this.track.length / 2) % this.track.length) + this.track.length) %
            this.track.length) -
            this.track.length / 2,
        ) * SCALE;
      const material = materialFor(e.surface ?? p.surface, f.weather),
        level = landingLevel(e.impactSpeed ?? 2);
      if (
        e.rider === 0 &&
        this.settings.cameraShake &&
        !this.reduced &&
        (e.type === 'crash' || (e.type === 'land' && level > 0))
      ) {
        this.cameraAt = this.time;
        this.cameraStrength = e.type === 'crash' ? 0.095 : level === 2 ? 0.065 : 0.025;
      }
      if (!enabled || distance > 42) continue;
      if (e.type === 'land' || e.type === 'crash') {
        const crash = e.type === 'crash',
          backflip = e.cause === 'backflip';
        const power = (0.8 + level * 0.6) * (backflip ? 0.75 : 1),
          count = [8, 15, 24][level] * (crash ? 1.4 : 1) * (distance > 20 ? 0.4 : 1);
        const primary = p.anchors.rearContact ? p.anchors.rear : p.anchors.front;
        this.contact(primary, material, count, power, p, 100 + (crash ? 10 : 0), 2);
        if (p.anchors.frontContact && p.anchors.rearContact)
          this.contact(
            p.anchors.front,
            material,
            count * (backflip ? 0.2 : 0.55),
            power * 0.8,
            p,
            104,
            2,
          );
        if (crash)
          this.emit(
            {
              ...p.anchors.engine,
              y: heightAt(this.track, p.anchors.engine.x / SCALE, p.lane) * SCALE + 0.08,
            },
            material,
            material === 'wet' ? 'water' : 'dust',
            8,
            0.55,
            p.id,
            115,
            2,
          );
      }
      if (e.type === 'jump') this.contact(p.anchors.rear, material, 5, 0.6, p, 120);
      if (e.type === 'cool') this.emit(p.anchors.engine, material, 'steam', 6, 0.5, p.id, 130, 2);
    }
    for (const p of f.riders) {
      const previous = this.previous.get(p.id),
        material = materialFor(p.surface, f.weather);
      const separation =
        Math.abs(
          ((((p.x - player.x + this.track.length / 2) % this.track.length) + this.track.length) %
            this.track.length) -
            this.track.length / 2,
        ) * SCALE;
      const nearby = separation < 42;
      const relocated = previous && Math.abs(p.x - previous.x) * SCALE > 1.2;
      if (relocated || !p.grounded || p.recovery || !groups.tracks || !nearby) {
        this.lastMarks.delete(p.id * 2);
        this.lastMarks.delete(p.id * 2 + 1);
      } else {
        if (p.anchors.rearContact) this.mark(p, p.anchors.rear, 0);
        else this.lastMarks.delete(p.id * 2);
        if (p.anchors.frontContact) this.mark(p, p.anchors.front, 1);
        else this.lastMarks.delete(p.id * 2 + 1);
      }
      if (enabled && nearby && f.phase === 'racing' && !f.finished && !relocated) {
        const distanceFactor = separation > 20 ? 0.4 : 1;
        const load = p.turbo ? 1.7 : p.previousA ? 1.15 : 0.45;
        const acceleration = previous ? Math.max(0, p.speed - previous.speed) : 0;
        const rate = (Math.min(85, p.speed * 12 * load + acceleration * 60) * distanceFactor) / HZ;
        if (!p.recovery && p.speed > 0.2) {
          if (p.anchors.rearContact)
            this.contact(p.anchors.rear, material, rate, p.turbo ? 1.25 : 0.7, p, 1);
          if (p.anchors.frontContact)
            this.contact(p.anchors.front, material, rate * 0.22, 0.45, p, 4);
          if (!p.grounded && (p.speed > DRIVE.normalSpeed || p.clearance > 16))
            this.emit(p.anchors.engine, material, 'air', 12 / HZ, 0.5, p.id, 8, 1);
          if (p.previousA || p.turbo)
            this.emit(
              p.anchors.exhaust,
              material,
              'smoke',
              (p.turbo ? 10 : 5) / HZ,
              0.3,
              p.id,
              12,
              1,
              p.speed,
            );
        }
        if (p.overheated)
          this.emit(p.anchors.engine, material, 'steam', 17 / HZ, 0.7, p.id, 15, 1, p.speed);
      }
      this.previous.set(p.id, p);
    }
    if (groups.ambient && !this.reduced && !f.finished) this.ambient(player.x * SCALE, f.weather);
    if (f.finished) this.finishTime = this.time;
  }
  private ambient(focus: number, weather: Weather) {
    if (this.frame % 4 !== 0) return;
    const x = focus + (this.rand(-1, 201, 0) - 0.5) * 44;
    const z =
      weather === 'rain'
        ? (this.rand(-1, 201, 1) - 0.5) * LANE * 4
        : (this.rand(-1, 201, 1) < 0.5 ? -1 : 1) * (3.3 + this.rand(-1, 201, 2) * 1.7);
    const point = {
      x,
      y:
        weather === 'rain'
          ? heightAt(this.track, x / SCALE, z / LANE + 1.5) * SCALE + 0.015
          : -0.05,
      z,
    };
    this.emit(
      point,
      materialFor('dirt', weather),
      weather === 'rain' ? 'splash' : weather === 'snow' ? 'snow' : 'dust',
      weather === 'rain' ? 3 : 0.7,
      0.45,
      -1,
      200,
      0,
    );
  }
  ambientStep(time: number, focus: number, weather: Weather) {
    const target = Math.floor(time * HZ);
    // Menu/editor have a bounded independent fixed clock; no catch-up after pause.
    for (let i = this.ambientFrame + 1; i <= Math.min(target, this.ambientFrame + 10); i++) {
      this.frame = i;
      this.time = i / HZ;
      if (vfxSettings(this.settings).ambient && !this.reduced) this.ambient(focus, weather);
    }
    this.ambientFrame = target;
  }
  cameraOffset(time: number) {
    const age = time - this.cameraAt;
    return age >= 0 && age < 0.6
      ? Math.sin(age * 48) * Math.exp(-age * 11) * this.cameraStrength
      : 0;
  }
  diagnostics(time = this.time) {
    const limits = VFX_LIMITS[this.settings.quality];
    let active = 0,
      marks = 0;
    for (let i = 0; i < limits.particles; i++)
      if (
        this.styles[i * 4] &&
        time >= this.origins[i * 4 + 3] &&
        time < this.origins[i * 4 + 3] + this.velocities[i * 4 + 3]
      )
        active++;
    for (let i = 0; i < limits.tracks; i++)
      if (time >= this.trackBirth[i] && time - this.trackBirth[i] < TRACK_LIFE) marks++;
    return {
      frame: this.frame,
      time,
      seed: this.seed,
      active,
      marks,
      limits,
      counts: { ...this.counts },
      eventsConsumed: this.eventsConsumed,
      discarded: this.discarded,
      finished: this.finishTime !== null,
    };
  }
}
