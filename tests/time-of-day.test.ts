import {
  DirectionalLight,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  SpotLight,
  Vector3,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, mapTrack, validateMap } from '../src/core/maps';
import { completeRace, isFinished, stepRace } from '../src/core/racing';
import { readTimeOfDay, TIMES_OF_DAY } from '../src/core/time-of-day';
import { defaultSettings, Input } from '../src/core/types';
import { simulateInputs, testRace } from './race-fixture';

import { Bike } from '../src/bike-model';
import { appendInput, newRecording, validateRecording } from '../src/core/recording';
import { Environment } from '../src/environment';
import { settings } from '../src/storage';
import { modelAssets } from './model-fixture';

const design = { ...emptyDesign(), name: 'Light test', length: 640, laps: 1 };
afterEach(() => vi.unstubAllGlobals());

describe('time of day and deterministic playback', () => {
  it('validates current designs and rejects explicitly invalid schedules', () => {
    expect(validateMap(design).timeOfDay).toBe('morning');
    for (const timeOfDay of TIMES_OF_DAY) {
      expect(validateMap({ ...design, timeOfDay }).timeOfDay).toBe(timeOfDay);
      expect(mapTrack({ ...design, timeOfDay })).toEqual(mapTrack(design));
    }
    for (const invalid of ['dawn', null, 123, {}]) {
      expect(() => readTimeOfDay(invalid)).toThrow('Horario inválido');
      expect(() => validateMap({ ...design, timeOfDay: invalid })).toThrow('Horario inválido');
    }
  });
  it('reads saved preferences and recovers from missing, malformed and unknown values', () => {
    let stored = '{}';
    vi.stubGlobal('localStorage', { getItem: () => stored });
    expect(settings().timeOfDay).toBe('morning');
    for (const timeOfDay of TIMES_OF_DAY) {
      stored = JSON.stringify({ timeOfDay });
      expect(settings().timeOfDay).toBe(timeOfDay);
    }
    for (const value of ['{', '{"timeOfDay":"dawn"}', 'null', '123']) {
      stored = value;
      expect(settings().timeOfDay).toBe('morning');
    }
  });
  it('preserves physics and playback across environment choices', () => {
    const original = testRace(mapTrack(design), 3);
    const recording = newRecording(original.config);
    while (!isFinished(original, 0)) {
      const input = original.frame % 300 < 100 ? Input.B : Input.A;
      appendInput(recording, input);
      stepRace(original, input);
    }
    completeRace(original);
    for (const timeOfDay of TIMES_OF_DAY)
      for (const weather of ['clear', 'rain', 'snow'] as const) {
        const value = { ...recording, config: { ...recording.config, timeOfDay, weather } };
        const validated = validateRecording(value);
        expect(validated.config).toMatchObject({ timeOfDay, weather });
        const replayed = completeRace(simulateInputs(validated));
        expect(replayed.riders).toEqual(original.riders);
        expect(replayed.finishes).toEqual(original.finishes);
        expect(replayed.seed).toBe(original.seed);
      }
    expect(() =>
      validateRecording({ ...recording, config: { ...recording.config, weather: null } }),
    ).toThrow();
    expect(() =>
      validateRecording({ ...recording, config: { ...recording.config, timeOfDay: null } }),
    ).toThrow();
  });
});

