import * as THREE from 'three';
import { heightAt } from './core/tracks';
import { HZ, type Race } from './core/types';
import type { CinematicMoment, CinematicPose, CinematicTimeline } from './cinematic-timeline';

import { WORLD_SCALE as SCALE, LANE_WIDTH as LANE } from './world-space';
const clamp = THREE.MathUtils.clamp;
const MIN_SHOT = 2.5;
type Shot = 'opening' | 'chase' | 'front' | 'ground' | 'drone' | 'helmet' | 'mounted' | 'tripod' | 'crowd' | 'safe';
type Pose = Pick<CinematicPose, 'x' | 'y' | 'z'>;
type Composition = { position: THREE.Vector3; target: THREE.Vector3; fov: number };
type Choice = { shot: Shot; anchor?: THREE.Vector3; moment?: CinematicMoment };
export interface CinematicCut {
  frame: number;
  at: number;
  shot: Shot;
  reason: string;
  lap: number;
}

const normalOrder: Shot[] = ['tripod', 'ground', 'mounted', 'chase', 'crowd', 'front', 'helmet', 'drone'];
const family = (shot: Shot) => shot === 'tripod' || shot === 'crowd' ? 'fixed'
  : shot === 'helmet' || shot === 'mounted' ? 'mounted'
    : shot === 'drone' ? 'aerial'
      : shot === 'ground' || shot === 'front' ? 'trackside' : 'follow';

