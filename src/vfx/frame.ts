import { bikePose, crashPose, BIKE } from '../bike-pose';
import { heightAt, segmentAt } from '../core/tracks';
import type { Race, Rider, GameEvent, Track, Weather } from '../core/types';
import { SCALE, LANE } from './config';

export type Point = Readonly<{ x: number; y: number; z: number }>;
export interface EffectAnchors {
  readonly rear: Point;
  readonly front: Point;
  readonly exhaust: Point;
  readonly engine: Point;
  readonly rearContact: boolean;
  readonly frontContact: boolean;
}
// Coordinates from the editable motocross source, in the chassis coordinate system.
export const EXHAUST_POINT = [-0.649, 0.731, -0.174] as const;
export const ENGINE_POINT = [0.06, 0.54, 0] as const;

/** Uses the same support solver, wheel radius and rear-axle pivot as Bike.applyPose. */
export function effectAnchors(p: Readonly<Rider>, track: Track): EffectAnchors {
  const x = p.x * SCALE,
    y = p.height * SCALE,
    z = (p.lane - 1.5) * LANE;
  const ground = (dx: number) => heightAt(track, (x + dx) / SCALE, p.lane) * SCALE - y;
  if (p.crashPhase !== 'none') {
    const pose = crashPose(p, ground);
    const c = Math.cos(pose.pitch),
      s = Math.sin(pose.pitch),
      cr = Math.cos(pose.roll),
      sr = Math.sin(pose.roll);
    const transform = (px: number, py: number, pz = 0): Point => {
      const pitchedY = s * px + c * py;
      return {
        x: x + pose.x + c * px - s * py,
        y: y + pose.y + cr * pitchedY - sr * pz,
        z: z + pose.z + sr * pitchedY + cr * pz,
      };
    };
    const rearAxle = transform(BIKE.rearX, BIKE.axleY),
      frontAxle = transform(BIKE.frontX, BIKE.axleY);
    const rear = { ...rearAxle, y: rearAxle.y - BIKE.radius };
    const front = { ...frontAxle, y: frontAxle.y - BIKE.radius };
    return {
      rear,
      front,
      rearContact: rear.y <= heightAt(track, rear.x / SCALE, p.lane) * SCALE + 0.07,
      frontContact: front.y <= heightAt(track, front.x / SCALE, p.lane) * SCALE + 0.07,
      exhaust: transform(...EXHAUST_POINT),
      engine: transform(...ENGINE_POINT),
    };
  }
  const pose = bikePose(p.tilt, p.grounded, ground);
  const c = Math.cos(p.tilt),
    s = Math.sin(p.tilt);
  const transform = (px: number, py: number, pz = 0): Point => ({
    x: x + pose.x + c * px - s * py,
    y: y + pose.y + s * px + c * py,
    z: z + pz,
  });
  const rearAxle = transform(BIKE.rearX, BIKE.axleY),
    frontAxle = transform(BIKE.frontX, BIKE.axleY);
  const rear = pose.rear.touching
    ? { x: x + pose.rear.x, y: y + pose.rear.y, z }
    : { ...rearAxle, y: rearAxle.y - BIKE.radius };
  const front = pose.front.touching
    ? { x: x + pose.front.x, y: y + pose.front.y, z }
    : { ...frontAxle, y: frontAxle.y - BIKE.radius };
  return {
    rear,
    front,
    rearContact: pose.rear.touching,
    frontContact: pose.front.touching,
    exhaust: transform(...EXHAUST_POINT),
    engine: transform(...ENGINE_POINT),
  };
}
export interface VfxRider extends Readonly<Rider> {
  readonly anchors: EffectAnchors;
  readonly surface: NonNullable<GameEvent['surface']>;
  readonly clearance: number;
}
export interface VfxFrame {
  readonly frame: number;
  readonly phase: Race['phase'];
  readonly weather: Weather;
  readonly riders: readonly VfxRider[];
  readonly events: readonly Readonly<GameEvent>[];
  readonly finished: boolean;
}
/** Real race only, never the render-only array that includes ghosts. */
export function captureVfxFrame(race: Race, weather: Weather): VfxFrame {
  return {
    frame: race.frame,
    phase: race.phase,
    weather,
    riders: race.riders.map((p) => ({
      ...p,
      anchors: effectAnchors(p, race.track),
      surface: segmentAt(race.track, p.x, p.lane)?.surface ?? 'dirt',
      clearance: p.height - heightAt(race.track, p.x, p.lane),
    })),
    events: race.events.map((e) => ({ ...e })),
    finished:
      race.phase === 'finished' || race.events.some((e) => e.type === 'finish' && e.rider === 0),
  };
}
