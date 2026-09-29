import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { Vector3, Mesh } from 'three';
import { Bike } from '../src/bike-model';
import { modelAssets } from './model-fixture';
import { BIKE, type GroundHeight } from '../src/bike-pose';

describe.each(['high', 'low'] as const)('exported %s wheel contact rig', (quality) => {
  let bike: Bike;
  beforeAll(async () => {
    bike = new Bike(0xff0000, await modelAssets(), quality);
  });
  beforeEach(() => bike.reset());
  const animate = (tilt: number, grounded: boolean, ground: GroundHeight) => {
    bike.update({ time: 0, paused: false, speed: 0, tilt, grounded, recovery: false, ground });
  };
  it('keeps the rear axle planted at the same point while raising the front wheel', () => {
    for (const tilt of [0, 0.25, 0.6, 1, 1.35]) {
      animate(tilt, true, () => 0);
      bike.root.updateMatrixWorld(true);
      const rear = bike.wheels[0].getWorldPosition(new Vector3()),
        front = bike.wheels[1].getWorldPosition(new Vector3());
      expect(rear.x).toBeCloseTo(BIKE.rearX, 6);
      expect(rear.y - BIKE.radius).toBeCloseTo(0.003, 6);
      expect(front.y - rear.y).toBeCloseTo((BIKE.frontX - BIKE.rearX) * Math.sin(tilt), 6);
    }
  });
  it.each([0, 0.35, -0.35])(
    'keeps the actual tire and tread geometry above a slope of %f',
    (slope) => {
      const ground: GroundHeight = (x) => slope * x;
      for (const tilt of [Math.atan(slope), 0.7, 1.35, -0.5, 2.05]) {
        bike.wheelAngle = tilt * 1.73;
        animate(tilt, true, ground);
        bike.root.updateMatrixWorld(true);
        for (const wheel of bike.wheels)
          wheel.traverse((obj) => {
            if (!(obj instanceof Mesh)) return;
            const points = obj.geometry.attributes.position;
            for (let i = 0; i < points.count; i++) {
              const vertex = new Vector3()
                .fromBufferAttribute(points, i)
                .applyMatrix4(obj.matrixWorld);
              expect(vertex.y - ground(vertex.x)).toBeGreaterThanOrEqual(-0.001);
            }
          });
      }
    },
  );
  it('retains flight clearance while pitching instead of snapping an airborne bike to the track', () => {
    animate(0.8, false, () => -4);
    bike.root.updateMatrixWorld(true);
    expect(bike.wheels[0].getWorldPosition(new Vector3()).y).toBeCloseTo(BIKE.radius, 6);
  });
});
