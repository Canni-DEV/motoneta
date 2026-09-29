import * as THREE from 'three';
import { HZ, type Race, type Settings, type Track, type Weather } from '../core/types';
import { heightAt } from '../core/tracks';
import { captureVfxFrame } from './frame';
import { VfxModel } from './model';
import { VfxRenderer } from './render';
import { LANE, SCALE } from './config';

export class VfxSystem {
  readonly model: VfxModel;
  readonly renderer: VfxRenderer;
  time = 0;
  private tail = 0;
  private sceneTime = 0;
  private reduced = false;
  private previousMode = '';
  private readonly point = new THREE.Vector3();
  private readonly nextPoint = new THREE.Vector3();
  private readonly protection = new THREE.Vector4();
  private readonly light = new THREE.Color();
  constructor(
    scene: THREE.Scene,
    track: Track,
    private settings: Settings,
  ) {
    this.model = new VfxModel(track, settings);
    this.renderer = new VfxRenderer(scene, this.model);
  }
  reset(track = this.model.track, seed = 0) {
    this.model.reset(track, seed);
    this.time = this.tail = this.sceneTime = 0;
    this.previousMode = '';
  }
  applySettings(settings: Settings, reduced: boolean) {
    this.settings = settings;
    this.reduced = reduced;
    this.model.applySettings(settings, reduced);
  }
  step(race: Race, weather: Weather) {
    this.model.step(captureVfxFrame(race, weather));
  }
  advance(
    dt: number,
    race: Race | null,
    mode: string,
    paused: boolean,
    alpha: number,
    focus: number,
    weather: Weather,
    results = false,
  ) {
    if (this.previousMode && this.previousMode !== mode) this.reset();
    this.previousMode = mode;
    if (paused) return this.time;
    if (mode === 'race' && race) {
      if (this.model.finishTime !== null || results) {
        this.tail = Math.min(2, this.tail + Math.min(0.1, dt));
        this.time = (this.model.finishTime ?? this.model.time) + this.tail;
      } else {
        // Pausing clears the app's interpolation accumulator. Keep the last presented
        // instant until simulation catches up instead of rewinding on the resume frame.
        this.time = Math.max(this.time, 0, (race.frame - 1 + alpha) / HZ);
      }
    } else {
      this.sceneTime += Math.min(0.05, dt);
      this.time = this.sceneTime;
      this.model.ambientStep(this.time, focus, weather);
    }
    return this.time;
  }
  render(camera: THREE.Camera, race: Race | null, focus: number, fog: THREE.Fog, day: string) {
    if (day === 'night') this.light.setRGB(0.48, 0.57, 0.7);
    else if (day === 'afternoon') this.light.setRGB(1.05, 0.83, 0.72);
    else this.light.setRGB(1, 1, 1);
    this.protection.set(2, 2, 3, 3);
    if (race) {
      const p = race.riders[0];
      camera.updateMatrixWorld();
      this.point.set(p.x * SCALE, p.height * SCALE + 0.65, (p.lane - 1.5) * LANE).project(camera);
      this.nextPoint
        .set(
          p.x * SCALE + 4,
          heightAt(race.track, p.x + 4 / SCALE, p.lane) * SCALE + 0.35,
          (p.lane - 1.5) * LANE,
        )
        .project(camera);
      this.protection.set(
        Math.min(this.point.x, this.nextPoint.x) - 0.035,
        Math.min(this.point.y, this.nextPoint.y) - 0.06,
        Math.max(this.point.x, this.nextPoint.x) + 0.04,
        Math.max(this.point.y, this.nextPoint.y) + 0.09,
      );
    }
    this.renderer.update(
      this.time,
      focus,
      this.settings,
      this.reduced,
      this.light,
      fog,
      this.protection,
    );
  }
  get completed() {
    return this.tail >= 2;
  }
  diagnostics() {
    return { ...this.model.diagnostics(this.time), tail: this.tail };
  }
  dispose() {
    this.renderer.dispose();
  }
}
