import { type Settings } from '../core/types';
export { WORLD_SCALE as SCALE, LANE_WIDTH as LANE } from '../world-space';

export const VFX_LIMITS = {
  high: { particles: 1536, tracks: 512 },
  low: { particles: 512, tracks: 192 },
} as const;
export const VFX_INTENSITY = { subtle: 0.65, balanced: 1, strong: 1.3 } as const;
export const TRACK_LIFE = 8;
export const vfxSettings = (s: Settings) => s.vfx;

/** Analytic integral and derivative: shared wind, no frame-rate-dependent integration. */
export function windAt(time: number, seed = 0) {
  const phase = (seed % 1024) * 0.006;
  return {
    x: -0.45 + Math.sin(time * 0.7 + phase) * 0.18,
    z: Math.sin(time * 0.43 + phase) * 0.12,
  };
}
export function windTravel(time: number, seed = 0) {
  const phase = (seed % 1024) * 0.006;
  return {
    x: -0.45 * time + ((Math.cos(phase) - Math.cos(time * 0.7 + phase)) * 0.18) / 0.7,
    z: ((Math.cos(phase) - Math.cos(time * 0.43 + phase)) * 0.12) / 0.43,
  };
}