describe('visual environment ownership and transitions', () => {
  it('interpolates for half a second, retargets smoothly and snaps for reduced motion', () => {
    const environment = new Environment(new Scene()),
      renderer = { toneMappingExposure: 1 };
    const tick = (dt: number, reduced = false) =>
      environment.update(dt, 0, 18, defaultSettings, renderer, reduced);
    environment.setTimeOfDay('night', true);
    tick(0.25);
    expect(environment.lampLevel).toBeCloseTo(0.5);
    environment.setTimeOfDay('afternoon', true);
    tick(0);
    expect(environment.lampLevel).toBeCloseTo(0.5);
    tick(0.5);
    expect(environment.lampLevel).toBe(0.25);
    environment.setTimeOfDay('night', true);
    tick(0, true);
    expect(environment.lampLevel).toBe(1);
    environment.setTimeOfDay('morning');
    tick(0);
    expect(environment.lampLevel).toBe(0);
    expect(environment.diagnostics().slots.every((s) => !s.visible && s.intensity === 0)).toBe(
      true,
    );
    environment.dispose();
  });
  it('keeps stadium intensity and direction constant through movement and quality switches', () => {
    const scene = new Scene(),
      environment = new Environment(scene),
      renderer = { toneMappingExposure: 1 };
    environment.setTimeOfDay('night');
    const allocated = scene.children.length;
    for (let lap = -30; lap < 30; lap++) {
      for (const quality of ['high', 'low'] as const) {
        for (let frame = 0; frame < 12; frame++) {
          environment.update(0.05, lap * 320, 18, { ...defaultSettings, quality }, renderer);
          expect(environment.diagnostics().slots.map((s) => s.intensity)).toEqual([0.72, 0.48]);
        }
        const slots = environment.diagnostics().slots;
        expect(slots.filter((s) => s.visible).length).toBe(2);
        expect(slots.filter((s) => s.shadow).length).toBe(quality === 'high' ? 1 : 0);
        for (const stands of [false, true]) {
          const light = scene.getObjectByName(
            stands ? 'Grandstand floodlight' : 'Track floodlight',
          ) as DirectionalLight;
          expect(light.isDirectionalLight).toBe(true);
          const expected = stands ? new Vector3(0, 5.89, 5.16) : new Vector3(0, 7.69, -5.96);
          expect(
            light.position.clone().sub(light.target.position).distanceTo(expected),
          ).toBeLessThan(1e-12);
        }
        expect(scene.children.length).toBe(allocated);
      }
    }
    environment.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it('keeps local floodlights on their towers and recycles them beyond their illumination range', () => {
    const scene = new Scene(),
      environment = new Environment(scene);
    const camera = new OrthographicCamera(-16, 16, 10, -10, 0.1, 180);
    const width = 18;
    const update = (focus: number) => {
      camera.position.set(focus - 1, 11.5, 20);
      camera.lookAt(focus + 5, 0.65, 0);
      environment.update(0.05, focus, width, defaultSettings, { toneMappingExposure: 1 });
      environment.fitShadows(camera, 10);
    };
    environment.setTimeOfDay('night');
    update(0);
    const allocated = scene.children.length;
    for (let focus = -400; focus < 400; focus += 4) {
      update(focus);
      const lights = scene.children.filter((o): o is SpotLight => o instanceof SpotLight);
      expect(lights.length).toBeLessThanOrEqual(8);
      expect(
        lights.every((light) => !light.castShadow && light.visible && light.intensity > 0),
      ).toBe(true);
      for (const light of lights) {
        expect(light.position.x / width - 0.5).toBeCloseTo(
          Math.round(light.position.x / width - 0.5),
        );
        expect(light.position.y).toBe(7.69);
        expect(light.position.z).toBe(-5.46);
        expect(light.target.position.x).toBe(light.position.x);
      }
      // Every tower that could reach a visible road point must remain in the pool.
      for (
        let sector = Math.floor((focus - 50) / width);
        sector <= Math.ceil((focus + 50) / width);
        sector++
      ) {
        const x = (sector + 0.5) * width;
        if (x > focus - 16 - 24 && x < focus + 16 + 24)
          expect(lights.some((light) => light.position.x === x)).toBe(true);
      }
      expect(scene.children.length).toBe(allocated);
    }
    for (const time of ['morning', 'afternoon'] as const) {
      environment.setTimeOfDay(time);
      update(0);
      expect(
        environment
          .diagnostics()
          .trackLights.every((light) => !light.visible && light.intensity === 0),
      ).toBe(true);
    }
    environment.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it.each(['high', 'low'] as const)(
    'attaches %s lamps to the posed chassis and isolates their materials',
    async (quality) => {
      const assets = await modelAssets(),
        a = new Bike(0xff0000, assets, quality),
        b = new Bike(0x00ff00, assets, quality);
      a.setLighting(1);
      b.setLighting(0);
      const lamps = (bike: Bike) => {
        const result: MeshStandardMaterial[] = [];
        bike.variants[quality].traverse((o: any) => {
          if (!o.isMesh) return;
          for (const m of Array.isArray(o.material) ? o.material : [o.material])
            if (m.name === 'LampFront' || m.name === 'LampRear') result.push(m);
        });
        return result;
      };
      expect(lamps(a).every((m) => m.emissiveIntensity > 0)).toBe(true);
      expect(lamps(b).every((m) => m.emissiveIntensity === 0)).toBe(true);
      const before = a.headlight.target
        .getWorldPosition(new Vector3())
        .sub(a.headlight.getWorldPosition(new Vector3()))
        .normalize();
      a.update({
        time: 1,
        paused: false,
        speed: 2,
        tilt: 0.8,
        grounded: false,
        recovery: false,
        ground: () => 0,
      });
      a.root.updateMatrixWorld(true);
      const direction = a.headlight.target
        .getWorldPosition(new Vector3())
        .sub(a.headlight.getWorldPosition(new Vector3()))
        .normalize();
      expect(direction.angleTo(before)).toBeCloseTo(0.8);
      expect(
        a.headlight
          .getWorldPosition(new Vector3())
          .distanceTo(
            a.variants[quality].getObjectByName('HeadlightAnchor')!.getWorldPosition(new Vector3()),
          ),
      ).toBeLessThan(0.00001);
      a.setQuality(quality === 'high' ? 'low' : 'high');
      a.root.updateMatrixWorld(true);
      expect(
        a.headlight.target
          .getWorldPosition(new Vector3())
          .sub(a.headlight.getWorldPosition(new Vector3()))
          .normalize()
          .distanceTo(direction),
      ).toBeLessThan(0.00001);
      // Blinking hides the model, but its light must still follow the animated chassis.
      a.body.visible = false;
      a.root.position.set(12, 3, -4);
      a.root.rotation.y = 0.35;
      a.root.scale.setScalar(1.7);
      a.update({
        time: 1.1,
        paused: false,
        speed: 2,
        tilt: -0.6,
        grounded: true,
        recovery: false,
        ground: () => 0,
      });
      a.setLighting(1);
      a.root.updateMatrixWorld(true);
      const visibleLights: SpotLight[] = [];
      a.root.traverseVisible((object) => {
        if (object instanceof SpotLight) visibleLights.push(object);
      });
      expect(visibleLights).toEqual([a.headlight]);
      expect(a.headlight.intensity).toBeCloseTo(28 * 1.7 ** 2);
      for (const [light, anchor] of [
        [a.headlight, 'HeadlightAnchor'],
        [a.headlight.target, 'HeadlightTarget'],
      ] as const)
        expect(
          light
            .getWorldPosition(new Vector3())
            .distanceTo(
              a.variants[a.quality].getObjectByName(anchor)!.getWorldPosition(new Vector3()),
            ),
        ).toBeLessThan(0.00001);
      a.root.visible = false;
      a.setLighting(1);
      expect(a.headlight.intensity).toBe(0);
      expect(a.headlight.visible).toBe(false);
      a.dispose();
      b.dispose();
    },
  );
});
