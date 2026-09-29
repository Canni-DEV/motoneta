/** Model-space dimensions shared by the model and the ground-contact solver. */
export const BIKE = { rearX: -0.53, frontX: 0.57, axleY: 0.29, radius: 0.306 } as const;
export type GroundHeight = (modelX: number) => number;

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
