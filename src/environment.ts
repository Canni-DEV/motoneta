import * as THREE from 'three';
import type { Settings, TimeOfDay, Weather } from './core/types';
import { ShadowCoverage } from './shadow-coverage';

const colors = ['sky', 'horizon', 'fog', 'ambient', 'ground', 'sun', 'fill'] as const;
type ColorKey = (typeof colors)[number];
type Preset = Record<ColorKey, string> & {
  direction: [number, number, number];
  ambientPower: number;
  sunPower: number;
  fillPower: number;
  exposure: number;
  lamps: number;
  fogNear: number;
  fogFar: number;
};
export const ENVIRONMENTS: Record<TimeOfDay, Preset> = {
  morning: {
    sky: '#80b9d3',
    horizon: '#eee0b9',
    fog: '#b8c7bf',
    ambient: '#dceef9',
    ground: '#79654e',
    sun: '#ffdfab',
    fill: '#b6d8ea',
    direction: [-14, 12, 10],
    ambientPower: 2.0,
    sunPower: 3.5,
    fillPower: 0.9,
    exposure: 1.1,
    lamps: 0,
    fogNear: 43,
    fogFar: 120,
  },
  afternoon: {
    sky: '#756781',
    horizon: '#efad70',
    fog: '#ac8b88',
    ambient: '#bfc3e1',
    ground: '#8c503c',
    sun: '#ffb25e',
    fill: '#a4b2de',
    direction: [16, 8, 6],
    ambientPower: 1.5,
    sunPower: 3.9,
    fillPower: 0.7,
    exposure: 1.05,
    lamps: 0.25,
    fogNear: 40,
    fogFar: 110,
  },
  night: {
    sky: '#080f24',
    horizon: '#253b61',
    fog: '#15243e',
    ambient: '#92b7ea',
    ground: '#273047',
    sun: '#acccff',
    fill: '#8aaee1',
    direction: [-10, 18, 9],
    ambientPower: 0.78,
    sunPower: 0.08,
    fillPower: 0.36,
    exposure: 1.05,
    lamps: 1,
    fogNear: 38,
    fogFar: 110,
  },
};

type Values = Omit<Preset, ColorKey | 'direction'> &
  Record<ColorKey, THREE.Color> & { direction: THREE.Vector3; rain: number; snow: number };
function values(p: Preset, weather: Weather = 'clear', night = false): Values {
  const converted = Object.fromEntries(colors.map((k) => [k, new THREE.Color(p[k])])) as Record<
    ColorKey,
    THREE.Color
  >;
  const result = {
    ...p,
    ...converted,
    direction: new THREE.Vector3(...p.direction),
    rain: 0,
    snow: 0,
  };
  if (weather === 'clear') return result;
  const snow = weather === 'snow';
  result.rain = snow ? 0 : 1;
  result.snow = snow ? 1 : 0;
  const overcast = new THREE.Color(night ? '#28374d' : snow ? '#b7c9d1' : '#7f969e');
  result.sky.lerp(overcast, 0.65);
  result.horizon.lerp(overcast, 0.6);
  result.fog.lerp(overcast, 0.65);
  result.ambient.lerp(new THREE.Color('#c6deeb'), 0.3);
  result.sun.lerp(new THREE.Color('#d7e6ee'), 0.5);
  result.sunPower *= snow ? 0.62 : 0.42;
  result.ambientPower *= snow ? 1 : 0.9;
  result.fogNear *= snow ? 0.92 : 0.85;
  result.fogFar *= snow ? 0.92 : 0.86;
  return result;
}
const numbers = [
  'ambientPower',
  'sunPower',
  'fillPower',
  'exposure',
  'lamps',
  'fogNear',
  'fogFar',
  'rain',
  'snow',
] as const;

/** Shared by the procedural fixtures and their actual light sources. */
export function stadiumLamp(width: number, absolute: number, stands = false) {
  const x = (absolute + 0.5) * width;
  return {
    position: new THREE.Vector3(x, 7.69, stands ? -5.84 : -5.46),
    target: new THREE.Vector3(x, stands ? 1.8 : 0, stands ? -11 : 0.5),
  };
}

interface LampSlot {
  light: THREE.DirectionalLight;
  stands: boolean;
}

const FLOODLIGHT_RANGE = 24;

