import { clamp, Input, type Rider } from './types';

// Public NTSC tables C0BC and C0CE/C0D1; units are pixels per simulation frame.
export const DRIVE = {
  normalAcceleration: 0x18 / 256,
  turboAcceleration: 0x3f / 256,
  normalSpeed: 3 + 0x20 / 256,
  turboSpeed: 3 + 0x40 / 256,
  normalDrag: 0x0c / 256,
} as const;
export const BALANCE = { minSpeed: 0xa0 / 256, tippingPoint: 0.88, fallAngle: 1.4 } as const;

/** A continuous reconstruction of balance, not a claim of exact NES angle timing. */
export function updateWheelie(p: Rider, input: number) {
  const left = !!(input & Input.LEFT),
    right = !!(input & Input.RIGHT);
  const lift = left && !right && p.speed >= BALANCE.minSpeed;
  const control = lift ? 0.003 : right && !left ? -0.0038 : 0;
  const gravity = 0.0018 * Math.sin(p.wheelie - BALANCE.tippingPoint);
  p.wheelieVelocity = clamp((p.wheelieVelocity + control + gravity) * 0.97, -0.045, 0.036);
  // Retain enough fractional precision for small torques to accumulate.
  p.wheelieVelocity = Math.round(p.wheelieVelocity * 65536) / 65536;
  p.wheelie = Math.max(0, p.wheelie + p.wheelieVelocity);
  if (!p.wheelie) p.wheelieVelocity = 0;
  return p.wheelie >= BALANCE.fallAngle;
}
