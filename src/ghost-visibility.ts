import type { Box2, Box3, Camera, Vector3 } from 'three';

export const GHOST_OPACITY = 0.35;
export const GHOST_OVERLAP_OPACITY = 0.1;
const OPACITY_RANGE = GHOST_OPACITY - GHOST_OVERLAP_OPACITY;

/** Project a conservative visual envelope, reusing the caller's scratch objects. */
export function projectGhostBounds(bounds: Box3, camera: Camera, target: Box2, point: Vector3) {
  target.makeEmpty();
  if (bounds.isEmpty()) return target;
  for (let corner = 0; corner < 8; corner++) {
    point.set(
      corner & 1 ? bounds.max.x : bounds.min.x,
      corner & 2 ? bounds.max.y : bounds.min.y,
      corner & 4 ? bounds.max.z : bounds.min.z,
    ).project(camera);
    if (point.z < -1 || point.z > 1 || !Number.isFinite(point.x + point.y + point.z)) continue;
    target.min.x = Math.min(target.min.x, point.x);
    target.min.y = Math.min(target.min.y, point.y);
    target.max.x = Math.max(target.max.x, point.x);
    target.max.y = Math.max(target.max.y, point.y);
  }
  // Only the on-screen portions can obscure the player.
  target.min.x = Math.max(-1, target.min.x);
  target.min.y = Math.max(-1, target.min.y);
  target.max.x = Math.min(1, target.max.x);
  target.max.y = Math.min(1, target.max.y);
  return target;
}

export function ghostOverlapOpacity(player: Box2, ghost: Box2) {
  if (player.isEmpty() || ghost.isEmpty()) return GHOST_OPACITY;
  const area = Math.min(
    (player.max.x - player.min.x) * (player.max.y - player.min.y),
    (ghost.max.x - ghost.min.x) * (ghost.max.y - ghost.min.y),
  );
  if (area <= 0) return GHOST_OPACITY;
  const width = Math.max(0, Math.min(player.max.x, ghost.max.x) - Math.max(player.min.x, ghost.min.x));
  const height = Math.max(0, Math.min(player.max.y, ghost.max.y) - Math.max(player.min.y, ghost.min.y));
  const coverage = Math.min(1, (width * height / area) / 0.5);
  const smooth = coverage * coverage * (3 - 2 * coverage);
  return GHOST_OPACITY - OPACITY_RANGE * smooth;
}

/** Full fade takes 150 ms; full recovery takes 250 ms, independent of frame rate. */
export function advanceGhostOpacity(current: number, target: number, dt: number) {
  current = Math.max(GHOST_OVERLAP_OPACITY, Math.min(GHOST_OPACITY, current));
  target = Math.max(GHOST_OVERLAP_OPACITY, Math.min(GHOST_OPACITY, target));
  const step = OPACITY_RANGE * Math.max(0, dt) / (target < current ? 0.15 : 0.25);
  if (Math.abs(target - current) <= step + 1e-12) return target;
  return current + Math.sign(target - current) * step;
}