/** Rendering-only controller. Stadium illumination is independent of player position. */
export class Environment {
  timeOfDay: TimeOfDay = 'morning';
  weather: Weather = 'clear';
  readonly sun = new THREE.DirectionalLight();
  readonly hemisphere = new THREE.HemisphereLight();
  readonly fill = new THREE.DirectionalLight();
  readonly fog = new THREE.Fog('#b8c7bf', 43, 120);
  readonly sky: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private current = values(ENVIRONMENTS.morning);
  private from = values(ENVIRONMENTS.morning);
  private to = values(ENVIRONMENTS.morning);
  private elapsed = 0.5;
  private slots: LampSlot[] = [];
  private readonly shadowCoverage = new ShadowCoverage();
  private readonly trackLights: THREE.SpotLight[] = [];
  private sectorWidth = 0;
  constructor(private scene: THREE.Scene) {
    scene.fog = this.fog;
    scene.background = null;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.bias = -0.0002;
    this.fill.position.set(4, 4, -10);
    scene.add(this.sun, this.sun.target, this.hemisphere, this.fill, this.fill.target);
    this.sky = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms: { sky: { value: new THREE.Color() }, horizon: { value: new THREE.Color() } },
        vertexShader:
          'varying vec2 uvSky; void main(){uvSky=uv;gl_Position=vec4(position.xy,1.0,1.0);}',
        fragmentShader: `uniform vec3 sky; uniform vec3 horizon; varying vec2 uvSky;
        void main(){gl_FragColor=vec4(mix(horizon,sky,smoothstep(0.0,1.0,uvSky.y)),1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    scene.add(this.sky);
    for (let i = 0; i < 2; i++) {
      const stands = i === 1;
      const light = new THREE.DirectionalLight('#e5efff', 0);
      light.name = stands ? 'Grandstand floodlight' : 'Track floodlight';
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.bias = -0.0003;
      light.shadow.normalBias = 0.04;
      // Several stadium lamps fill each other's shadows. Keep only a subdued
      // shared contact shadow instead of a hard silhouette from one distant sun.
      light.shadow.intensity = 0.28;
      scene.add(light, light.target);
      this.slots.push({ light, stands });
    }
  }
  get lampLevel() {
    return this.current.lamps;
  }
  get nightAmount() {
    return THREE.MathUtils.smoothstep(this.current.lamps, 0.25, 1);
  }
  get rainAmount() {
    return this.current.rain;
  }
  get snowAmount() {
    return this.current.snow;
  }
  setTimeOfDay(timeOfDay: TimeOfDay, animate = false) {
    if (timeOfDay === this.timeOfDay && animate) return;
    this.timeOfDay = timeOfDay;
    this.retarget(animate);
  }
  setWeather(weather: Weather, animate = false) {
    if (weather === this.weather && animate) return;
    this.weather = weather;
    this.retarget(animate);
  }
  private retarget(animate: boolean) {
    this.from = {
      ...this.current,
      ...Object.fromEntries(colors.map((k) => [k, this.current[k].clone()])),
      direction: this.current.direction.clone(),
    } as Values;
    this.to = values(ENVIRONMENTS[this.timeOfDay], this.weather, this.timeOfDay === 'night');
    this.elapsed = animate ? 0 : 0.5;
    if (!animate) this.interpolate(1);
  }
  private interpolate(t: number) {
    for (const k of colors) {
      if (t === 1) this.current[k].copy(this.to[k]);
      else this.current[k].lerpColors(this.from[k], this.to[k], t);
    }
    for (const k of numbers)
      this.current[k] = t === 1 ? this.to[k] : THREE.MathUtils.lerp(this.from[k], this.to[k], t);
    if (t === 1) this.current.direction.copy(this.to.direction);
    else this.current.direction.lerpVectors(this.from.direction, this.to.direction, t);
  }
  update(
    dt: number,
    focus: number,
    width: number,
    settings: Settings,
    renderer: Pick<THREE.WebGLRenderer, 'toneMappingExposure'>,
    reduced = false,
  ) {
    this.elapsed = Math.min(0.5, this.elapsed + Math.max(0, dt));
    if (reduced) this.elapsed = 0.5;
    const progress = this.elapsed * 2;
    this.interpolate(progress * progress * (3 - 2 * progress));
    const p = this.current,
      high = settings.quality === 'high';
    this.hemisphere.color.copy(p.ambient);
    this.hemisphere.groundColor.copy(p.ground);
    this.hemisphere.intensity = p.ambientPower;
    this.sun.color.copy(p.sun);
    this.sun.intensity = p.sunPower;
    this.sun.position.copy(p.direction).add(new THREE.Vector3(focus, 0, 0));
    this.sun.target.position.set(focus, 0, 0);
    this.sun.castShadow = high && this.timeOfDay !== 'night';
    this.fill.color.copy(p.fill);
    this.fill.intensity = p.fillPower;
    this.fill.position.set(focus + 4, 4, -10);
    this.fill.target.position.set(focus, 0, 0);
    this.fog.color.copy(p.fog);
    this.fog.near = p.fogNear;
    this.fog.far = p.fogFar;
    this.sky.material.uniforms.sky.value.copy(p.sky);
    this.sky.material.uniforms.horizon.value.copy(p.horizon);
    renderer.toneMappingExposure = p.exposure;
    this.sectorWidth = width;
    if (!width) return;
    // Parallel stadium lighting has no distance falloff or sector handoff. Moving both
    // endpoints only centers the shadow map; illumination stays identical along the track.
    for (const [i, slot] of this.slots.entries()) {
      const anchor = stadiumLamp(0, 0, slot.stands);
      anchor.position.x = anchor.target.x = focus;
      slot.light.position.copy(anchor.position);
      slot.light.target.position.copy(anchor.target);
      slot.light.intensity =
        p.lamps *
        THREE.MathUtils.lerp(slot.stands ? 0.6 : 1.3, slot.stands ? 0.48 : 0.72, this.nightAmount);
      slot.light.visible = p.lamps > 0;
      slot.light.castShadow = high && this.timeOfDay === 'night' && i === 0;
    }
  }
  diagnostics() {
    return {
      timeOfDay: this.timeOfDay,
      weather: this.weather,
      rain: this.rainAmount,
      snow: this.snowAmount,
      lampLevel: this.lampLevel,
      transition: this.elapsed / 0.5,
      trackLights: this.trackLights.map((light) => ({
        x: light.position.x,
        intensity: light.intensity,
        visible: light.visible,
      })),
      slots: this.slots.map((s) => ({
        stands: s.stands,
        intensity: s.light.intensity,
        visible: s.light.visible,
        shadow: s.light.castShadow,
        x: s.light.position.x,
      })),
    };
  }
  fitShadows(camera: THREE.OrthographicCamera | THREE.PerspectiveCamera, top: number) {
    this.shadowCoverage.setView(camera, top);
    this.updateTrackLights(this.shadowCoverage.receivers);
    if (this.sun.castShadow) this.shadowCoverage.fit(this.sun);
    for (const slot of this.slots) if (slot.light.castShadow) this.shadowCoverage.fit(slot.light);
    return this.shadowCoverage.casters;
  }
  private updateTrackLights(view: THREE.Box3) {
    const width = this.sectorWidth;
    if (!width) return;
    // Include every lamp whose finite cone can reach the view, then recycle only
    // sources beyond that margin. Lights stay on their towers as the camera moves.
    const count = Math.ceil((view.max.x - view.min.x + FLOODLIGHT_RANGE * 2) / width) + 1;
    while (this.trackLights.length < count) {
      const light = new THREE.SpotLight('#fff0d5', 0, FLOODLIGHT_RANGE, 1.03, 0.65, 2);
      light.name = 'Local track floodlight';
      this.scene.add(light, light.target);
      this.trackLights.push(light);
    }
    const size = this.trackLights.length;
    const first = Math.floor((view.min.x + view.max.x) / 2 / width - size / 2);
    for (let absolute = first; absolute < first + size; absolute++) {
      const light = this.trackLights[((absolute % size) + size) % size];
      const anchor = stadiumLamp(width, absolute);
      light.position.copy(anchor.position);
      light.target.position.copy(anchor.target);
      light.intensity = this.nightAmount * 130;
      light.visible = this.nightAmount > 0;
    }
  }
  dispose() {
    for (const light of this.trackLights) {
      light.removeFromParent();
      light.target.removeFromParent();
      light.dispose();
    }
    for (const s of this.slots) {
      s.light.removeFromParent();
      s.light.target.removeFromParent();
      s.light.dispose();
    }
    this.sun.dispose();
    [this.sun, this.sun.target, this.fill, this.fill.target, this.hemisphere, this.sky].forEach(
      (o) => o.removeFromParent(),
    );
    this.sky.geometry.dispose();
    this.sky.material.dispose();
  }
}
