/** Model-space dimensions shared by the model and the ground-contact solver. */
export const BIKE = { rearX: -0.53, frontX: 0.57, axleY: 0.29, radius: 0.306 } as const;
export type GroundHeight = (modelX: number) => number;
export interface CrashPoseState {
  crashPhase: 'none' | 'rolling' | 'down' | 'mounting';
  crashPhaseAge: number;
  crashRollDuration: number;
  crashKind: 'impact' | 'backflip';
  crashStartTilt: number;
  lane: number;
}
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const smooth = (n: number) => {
  const t = clamp01(n);
  return t * t * (3 - 2 * t);
};

/** Shared analytic crash envelope for the rendered model and particle anchors. */
export function crashPose(state: CrashPoseState, ground: GroundHeight, reduced = false) {
  const side = state.lane < 1.5 ? -1 : 1;
  const phase = state.crashPhase;
  const rolling = phase === 'rolling';
  const mounting = phase === 'mounting';
  const progress = rolling
    ? clamp01(state.crashPhaseAge / Math.max(1, state.crashRollDuration))
    : mounting
      ? clamp01(state.crashPhaseAge / 22)
      : 1;
  const pitch =
    rolling && !reduced
      ? state.crashStartTilt * (1 - progress) +
        (state.crashKind === 'backflip' ? 1 : -2) * Math.PI * 2 * progress
      : 0;
  const roll =
    side * 1.15 * (rolling ? smooth((progress - 0.5) * 2) : mounting ? 1 - smooth(progress) : 1);
  const z = side * 0.32 * (rolling ? smooth(progress) : mounting ? 1 - smooth(progress) : 1);
  // Check the outer motorcycle envelope, not only the tire centers: a full flip
  // must not bury the tank or fender inside a steep ramp.
  const c = Math.cos(pitch),
    s = Math.sin(pitch),
    cr = Math.cos(roll),
    sr = Math.sin(roll);
  const points = [
    [-0.53, 0.29, 0, 0.306],
    [0.57, 0.29, 0, 0.306],
    [-0.76, 0.75, -0.12, 0],
    [0.81, 0.65, 0.12, 0],
    [0.06, 0.4, -0.19, 0],
    [0.32, 0.95, 0.2, 0],
  ];
  let y = 0;
  for (const [px, py, pz, radius] of points) {
    const x = c * px - s * py;
    const height = cr * (s * px + c * py) - sr * pz;
    y = Math.max(y, ground(x) - height + radius);
  }
  y += 0.025 + (rolling && !reduced ? 0.06 * Math.sin(Math.PI * progress) : 0);
  const riderProgress = rolling
    ? smooth(Math.min(1, progress * 2))
    : mounting
      ? 1 - smooth(progress)
      : 1;
  const riderX = -1.15 * riderProgress;
  const standing = phase === 'down' ? smooth(state.crashPhaseAge / 20) : mounting ? 1 : 0;
  const riderGroundY = ground(riderX) + 0.2 - standing * 0.55;
  const ridingY = mounting ? bikePose(0, true, ground).y : 0;
  return {
    x: 0,
    y,
    z,
    pitch,
    roll,
    riderX,
    riderY: rolling
      ? ground(riderX) + 0.36
      : mounting
        ? riderGroundY + (ridingY - riderGroundY) * smooth(progress)
        : riderGroundY,
    riderZ: side * 0.46 * riderProgress,
    riderPitch: rolling ? -0.8 * riderProgress : mounting ? 0 : -1.15 * (1 - standing),
  };
}

function supportAt(x: number, ground: GroundHeight) {
  let y = -Infinity,
    contactX = x,
    contactY = 0;
  // Sample the lower semicircle, including both extremities at discontinuous terrain edges.
  for (let i = 0; i <= 32; i++) {
    const dx = BIKE.radius * (i / 16 - 1);
    const surface = ground(x + dx);
    const support = surface + Math.sqrt(Math.max(0, BIKE.radius ** 2 - dx ** 2));
    if (support > y) {
      y = support;
      contactX = x + dx;
      contactY = surface;
    }
  }
  return { axleY: y + 0.003, x: contactX, y: contactY };
}

export function bikePose(tilt: number, grounded: boolean, ground: GroundHeight) {
  const c = Math.cos(tilt),
    s = Math.sin(tilt),
    wheelbase = BIKE.frontX - BIKE.rearX;
  const frontX = BIKE.rearX + wheelbase * c;
  const rear = supportAt(BIKE.rearX, ground),
    front = supportAt(frontX, ground);
  const contact = Math.max(rear.axleY, front.axleY - wheelbase * s);
  // On the ground the rear axle is the pivot. In flight retain clearance and only
  // constrain the rig when a tire approaches the surface, never the airborne tilt itself.
  const rearY = grounded ? contact : Math.max(BIKE.radius, contact);
  return {
    x: BIKE.rearX - (c * BIKE.rearX - s * BIKE.axleY),
    y: rearY - (s * BIKE.rearX + c * BIKE.axleY),
    rear: { x: rear.x, y: rear.y, touching: grounded && Math.abs(rearY - rear.axleY) < 0.055 },
    front: {
      x: front.x,
      y: front.y,
      touching: grounded && Math.abs(rearY + wheelbase * s - front.axleY) < 0.055,
    },
  };
}
