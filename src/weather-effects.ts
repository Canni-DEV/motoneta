import * as THREE from 'three';
import type { Settings } from './core/types';
import { vfxSettings, windAt, windTravel } from './vfx/config';

const CAPACITY = 512;
// Fixed world dimensions, independent of viewport size, zoom and camera rotation.
// The margin around the visible course lets us recycle behind the camera's edges.
const WIDTH = 96;
const HEIGHT = 22;
const DEPTH = 36;
const wrap = (n: number, span: number) => ((n % span) + span) % span;
const near = (x: number, center: number) => x + Math.round((center - x) / WIDTH) * WIDTH;

/** World-space precipitation. The camera only chooses which distant copy to recycle. */
export class WeatherEffects {
  readonly rain: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  readonly snow: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private seeds = new Float32Array(CAPACITY * 4);
  private rainPositions = new Float32Array(CAPACITY * 6);
  private snowPositions = new Float32Array(CAPACITY * 3);
  private clock = 0;
  private count = 0;
  private recycleCenter = 0;
  private initialized = false;

  constructor(scene: THREE.Scene) {
    let seed = 982451653;
    for (let i = 0; i < this.seeds.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      this.seeds[i] = seed / 4294967296;
    }
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.rain = new THREE.LineSegments(
      rainGeometry,
      new THREE.LineBasicMaterial({
        color: '#c9e0ee',
        transparent: true,
        opacity: 0,
        depthWrite: false,
        fog: true,
      }),
    );
    const snowGeometry = new THREE.BufferGeometry();
    snowGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.snowPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    this.snow = new THREE.Points(
      snowGeometry,
      new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0 }, size: { value: 3 } },
        vertexShader: `uniform float size;
        void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_PointSize = size; }`,
        fragmentShader: `uniform float opacity;
        void main() {
          float distanceToCenter = length(gl_PointCoord - 0.5);
          float alpha = 1.0 - smoothstep(0.1, 0.5, distanceToCenter);
          gl_FragColor = vec4(vec3(0.88, 0.94, 1.0), alpha * opacity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
        transparent: true,
        depthWrite: false,
      }),
    );
    this.rain.name = 'Weather rain';
    this.snow.name = 'Weather snow';
    this.rain.frustumCulled = this.snow.frustumCulled = false;
    this.rain.visible = this.snow.visible = false;
    scene.add(this.rain, this.snow);
  }

  update(
    dt: number,
    camera: THREE.OrthographicCamera,
    settings: Settings,
    rain: number,
    snow: number,
    paused = false,
    reduced = false,
    pixelRatio = 1,
    presentationTime?: number,
    windSeed = 0,
  ) {
    this.count = settings.quality === 'high' ? CAPACITY : 192;
    const enabled = vfxSettings(settings).ambient && !reduced;
    this.rain.visible = enabled && rain > 0.001;
    this.snow.visible = enabled && snow > 0.001;
    this.rain.material.opacity = rain * 0.48;
    this.snow.material.uniforms.opacity.value = snow * 0.8;
    this.snow.material.uniforms.size.value = 3 * pixelRatio * camera.zoom;
    const total = rain + snow;
    const rainCount = total ? Math.round((this.count * rain) / total) : 0;
    const snowCount = total ? this.count - rainCount : 0;
    this.rain.geometry.setDrawRange(0, rainCount * 2);
    this.snow.geometry.setDrawRange(0, snowCount);
    if (!enabled || (!this.rain.visible && !this.snow.visible)) return;
    if (paused && this.initialized) return;
    this.initialized = true;
    this.clock = presentationTime ?? this.clock + (paused ? 0 : Math.min(0.05, Math.max(0, dt)));
    const drift = windTravel(this.clock, windSeed),
      wind = windAt(this.clock, windSeed);
    // Mesh transforms stay at the world origin. Existing visible particles retain
    // their world trajectory when panning, rotating or zooming the camera. Only
    // particles beyond the horizontal margin move to another copy of the volume.
    this.recycleCenter = camera.position.x;
    for (let i = 0; i < this.count; i++) {
      const x = (this.seeds[i * 4] - 0.5) * WIDTH;
      const y = this.seeds[i * 4 + 1] * HEIGHT;
      const z = (this.seeds[i * 4 + 2] - 0.5) * DEPTH;
      const speed = 0.8 + this.seeds[i * 4 + 3] * 0.4;
      const ry = wrap(y - this.clock * speed * 14, HEIGHT);
      const rx = near(x + drift.x, this.recycleCenter);
      const ri = i * 6;
      this.rainPositions[ri] = rx;
      this.rainPositions[ri + 1] = ry;
      this.rainPositions[ri + 2] = z + drift.z;
      this.rainPositions[ri + 3] = rx - wind.x * 0.032;
      this.rainPositions[ri + 4] = ry + 0.45;
      this.rainPositions[ri + 5] = z + drift.z - wind.z * 0.032;
      const si = i * 3;
      this.snowPositions[si] = near(
        x + drift.x + Math.sin(this.clock * 0.65 + y) * 0.35,
        this.recycleCenter,
      );
      this.snowPositions[si + 1] = wrap(y - this.clock * speed * 1.35, HEIGHT);
      this.snowPositions[si + 2] = z + drift.z + Math.sin(this.clock * 0.4 + x) * 0.18;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
    this.snow.geometry.attributes.position.needsUpdate = true;
  }

  diagnostics() {
    return {
      time: this.clock,
      count: this.count,
      rain: this.rain.visible,
      snow: this.snow.visible,
      draws: Number(this.rain.visible) + Number(this.snow.visible),
      recycleCenter: this.recycleCenter,
      bounds: [WIDTH, HEIGHT, DEPTH],
    };
  }
  reset() {
    this.clock = 0;
    this.initialized = false;
  }
  dispose() {
    for (const object of [this.rain, this.snow]) {
      object.removeFromParent();
      object.geometry.dispose();
      object.material.dispose();
    }
  }
}