export class CinematicCamera {
  readonly camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.055, 180);
  readonly cuts: CinematicCut[] = [];
  private shot: Shot = 'opening';
  private elapsed = 0;
  private cutAt = 0;
  private holdUntilFrame = -1;
  private droneSeconds = 0;
  private lap = -1;
  private familySeconds = new Map<string, number>();
  private fixedLaps = new Set<number>();
  private recent: Shot[] = [];
  private position = new THREE.Vector3();
  private target = new THREE.Vector3();
  private look = new THREE.Vector3();
  private point = new THREE.Vector3();
  private anchor = new THREE.Vector3();
  private cutPending = true;
  private ready = false;
  private obstructedFor = 0;
  private protectedUntil = 0;
  private testCamera = new THREE.PerspectiveCamera(58, 16 / 9, 0.055, 180);
  constructor(public timeline: CinematicTimeline) {}

  get currentShot() { return this.shot; }
  diagnostics() {
    return {
      shot: this.shot,
      cuts: this.cuts.map((cut, index) => ({
        ...cut,
        duration: Math.max(0, (this.cuts[index + 1]?.at ?? this.elapsed) - cut.at),
      })),
      droneSeconds: this.droneSeconds,
      droneLimit: this.droneLimit(),
      fixedLaps: [...this.fixedLaps],
    };
  }

  private droneLimit() {
    const slowFrames = this.timeline.slowMotion.reduce((sum, window) => sum + window.end - window.start, 0);
    return Math.max(0, (this.timeline.lastFrame - 180 + slowFrames) / HZ * 0.15);
  }
  private trackHeight(race: Race, x: number, lane: number) {
    return heightAt(race.track, x / SCALE, lane) * SCALE;
  }
  private blocked(race: Race, from: THREE.Vector3, to: THREE.Vector3) {
    for (let step = 1; step <= 18; step++) {
      const t = step / 20;
      this.point.copy(from).lerp(to, t);
      if (Math.abs(this.point.z) > LANE * 2) continue;
      const lane = clamp(Math.round(this.point.z / LANE + 1.5), 0, 3);
      if (this.point.y - t * 0.5 < this.trackHeight(race, this.point.x, lane) + 0.16) return true;
    }
    return false;
  }
  private poseAt(frame: number, fallback: Pose): Pose {
    const poses = this.timeline.poses;
    if (!poses.length) return fallback;
    let low = 0, high = poses.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (poses[mid].frame < frame) low = mid + 1;
      else high = mid;
    }
    const next = poses[low];
    const prev = poses[Math.max(0, low - 1)];
    if (next.frame === prev.frame) return next;
    const t = clamp((frame - prev.frame) / (next.frame - prev.frame), 0, 1);
    return { x: THREE.MathUtils.lerp(prev.x, next.x, t), y: THREE.MathUtils.lerp(prev.y, next.y, t), z: THREE.MathUtils.lerp(prev.z, next.z, t) };
  }
  private compose(shot: Shot, race: Race, pose: Pose, anchor?: THREE.Vector3): Composition {
    const { x, y, z } = pose;
    const lane = clamp(Math.round(z / LANE + 1.5), 0, 3);
    const groundY = this.trackHeight(race, x, lane);
    const airborne = Math.max(0, y - groundY);
    const position = new THREE.Vector3();
    const target = new THREE.Vector3();
    let fov = 58;
    switch (shot) {
      case 'opening': {
        const progress = 1 - Math.max(0, race.countdown) / 180;
        position.set(x - 8 + progress * 4.5, groundY + 7.5 - progress * 3.7, 11 - progress * 4.5);
        target.set(x + 1, y + 1, z);
        fov = 54;
        break;
      }
      case 'chase':
        position.set(x - 5.8, groundY + 4.6 + Math.min(0.6, airborne * 0.15), 6.2);
        target.set(x + 2.2, y + 1, z);
        fov = 56;
        break;
      case 'front':
        position.set(x + 6.2, groundY + 4.2 + Math.min(0.6, airborne * 0.15), 6.2);
        target.set(x, y + 1, z);
        fov = 52;
        break;
      case 'ground':
        position.set(x + 4.5, this.trackHeight(race, x + 4.5, 3) + 1.2, 4.7);
        target.set(x + 0.5, y + 0.95, z);
        fov = 61;
        break;
      case 'drone':
        position.set(x - 5, groundY + 14.5 + Math.min(0.8, airborne * 0.1), 8);
        target.set(x + 2.5, y + 0.8, z);
        fov = 51;
        break;
      case 'helmet':
        position.set(x + 0.25, y + 1.55, z);
        target.set(x + 8, y + 1.05, z - 1.2);
        fov = 68;
        break;
      case 'mounted':
        position.set(x - 0.55, y + 1.05, z + 2.2);
        target.set(x + 1.5, y + 0.9, z - 0.35);
        fov = 66;
        break;
      case 'tripod':
      case 'crowd':
        position.copy(anchor!);
        target.set(x, y + 0.85, z);
        fov = shot === 'tripod'
          ? clamp(58 * 18 / position.distanceTo(target), 28, 58)
          : clamp(60 * 20 / position.distanceTo(target), 29, 60);
        break;
      case 'safe':
        position.set(x - 2.5, groundY + 7.2, 9.5);
        target.set(x + 1, y + 1, z);
        fov = 55;
        break;
    }
    return { position, target, fov };
  }
  private validate(shot: Shot, race: Race, pose: Pose, aspect: number, moment?: CinematicMoment, anchor?: THREE.Vector3) {
    const start = race.frame;
    const lapEnd = this.timeline.lapEnds[race.laps.length] ?? this.timeline.lastFrame;
    const end = Math.min(this.timeline.lastFrame || start, Math.max(start + 4 * HZ, (moment?.end ?? 0) + 12));
    const samples = [start];
    for (let frame = start + 6; frame < end; frame += 6) samples.push(frame);
    if (end > start) samples.push(end);
    if (shot === 'tripod' || shot === 'crowd') {
      if (!anchor || lapEnd - start < 2.5 * HZ) return false;
      const passed = this.timeline.poses.some((sample) => sample.frame >= start && sample.frame <= Math.min(lapEnd, end + HZ) && sample.x >= anchor.x + 1);
      if (!passed) return false;
    }
    const predictedPosition = new THREE.Vector3();
    const predictedLook = new THREE.Vector3();
    let predictedFov = 58;
    let previousFrame = start;
    for (const frame of samples) {
      const subject = frame === start ? pose : this.poseAt(frame, pose);
      const { position, target, fov } = this.compose(shot, race, subject, anchor);
      if (shot !== 'helmet' && shot !== 'mounted') {
        if (frame === start) {
          predictedPosition.copy(position);
          predictedLook.copy(target);
          predictedFov = fov;
        } else {
          const seconds = (frame - previousFrame) / HZ;
          const follow = 1 - Math.exp(-12 * seconds);
          const vertical = 1 - Math.exp(-3.5 * seconds);
          if (shot === 'tripod' || shot === 'crowd') predictedPosition.copy(position);
          else {
            predictedPosition.x += (position.x - predictedPosition.x) * follow;
            predictedPosition.z += (position.z - predictedPosition.z) * follow;
            predictedPosition.y += (position.y - predictedPosition.y) * vertical;
          }
          predictedLook.x += (target.x - predictedLook.x) * follow;
          predictedLook.z += (target.z - predictedLook.z) * follow;
          predictedLook.y += (target.y - predictedLook.y) * vertical;
          predictedFov += (fov - predictedFov) * follow;
        }
        previousFrame = frame;
        const cameraLane = clamp(Math.round(predictedPosition.z / LANE + 1.5), 0, 3);
        const clearance = shot === 'ground' ? 0.35 : 0.45;
        if (predictedPosition.y < this.trackHeight(race, predictedPosition.x, cameraLane) + clearance ||
          this.blocked(race, predictedPosition, predictedLook)) return false;
        if (predictedPosition.z <= subject.z + 1.4) return false;
        this.testCamera.position.copy(predictedPosition);
        this.testCamera.lookAt(predictedLook);
        this.testCamera.fov = predictedFov;
        this.testCamera.aspect = aspect;
        this.testCamera.updateProjectionMatrix();
        this.testCamera.updateMatrixWorld();
        const screen = new THREE.Vector3(subject.x, subject.y + 0.85, subject.z).project(this.testCamera);
        if (Math.abs(screen.x) > 0.76 || Math.abs(screen.y) > 0.76 || screen.z < -1 || screen.z > 1) return false;
      }
    }
    return true;
  }
  private fixedChoice(shot: 'tripod' | 'crowd', race: Race, pose: Pose, aspect: number, moment?: CinematicMoment): Choice | null {
    const speed = race.riders[0].speed * SCALE * HZ;
    const lead = clamp(speed * 1.8, 8, 24);
    const offsets = [lead, clamp(lead - 4, 8, 24), clamp(lead + 4, 8, 28)];
    const side = shot === 'tripod' ? 4.9 : 8.5;
    const clearance = shot === 'tripod' ? 2.3 : 4.4;
    for (const height of [clearance, clearance + 1.8, clearance + 3.2])
      for (const offset of offsets) {
        const ahead = pose.x + offset;
        const anchor = new THREE.Vector3(ahead, this.trackHeight(race, ahead, 3) + height, side);
        if (this.validate(shot, race, pose, aspect, moment, anchor)) return { shot, anchor, moment };
      }
    return null;
  }
  private candidate(shot: Shot, race: Race, pose: Pose, aspect: number, moment?: CinematicMoment): Choice | null {
    if (shot === this.shot || (this.recent.includes(shot) && !moment)) return null;
    if (shot === 'drone') {
      const visibleLength = Math.max(4, (moment ? (moment.end - race.frame) / HZ + 0.3 : 4));
      if (this.droneSeconds + visibleLength > this.droneLimit()) return null;
    }
    if (shot === 'tripod' || shot === 'crowd') return this.fixedChoice(shot, race, pose, aspect, moment);
    return this.validate(shot, race, pose, aspect, moment) ? { shot, moment } : null;
  }
  private nextMoment(frame: number) {
    return this.timeline.moments.find((moment) => moment.end >= frame && moment.start >= frame && moment.start - frame <= 150);
  }
  private choose(race: Race, pose: Pose, aspect: number, moment?: CinematicMoment): Choice {
    const lap = race.laps.length;
    let order: Shot[];
    if (moment) {
      order = moment.type === 'jump' ? ['ground', 'front', 'tripod', 'chase', 'mounted', 'crowd', 'drone']
        : moment.type === 'duel' ? ['front', 'chase', 'ground', 'tripod', 'mounted', 'crowd']
          : moment.type === 'crash' ? ['ground', 'front', 'crowd', 'chase', 'tripod']
            : ['crowd', 'tripod', 'front', 'chase'];
      const preferred = new Map(order.map((shot, index) => [shot, index]));
      order.sort((a, b) => {
        const priority = (shot: Shot) => (preferred.get(shot) ?? 0) * 0.35 +
          (this.recent.includes(shot) ? 4 : 0) +
          (this.recent.length && family(this.recent[0]) === family(shot) ? 2 : 0) +
          (this.familySeconds.get(family(shot)) ?? 0) * 0.6;
        return priority(a) - priority(b);
      });
    } else {
      const lapRemaining = (this.timeline.lapEnds[lap] ?? this.timeline.lastFrame) - race.frame;
      const fixedDue = !this.fixedLaps.has(lap) && lapRemaining >= 3 * HZ;
      order = [...normalOrder].sort((a, b) => {
        const priority = (shot: Shot) =>
          (fixedDue && family(shot) === 'fixed' ? -100 : 0) +
          (this.recent.includes(shot) ? 100 : 0) +
          (this.recent.length && family(this.recent[0]) === family(shot) ? 20 : 0) +
          (this.familySeconds.get(family(shot)) ?? 0) + normalOrder.indexOf(shot) * 0.01;
        return priority(a) - priority(b);
      });
    }
    for (const shot of order) {
      const choice = this.candidate(shot, race, pose, aspect, moment);
      if (choice) return choice;
    }
    return { shot: 'safe', moment };
  }
  private cut(choice: Choice, race: Race, reason: string) {
    if (choice.shot === this.shot) return;
    this.shot = choice.shot;
    this.anchor.copy(choice.anchor ?? new THREE.Vector3());
    this.cutAt = this.elapsed;
    this.cutPending = true;
    this.obstructedFor = 0;
    this.protectedUntil = this.elapsed + MIN_SHOT;
    this.holdUntilFrame = choice.moment ? choice.moment.end + 12 : -1;
    if (choice.shot === 'tripod' || choice.shot === 'crowd') {
      this.fixedLaps.add(race.laps.length);
      const pass = this.timeline.poses.find((pose) => pose.frame >= race.frame && pose.x >= this.anchor.x + 1);
      if (pass) this.holdUntilFrame = Math.max(this.holdUntilFrame, pass.frame + 24);
    }
    this.recent.unshift(choice.shot);
    this.recent.length = Math.min(this.recent.length, 2);
    this.cuts.push({ frame: race.frame, at: this.elapsed, shot: choice.shot, reason, lap: race.laps.length });
  }
  update(race: Race, player: Pose, dt: number, aspect: number, paused: boolean, beatDelay: number | null) {
    const frameDt = clamp(dt, 0, 0.1);
    if (!paused) {
      this.elapsed += frameDt;
      if (race.phase !== 'countdown') {
        if (this.lap !== race.laps.length) {
          this.lap = race.laps.length;
          this.familySeconds.clear();
        }
        this.familySeconds.set(family(this.shot), (this.familySeconds.get(family(this.shot)) ?? 0) + frameDt);
        if (this.shot === 'drone') this.droneSeconds += frameDt;
      }
    }
    if (race.phase !== 'countdown' && this.shot === 'opening')
      this.cut(this.choose(race, player, aspect, this.nextMoment(race.frame)), race, 'salida');
    const age = this.elapsed - this.cutAt;
    const beatReady = beatDelay === null ? this.elapsed % 0.5 < 0.05 : beatDelay < 0.07;
    if (!paused && race.phase !== 'countdown' && age >= MIN_SHOT && this.elapsed >= this.protectedUntil) {
      const ongoing = this.timeline.moments.some((moment) => moment.start < race.frame && race.frame <= moment.end);
      if (race.frame > this.holdUntilFrame && !ongoing) {
        const moment = this.nextMoment(race.frame);
        if (moment && ((age >= 4 && (beatReady || age >= 8)) ||
          (moment.start - race.frame <= 72 && (beatReady || moment.start - race.frame <= 45))))
          this.cut(this.choose(race, player, aspect, moment), race, `evento:${moment.type}`);
        else if (age >= 8 || (age >= 4 && beatReady) || (this.shot === 'drone' && this.droneSeconds >= this.droneLimit()))
          this.cut(this.choose(race, player, aspect), race, 'ritmo');
      }
    }
    const { position, target, fov } = this.compose(this.shot, race, player, this.anchor);
    this.position.copy(position);
    this.target.copy(target);
    const attached = this.shot === 'helmet' || this.shot === 'mounted';
    const fixed = this.shot === 'tripod' || this.shot === 'crowd';
    if (!this.ready || this.cutPending) {
      this.camera.position.copy(this.position);
      this.look.copy(this.target);
      this.camera.fov = fov;
      this.ready = true;
      this.cutPending = false;
    } else if (!paused) {
      const follow = 1 - Math.exp(-12 * Math.min(frameDt, 0.05));
      const vertical = 1 - Math.exp(-3.5 * Math.min(frameDt, 0.05));
      if (fixed || attached) this.camera.position.copy(this.position);
      else {
        this.camera.position.x += (this.position.x - this.camera.position.x) * follow;
        this.camera.position.z += (this.position.z - this.camera.position.z) * follow;
        this.camera.position.y += (this.position.y - this.camera.position.y) * vertical;
      }
      if (attached) this.look.copy(this.target);
      else {
        this.look.x += (this.target.x - this.look.x) * follow;
        this.look.z += (this.target.z - this.look.z) * follow;
        this.look.y += (this.target.y - this.look.y) * vertical;
      }
      this.camera.fov += (fov - this.camera.fov) * follow;
    }
    if (!paused && this.shot !== 'opening' && this.shot !== 'safe' && !attached) {
      const lane = clamp(Math.round(this.camera.position.z / LANE + 1.5), 0, 3);
      const floor = this.trackHeight(race, this.camera.position.x, lane);
      const hidden = this.camera.position.y < floor + (this.shot === 'ground' ? 0.35 : 0.45) ||
        this.blocked(race, this.camera.position, this.look);
      this.obstructedFor = hidden ? this.obstructedFor + frameDt : 0;
      if (this.obstructedFor >= 0.2) {
        this.cut({ shot: 'safe' }, race, 'seguridad');
        const safe = this.compose('safe', race, player);
        this.camera.position.copy(safe.position);
        this.look.copy(safe.target);
        this.camera.fov = safe.fov;
        this.cutPending = false;
      }
    }
    if (this.shot === 'safe') {
      const lane = clamp(Math.round(this.camera.position.z / LANE + 1.5), 0, 3);
      this.camera.position.y = Math.max(this.camera.position.y, this.trackHeight(race, this.camera.position.x, lane) + 4);
    }
    this.camera.lookAt(this.look);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
