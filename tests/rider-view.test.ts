import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Bike, type BikeVisualState } from '../src/bike-model';
import { defaultVehicleAppearance, VARIANTS } from '../src/appearance';
import { VEHICLE_VISUALS } from '../src/vehicle-visual';
import { modelAssets } from './model-fixture';

const state = (overrides: Partial<BikeVisualState> = {}): BikeVisualState => ({
  time: 0, paused: false, speed: 2, tilt: 0, grounded: true, recovery: false, ground: () => 0, ...overrides,
});
describe.each(['motocross', 'motoneta', 'tanque'] as const)('%s eyes and first-person appearance', vehicle => {
  it('reads the posed head in both qualities, including root rotations and detached recovery', async () => {
    const bike = new Bike(0xff0000, await modelAssets(vehicle), 'high', vehicle);
    const eyes = { position: new Vector3(), quaternion: new Quaternion() };
    for (const quality of ['high', 'low'] as const) {
      bike.setQuality(quality); bike.reset(); bike.update(state()); bike.getRiderViewPose(eyes);
      expect(eyes.position.y).toBeGreaterThan(VEHICLE_VISUALS[vehicle].rig.Head.head[1]);
      const forward = new Vector3(0, 0, -1).applyQuaternion(eyes.quaternion);
      expect(forward.x).toBeGreaterThan(0.95); expect(forward.y).toBeLessThan(0);
      const initial = eyes.position.clone(), initialQ = eyes.quaternion.clone();
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI);
      bike.root.quaternion.copy(rotation); bike.root.position.set(20, 5, -2);
      bike.getRiderViewPose(eyes);
      expect(eyes.position.distanceTo(initial.clone().applyQuaternion(rotation).add(bike.root.position))).toBeLessThan(1e-6);
      expect(eyes.quaternion.angleTo(rotation.clone().multiply(initialQ))).toBeLessThan(1e-6);
      bike.root.quaternion.identity(); bike.root.position.set(0, 0, 0);
      for (const phase of ['rolling', 'down', 'mounting'] as const)
        for (let age = 0; age < (phase === 'mounting' ? 22 : 40); age++) {
          bike.update(state({ time: (age + 1) / 60, crashPhase: phase, crashPhaseAge: age, recovery: true }));
          bike.getRiderViewPose(eyes);
          expect([...eyes.position.toArray(), ...eyes.quaternion.toArray()].every(Number.isFinite)).toBe(true);
          expect(eyes.position.y).toBeGreaterThan(0);
        }
    }
    bike.dispose();
  });
  it('hides only helmet/visor, respects appearance changes and restores the selected variants', async () => {
    const bike = new Bike(0xff0000, await modelAssets(vehicle), 'high', vehicle);
    const appearance = defaultVehicleAppearance(vehicle);
    bike.setAppearance(appearance); bike.setFirstPerson(true);
    for (const quality of ['high', 'low'] as const) {
      bike.setQuality(quality);
      for (const variant of VARIANTS)
        for (const slot of ['helmet', 'visor'])
          expect(bike.rider.getObjectByName(`Slot_${slot}_${variant}`)?.visible).toBe(false);
      expect(bike.rider.getObjectByName('Slot_gloves_core')?.visible).toBe(true);
    }
    appearance.parts.helmet = 'trail'; appearance.parts.visor = 'sprint';
    bike.setAppearance(appearance); bike.setFirstPerson(false);
    for (const quality of ['high', 'low'] as const) {
      bike.setQuality(quality);
      expect(bike.rider.getObjectByName('Slot_helmet_trail')?.visible).toBe(true);
      expect(bike.rider.getObjectByName('Slot_visor_sprint')?.visible).toBe(true);
      expect(bike.rider.getObjectByName('Slot_helmet_core')?.visible).toBe(false);
    }
    bike.setFirstPerson(true); bike.reset();
    expect(bike.rider.getObjectByName('Slot_helmet_trail')?.visible).toBe(true);
    bike.dispose();
  });
});
