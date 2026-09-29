import {
  MeshStandardMaterial,
  NoColorSpace,
  OrthographicCamera,
  Scene,
  ShaderLib,
  UniformsUtils,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDesign, mapTrack, validateMap } from '../src/core/maps';
import { completeRace, isFinished, stepRace } from '../src/core/racing';
import { TIMES_OF_DAY } from '../src/core/time-of-day';
import { defaultSettings, Input } from '../src/core/types';
import { readWeather, WEATHERS } from '../src/core/weather';
import { simulateInputs, testRace } from './race-fixture';

import { appendInput, newRecording, validateRecording } from '../src/core/recording';
import { Environment } from '../src/environment';
import { settings } from '../src/storage';
import { WeatherEffects } from '../src/weather-effects';
import { WeatherSurfaces, type SurfaceProfile } from '../src/weather-surfaces';

const design = { ...emptyDesign(), name: 'Weather test', length: 640, laps: 1 };
afterEach(() => vi.unstubAllGlobals());

describe('weather metadata compatibility', () => {
  it('defaults missing surface preferences to detailed without changing quality or VFX', () => {
    for (const value of [undefined, null, 'automatic', 1, {}, 'detailed', 'light']) {
      vi.stubGlobal('localStorage', {
        getItem: () =>
          JSON.stringify({
            surfaceDetail: value,
            quality: 'low',
            vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
          }),
      });
      expect(settings()).toMatchObject({
        surfaceDetail: value === 'light' ? 'light' : 'detailed',
        quality: 'low',
        vfx: { race: false, tracks: false, ambient: false },
      });
    }
  });
  it('defaults missing fields, rejects explicit invalid imports and ignores invalid preferences', () => {
    expect(() => readWeather(undefined)).toThrow('Clima inválido');
    expect(validateMap(design).weather).toBe('clear');
    for (const invalid of ['storm', null, 0, {}, []]) {
      expect(() => readWeather(invalid)).toThrow('Clima inválido');
      expect(() => validateMap({ ...design, weather: invalid })).toThrow('Clima inválido');
      vi.stubGlobal('localStorage', {
        getItem: () => JSON.stringify({ weather: invalid, timeOfDay: 'night' }),
      });
      expect(settings().weather).toBe('clear');
      expect(settings().timeOfDay).toBe('night');
    }
    for (const weather of WEATHERS) {
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ weather }) });
      expect(settings().weather).toBe(weather);
      expect(validateMap({ ...design, weather }).weather).toBe(weather);
      expect(mapTrack({ ...design, weather })).toEqual(mapTrack(design));
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

describe('weather rendering state', () => {
  it.each(['rain', 'snow'] as const)(
    '%s retains world trajectories through camera movement, rotation, resize and zoom',
    (weather) => {
      const scene = new Scene(),
        effects = new WeatherEffects(scene);
      const camera = new OrthographicCamera(-18, 18, 10, -10, 0.1, 180);
      camera.position.set(-2, 11.5, 20);
      camera.lookAt(4, 0.65, 0);
      const tick = (dt = 0) => {
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        effects.update(
          dt,
          camera,
          defaultSettings,
          weather === 'rain' ? 1 : 0,
          weather === 'snow' ? 1 : 0,
        );
        scene.updateMatrixWorld(true);
      };
      const object = effects[weather],
        stride = weather === 'rain' ? 6 : 3;
      const buffer = object.geometry.attributes.position.array;
      const point = (i: number) =>
        new Vector3().fromArray(buffer, i * stride).applyMatrix4(object.matrixWorld);
      tick();
      const visible = Array.from({ length: 512 }, (_, i) => ({ i, world: point(i) })).filter(
        ({ world }) => {
          const ndc = world.clone().project(camera);
          return (
            Math.abs(ndc.x) < 0.6 && Math.abs(ndc.y) < 0.6 && Math.abs(ndc.z) < 1 && world.y > 2
          );
        },
      );
      expect(visible.length).toBeGreaterThan(10);
      const beforeScreen = visible[0].world.clone().project(camera);
      camera.position.x += 3;
      camera.lookAt(7, 0.65, 0);
      tick();
      for (const { i, world } of visible) expect(point(i).distanceTo(world)).toBeLessThan(1e-5);
      const afterScreen = point(visible[0].i).project(camera);
      expect(afterScreen.x).toBeLessThan(beforeScreen.x - 0.1);
      expect(afterScreen.distanceTo(visible[0].world.clone().project(camera))).toBeLessThan(1e-5);

      camera.zoom = 4;
      camera.left = -24;
      camera.right = 24;
      camera.position.y += 4;
      camera.lookAt(9, 3, -2);
      tick();
      for (const { i, world } of visible) expect(point(i).distanceTo(world)).toBeLessThan(1e-5);
      camera.position.x += 3;
      tick(0.05);
      for (const { i, world } of visible) {
        const delta = point(i).sub(world);
        // Shared wind (up to .63 world units/s) plus the snow's local flutter.
        expect(Math.abs(delta.x)).toBeLessThan(0.05);
        expect(delta.y).toBeLessThan(0);
        expect(delta.y).toBeGreaterThan(-0.85);
      }
      const fallen = point(visible[0].i);
      camera.position.x += 10000;
      tick();
      for (let i = 0; i < 512; i++) {
        expect(Math.abs(point(i).x - camera.position.x)).toBeLessThanOrEqual(48.001);
        expect(point(i).toArray().every(Number.isFinite)).toBe(true);
      }
      camera.position.x -= 10000;
      tick();
      expect(point(visible[0].i).distanceTo(fallen)).toBeLessThan(1e-5);
      expect(object.geometry.attributes.position.array).toBe(buffer);
      effects.dispose();
    },
  );
  it('retargets interrupted transitions without changing the hour, lamps or allocations', () => {
    const scene = new Scene(),
      environment = new Environment(scene);
    const renderer = { toneMappingExposure: 1 };
    const tick = (dt: number, reduced = false) =>
      environment.update(dt, 0, 18, defaultSettings, renderer, reduced);
    environment.setTimeOfDay('night');
    tick(0);
    const clear = { fog: environment.fog.color.clone(), power: environment.sun.intensity };
    const allocations = scene.children.length;
    environment.setWeather('rain', true);
    tick(0.25);
    expect(environment.rainAmount).toBeCloseTo(0.5);
    const fog = environment.fog.color.clone();
    environment.setWeather('snow', true);
    tick(0);
    expect(environment.fog.color).toEqual(fog);
    expect(environment.rainAmount).toBeCloseTo(0.5);
    tick(0.5);
    expect(environment.snowAmount).toBe(1);
    expect(environment.rainAmount).toBe(0);
    expect(environment.timeOfDay).toBe('night');
    expect(environment.lampLevel).toBe(1);
    environment.setTimeOfDay('afternoon', true);
    tick(0, true);
    expect(environment.weather).toBe('snow');
    expect(environment.lampLevel).toBe(0.25);
    for (let i = 0; i < 30; i++)
      for (const weather of WEATHERS) {
        environment.setWeather(weather);
        tick(0);
      }
    environment.setTimeOfDay('night');
    environment.setWeather('clear');
    tick(0);
    expect(environment.fog.color).toEqual(clear.fog);
    expect(environment.sun.intensity).toBe(clear.power);
    expect(scene.children.length).toBe(allocations);
    environment.dispose();
    expect(scene.children).toHaveLength(0);
  });
  it('keeps base materials intact, shares controls within a world and releases track registrations', () => {
    const surfaces = new WeatherSurfaces(),
      other = new WeatherSurfaces();
    const material = surfaces.register(
      new MeshStandardMaterial({ color: '#a66437', roughness: 0.82 }),
      { profile: 'dirt' },
    );
    const base = material.color.clone();
    const temporary = surfaces.register(new MeshStandardMaterial({ color: '#473e2a' }), {
      profile: 'mud',
      temporary: true,
    });
    const isolated = other.register(new MeshStandardMaterial({ color: '#a66437' }), {
      profile: 'dirt',
    });
    const version = material.version;
    const textureVersion = surfaces.control.version;
    for (let i = 0; i < 60; i++) {
      surfaces.update(1, 0);
      expect(surfaces.rain.value).toBe(1);
      expect(other.rain.value).toBe(0);
      surfaces.update(0, 1);
      expect(surfaces.snow.value).toBe(1);
      surfaces.update(0, 0);
      expect(material.color).toEqual(base);
      expect(material.roughness).toBe(0.82);
    }
    expect(isolated.color).toEqual(base);
    expect(material.version).toBe(version);
    expect(surfaces.control.version).toBe(textureVersion);
    const oldHook = temporary.onBeforeCompile;
    surfaces.clearTrack();
    expect(temporary.onBeforeCompile).not.toBe(oldHook);
    const temporaryVersion = temporary.version;
    const detailedKey = material.customProgramCacheKey();
    surfaces.setDetail('light');
    expect(material.version).toBe(version + 1);
    expect(temporary.version).toBe(temporaryVersion);
    expect(material.customProgramCacheKey()).not.toBe(detailedKey);
    expect(temporary.customProgramCacheKey()).not.toContain('weather-surface');
    expect(isolated.customProgramCacheKey()).toBe(detailedKey);
    surfaces.setDetail('light');
    expect(material.version).toBe(version + 1);
    surfaces.setDetail('detailed');
    expect(material.customProgramCacheKey()).toBe(detailedKey);
    surfaces.update(1, 0);
    expect(temporary.roughness).toBe(1);
    const disposed = vi.fn();
    surfaces.control.addEventListener('dispose', disposed);
    surfaces.dispose();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(other.control).not.toBe(surfaces.control);
    other.dispose();
  });
  it('uses deterministic bounded control data and an integer repeat count across arbitrary laps', () => {
    const surfaces = new WeatherSurfaces(),
      other = new WeatherSurfaces();
    expect(surfaces.control.image.width).toBe(512);
    expect(surfaces.control.image.height).toBe(256);
    expect(surfaces.control.image.data).toEqual(other.control.image.data);
    expect(surfaces.control.colorSpace).toBe(NoColorSpace);
    const data = surfaces.control.image.data as Uint8Array;
    let wet = 0,
      compact = 0,
      minimumSnow = 255;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 128) wet++;
      if (data[i + 2] > 128) compact++;
      minimumSnow = Math.min(minimumSnow, data[i + 1]);
    }
    expect(wet / (512 * 256)).toBeLessThan(0.25);
    expect(wet).toBeGreaterThan(1000);
    expect(compact).toBeGreaterThan(10000);
    expect(minimumSnow).toBeGreaterThanOrEqual(209);
    const coordinates = surfaces.coordinates.value;
    for (const length of [120, 317, 1234, 10000]) {
      surfaces.setTrack(length);
      expect(surfaces.coordinates.value).toBe(coordinates);
      const repeats = length * 0.052 * coordinates.x;
      expect(repeats).toBeCloseTo(Math.round(repeats), 10);
    }
    surfaces.dispose();
    other.dispose();
  });
  it('retains distinct profiles when solid surfaces reuse the same shader program', () => {
    const surfaces = new WeatherSurfaces();
    const values = new Map<SurfaceProfile, Vector3>();
    for (const profile of ['dirt', 'field', 'mud', 'grass', 'cool', 'bump'] as const) {
      const material = surfaces.register(new MeshStandardMaterial(), { profile });
      const shader = {
        vertexShader: ShaderLib.standard.vertexShader,
        fragmentShader: ShaderLib.standard.fragmentShader,
        uniforms: UniformsUtils.clone(ShaderLib.standard.uniforms),
      } as Parameters<typeof material.onBeforeCompile>[0];
      material.onBeforeCompile(shader, {} as WebGLRenderer);
      expect(shader.uniforms.weatherControl.value).toBe(surfaces.control);
      expect(shader.uniforms.weatherRain).toBe(surfaces.rain);
      values.set(profile, shader.uniforms.weatherSnowProfile.value);
      expect(shader.uniforms.weatherWet.value.z).toBeGreaterThanOrEqual(0.5);
    }
    expect(values.get('field')!.x).toBeGreaterThan(values.get('dirt')!.x);
    expect(values.get('field')!.y).toBe(0);
    expect(values.get('mud')!.x).toBeLessThan(0.3);
    expect(values.get('cool')!.x).toBeLessThan(0.15);
    expect(values.get('dirt')).not.toBe(values.get('bump'));
    surfaces.dispose();
  });
  it('keeps buffers stable, budgets both effects together, pauses and honors accessibility', () => {
    const scene = new Scene(),
      effects = new WeatherEffects(scene);
    const camera = new OrthographicCamera(-20, 20, 12, -12, 0.1, 180);
    const buffers = [
      effects.rain.geometry.attributes.position.array,
      effects.snow.geometry.attributes.position.array,
    ];
    const tick = (paused = false, reduced = false, particles = true, rain = 1, snow = 0) =>
      effects.update(
        1 / 60,
        camera,
        { ...defaultSettings, vfx: { ...defaultSettings.vfx, ambient: particles } },
        rain,
        snow,
        paused,
        reduced,
      );
    tick(true);
    expect(effects.diagnostics().time).toBe(0);
    tick();
    expect(effects.diagnostics()).toMatchObject({ draws: 1, count: 512, rain: true, snow: false });
    const positions = Array.from(buffers[0]);
    const frozen = effects.diagnostics();
    for (let i = 0; i < 10; i++) tick(true);
    expect(effects.diagnostics()).toEqual(frozen);
    expect(Array.from(buffers[0])).toEqual(positions);
    tick(false, false, true, 0.5, 0.5);
    expect(effects.diagnostics().draws).toBe(2);
    expect(effects.rain.geometry.drawRange.count / 2 + effects.snow.geometry.drawRange.count).toBe(
      512,
    );
    tick(false, true);
    expect(effects.diagnostics().draws).toBe(0);
    tick(false, false, false);
    expect(effects.diagnostics().draws).toBe(0);
    for (let i = 0; i < 60; i++) {
      camera.position.x = i * 320;
      camera.zoom = 1 + (i % 5);
      effects.update(1 / 60, camera, { ...defaultSettings, quality: 'low' }, 0, 1);
    }
    expect(effects.diagnostics()).toMatchObject({ draws: 1, count: 192, rain: false, snow: true });
    expect(effects.rain.geometry.attributes.position.array).toBe(buffers[0]);
    expect(effects.snow.geometry.attributes.position.array).toBe(buffers[1]);
    expect(scene.children).toHaveLength(2);
    effects.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
