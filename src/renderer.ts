import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { heightAt } from './core/tracks';
import {
  clamp,
  type Race,
  type Settings,
  type Track,
  type TimeOfDay,
  type Weather,
} from './core/types';
import { Environment } from './environment';
import { WeatherSurfaces } from './weather-surfaces';
import { WeatherEffects } from './weather-effects';
import { type GroundHeight } from './bike-pose';
import { Bike, type BikeAssets } from './bike-model';
import { Stadium } from './stadium';
import { type CrowdAssets } from './crowd-assets';
import { VfxSystem } from './vfx/system';
import { vfxSettings } from './vfx/config';
import { StadiumFlags } from './vfx/flags';
import { CinematicCamera } from './cinematic-camera';

const SCALE = 0.052,
  LANE = 1.22;
const mat = (color: THREE.ColorRepresentation, roughness = 0.82, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
const black = mat('#293731'),
  white = mat('#ebe9d8');
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function box(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  m: THREE.Material,
  rot = 0,
) {
  const o = new THREE.Mesh(boxGeo, m);
  o.position.set(x, y, z);
  o.scale.set(w, h, d);
  o.rotation.z = rot;
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9c673d';
  ctx.fillRect(0, 0, 512, 256);
  let seed = 421;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 15000; i++) {
    const v = random();
    ctx.fillStyle = v > 0.5 ? 'rgba(233,181,119,.10)' : 'rgba(42,30,17,.10)';
    ctx.fillRect(random() * 512, random() * 256, random() * 4 + 1, random() * 2 + 1);
  }
  for (let lane = 0; lane < 4; lane++)
    for (let j = 0; j < 3; j++) {
      ctx.strokeStyle = 'rgba(54,36,21,.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, lane * 64 + 20 + j * 9);
      ctx.lineTo(512, lane * 64 + 20 + j * 9);
      ctx.stroke();
    }
  ctx.setLineDash([25, 29]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(247,222,169,.5)';
  for (const y of [64, 128, 192]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 1);
  t.anisotropy = 8;
  return t;
}
function soilNoise() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!,
    data = ctx.createImageData(128, 128);
  for (let i = 0; i < data.data.length; i += 4) {
    const n = 120 + Math.sin(i * 23.193) * 34;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = n;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.3, 1.3);
  return t;
}
export class World {
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera();
  cinematic: CinematicCamera | null = null;
  beatDelay: number | null = null;
  private renderPass!: RenderPass;
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  course = new THREE.Group();
  pieces: { group: THREE.Group; base: number; bounds: THREE.Box3 }[] = [];
  bikes: Bike[] = [];
  ghostStart = Infinity;
  track: Track | null = null;
  road: THREE.Mesh;
  sun: THREE.DirectionalLight;
  environment: Environment;
  weatherEffects: WeatherEffects;
  readonly surfaces = new WeatherSurfaces();
  private dirt = this.surfaces.register(mat('#a66437'), { profile: 'dirt' });
  stadium: Stadium;
  vfx!: VfxSystem;
  flags: StadiumFlags;
  focus = 0;
  last = 0;
  width = 1;
  height = 1;
  mode: 'menu' | 'race' | 'editor' = 'menu';
  preview = 0.15;
  zoomTarget = 1;
  reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  previous: {
    x: number;
    lane: number;
    height: number;
    tilt: number;
    crashPhase: Race['riders'][number]['crashPhase'];
    crashPhaseAge: number;
  }[] = [];
  private readonly onResize = () => this.resize();
  constructor(
    public canvas: HTMLCanvasElement,
    public settings: Settings,
    assets: BikeAssets,
    crowdAssets: CrowdAssets,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor('#80958a');
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.renderer.info.autoReset = false;
    this.dirt.bumpMap = soilNoise();
    this.dirt.bumpScale = 0.04;
    this.environment = new Environment(this.scene);
    this.environment.setTimeOfDay(settings.timeOfDay);
    this.environment.setWeather(settings.weather);
    this.weatherEffects = new WeatherEffects(this.scene);
    this.sun = this.environment.sun;
    this.road = box(this.scene, 0, -0.18, 0, 150, 0.35, LANE * 4, this.dirt);
    const roadMat = new THREE.MeshStandardMaterial({
      map: roadTexture(),
      roughness: 1,
      color: '#e1c5a0',
      bumpMap: soilNoise(),
      bumpScale: 0.018,
    });
    this.surfaces.register(roadMat, { profile: 'track' });
    const roadTop = new THREE.Mesh(new THREE.PlaneGeometry(150, LANE * 4), roadMat);
    roadTop.rotation.x = -Math.PI / 2;
    roadTop.position.y = 0.003;
    roadTop.receiveShadow = true;
    this.scene.add(roadTop);
    this.roadTop = roadTop;
    const field = box(
      this.scene,
      0,
      -0.45,
      0,
      240,
      0.45,
      120,
      this.surfaces.register(mat('#596c4b'), { profile: 'field' }),
    );
    this.field = field;
    this.stadium = new Stadium(crowdAssets, settings.quality);
    this.flags = new StadiumFlags(this.scene);
    this.scene.add(this.stadium.root, this.course);
    for (const color of [0xc91c32, 0x358aad, 0xe6b853, 0x729766, 0xba85df, 0xe184b8, 0xaabbcc]) {
      const b = new Bike(color, assets, settings.quality);
      b.root.visible = false;
      this.bikes.push(b);
      this.scene.add(b.root);
    }
    this.composer = new EffectComposer(this.renderer);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.5, 1.25);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
      vertexShader:
        'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:
        'uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv; void main(){vec3 c=texture2D(tDiffuse,vUv).rgb; float vignette=1.0-.22*dot(vUv-.5,vUv-.5);float grain=fract(sin(dot(vUv+time,vec2(12.9898,78.233)))*43758.5453)-.5;c*=vignette;c+=grain*.009;gl_FragColor=vec4(c,1.0);}',
    });
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.applySettings();
    this.resize();
    window.addEventListener('resize', this.onResize);
  }
  field: THREE.Mesh;
  roadTop: THREE.Mesh;
  setTimeOfDay(timeOfDay: TimeOfDay, animate = false) {
    this.environment.setTimeOfDay(timeOfDay, animate && !this.reduced);
  }
  setWeather(weather: Weather, animate = false) {
    this.environment.setWeather(weather, animate && !this.reduced);
  }
  applySettings() {
    this.surfaces.setDetail(this.settings.surfaceDetail ?? 'detailed');
    this.reduced =
      this.settings.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.stadium.setQuality(this.settings.quality);
    this.bikes.forEach((bike) => bike.setQuality(this.settings.quality));
    this.renderer.setPixelRatio(
      Math.min(devicePixelRatio, this.settings.quality === 'high' ? 1.8 : 1),
    );
    this.renderer.shadowMap.enabled = this.settings.quality === 'high';
    this.bloom.enabled = this.settings.bloom && this.settings.quality === 'high';
    this.grade.enabled = this.settings.quality === 'high';
    this.vfx?.applySettings(this.settings, this.reduced);
    this.resize();
  }
  resize() {
    const w = this.canvas.clientWidth || innerWidth,
      h = this.canvas.clientHeight || innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  }
  resetZoom() {
    this.zoomTarget = this.camera.zoom = 1;
  }
  zoomBy(deltaPixels: number) {
    if (!Number.isFinite(deltaPixels)) return;
    // Cap individual wheel impulses; trackpads retain their finer increments.
    this.zoomTarget = clamp(
      this.zoomTarget * Math.exp(-clamp(deltaPixels, -120, 120) * 0.0015),
      1,
      5,
    );
  }
  setTrack(track: Track) {
    this.track = track;
    if (this.vfx) this.vfx.reset(track);
    else this.vfx = new VfxSystem(this.scene, track, this.settings);
    this.vfx.applySettings(this.settings, this.reduced);
    this.weatherEffects.reset();
    this.flags.setTrack(track);
    this.stadium.setTrack(track);
    this.course.clear();
    this.surfaces.clearTrack();
    this.surfaces.setTrack(track.length);
    this.disposables.forEach((d) => d.dispose());
    this.disposables = [];
    this.pieces = [];
    const mud = this.surfaces.register(mat('#473e2a'), { profile: 'mud', temporary: true }),
      grass = this.surfaces.register(mat('#76805a'), { profile: 'grass', temporary: true }),
      cool = this.surfaces.register(mat('#8fc3ba', 0.45), { profile: 'cool', temporary: true }),
      bump = this.surfaces.register(mat('#cda574'), { profile: 'bump', temporary: true });
    this.disposables.push(mud, grass, cool, bump);
    for (const s of track.segments) {
      if (s.piece === 'flat') continue;
      const group = new THREE.Group(),
        length = s.length * SCALE,
        hasHeight = s.profile.some((p) => p[1] > 0);
      for (let lane = 0; lane < 4; lane++) {
        if (!(s.lanes & (1 << lane))) continue;
        const z = (lane - 1.5) * LANE;
        if (hasHeight) {
          const shape = new THREE.Shape();
          shape.moveTo(0, -0.02);
          for (const [t, h] of s.profile) shape.lineTo(t * length, h * SCALE);
          shape.lineTo(length, -0.02);
          shape.closePath();
          const geo = new THREE.ExtrudeGeometry(shape, {
            depth: LANE - 0.012,
            bevelEnabled: false,
            steps: 1,
          });
          geo.computeVertexNormals();
          this.disposables.push(geo);
          const mesh = new THREE.Mesh(geo, s.surface === 'bump' ? bump : this.dirt);
          mesh.position.z = z - LANE / 2;
          mesh.receiveShadow = true;
          mesh.castShadow = true;
          group.add(mesh);
          const pts = s.profile.map(
            ([t, h]) => new THREE.Vector3(t * length, h * SCALE + 0.015, z - LANE / 2 + 0.03),
          );
          const lg = new THREE.BufferGeometry().setFromPoints(pts);
          this.disposables.push(lg);
          const lm = new THREE.LineBasicMaterial({
            color: '#f5d9ad',
            transparent: true,
            opacity: 0.7,
          });
          this.disposables.push(lm);
          group.add(new THREE.Line(lg, lm));
        } else if (s.surface !== 'dirt') {
          box(
            group,
            length / 2,
            0.012,
            z,
            length,
            0.028,
            LANE - 0.04,
            s.surface === 'mud' ? mud : s.surface === 'cool' ? cool : grass,
          );
          if (s.surface === 'cool')
            for (let j = 0; j < 3; j++)
              box(group, length * (0.25 + j * 0.22), 0.035, z, 0.05, 0.01, 0.64, white, 0.2);
          if (s.surface === 'grass')
            for (let j = 0; j < Math.min(10, Math.floor(length * 2)); j++)
              box(group, j * 0.45 + 0.1, 0.07, z + Math.sin(j) * 0.35, 0.035, 0.13, 0.04, grass);
        }
      }
      const bounds = new THREE.Box3().setFromObject(group);
      group.position.x = s.x * SCALE;
      this.course.add(group);
      this.pieces.push({ group, base: s.x * SCALE, bounds });
    }
    // Start and finish share a line, offset to the same logical origin as the timing system.
    const gate = new THREE.Group();
    for (const z of [-2.85, 2.85]) {
      box(gate, 0, 1.9, z, 0.14, 3.8, 0.15, white);
      box(gate, 0, 0.65, z, 0.22, 1.3, 0.23, black);
    }
    box(gate, 0, 3.7, 0, 0.26, 0.58, 5.95, black);
    for (let i = 0; i < 14; i++)
      for (let j = 0; j < 2; j++)
        box(
          gate,
          0.14,
          3.51 + j * 0.19,
          -2.66 + i * 0.4,
          0.018,
          0.18,
          0.38,
          (i + j) % 2 ? black : white,
        );
    for (let i = 0; i < 10; i++)
      for (let j = 0; j < 2; j++)
        box(
          gate,
          -0.1 + j * 0.22,
          0.022,
          -2.2 + i * 0.49,
          0.22,
          0.025,
          0.49,
          (i + j) % 2 ? black : white,
        );
    this.course.add(gate);
    this.pieces.push({
      group: gate,
      base: 80 * SCALE,
      bounds: new THREE.Box3().setFromObject(gate),
    });
    this.focus = 80 * SCALE;
    this.last = 0;
    this.previous = [];
    this.bikes.forEach((bike) => bike.reset());
  }
  capture(r: Race) {
    this.previous = r.riders.map((p) => ({
      x: p.x,
      lane: p.lane,
      height: p.height,
      tilt: p.tilt,
      crashPhase: p.crashPhase,
      crashPhaseAge: p.crashPhaseAge,
    }));
  }
  beginRace(race: Race) {
    this.vfx.reset(race.track, race.seed);
    this.weatherEffects.reset();
  }
  onSimulationStep(race: Race) {
    this.vfx.step(race, this.environment.weather);
    this.stadium.onSimulationStep(race);
  }
  render(time: number, race: Race | null, paused = false, alpha = 1, results = false) {
    const visualDt = Math.max(0, time - this.last || 0.016);
    const dt = Math.min(0.04, visualDt);
    this.last = time;
    if (!this.track) return;
    const track = this.track,
      menu = this.mode === 'menu',
      editor = this.mode === 'editor';
    const lerp = (old: number | undefined, current: number) =>
      old === undefined || paused || race?.phase === 'finished'
        ? current
        : old + (current - old) * alpha;
    let target = menu
      ? track.length * SCALE * 0.12
      : editor
        ? track.length * SCALE * this.preview
        : lerp(this.previous[0]?.x, race?.riders[0].x ?? 80) * SCALE;
    if (!menu && !editor) this.focus = target;
    else this.focus += (target - this.focus) * Math.min(1, dt * 3);
    const focus = this.focus,
      loop = track.length * SCALE;
    const effectTime = this.vfx.advance(
      visualDt,
      race,
      this.mode,
      paused,
      alpha,
      focus,
      this.environment.weather,
      results,
    );
    const effectsFrozen =
      paused || ((results || this.vfx.model.finishTime !== null) && this.vfx.completed);
    this.road.position.x = focus;
    this.roadTop.position.x = focus;
    const tex = (this.roadTop.material as THREE.MeshStandardMaterial).map!;
    tex.offset.x = focus / 15;
    this.field.position.x = focus;
    const aspect = this.width / this.height,
      span = menu ? (aspect > 1.1 ? 18 : 14) : editor ? 14 : aspect > 1.1 ? 20 : 19;
    // Narrow windows still need enough horizontal room for the whole bike.
    const zoomTarget = menu ? 1 : Math.min(this.zoomTarget, Math.max(1, (span * aspect) / 4));
    this.camera.zoom +=
      (zoomTarget - this.camera.zoom) * (1 - Math.exp(-12 * Math.min(visualDt, 0.15)));
    if (this.reduced || Math.abs(zoomTarget - this.camera.zoom) < 0.001)
      this.camera.zoom = zoomTarget;
    const visibleSpan = span / this.camera.zoom;
    this.camera.left = (-span * aspect) / 2;
    this.camera.right = (span * aspect) / 2;
    this.camera.top = span / 2;
    this.camera.bottom = -span / 2;
    this.camera.near = 0.1;
    this.camera.far = 180;
    this.camera.updateProjectionMatrix();
    // Keep the same viewing angle and bring the rider's jumps into the closer framing.
    const lift =
      !menu && !editor && race
        ? lerp(this.previous[0]?.height, race.riders[0].height) *
          SCALE *
          Math.min(1, (this.camera.zoom - 1) / 2)
        : 0;
    const lookX =
        focus +
        (menu ? (aspect > 1.1 ? -3.0 : 0) : editor ? 0 : Math.min(5, visibleSpan * aspect * 0.14)),
      lookY = menu ? 1.0 : 0.65 + lift;
    this.camera.position.set(lookX - 6, menu ? 10.5 : 11.5 + lift, menu ? 18 : 20);
    this.camera.lookAt(lookX, lookY, 0);
    if (this.settings.cameraShake && !this.reduced)
      this.camera.position.y += this.vfx.model.cameraOffset(effectTime);
    if (this.cinematic && race) {
      const player = race.riders[0];
      this.cinematic.update(
        race,
        {
          x: focus,
          y: lerp(this.previous[0]?.height, player.height) * SCALE,
          z: (lerp(this.previous[0]?.lane, player.lane) - 1.5) * LANE,
        },
        visualDt,
        aspect,
        paused,
        this.beatDelay,
      );
    }
    const activeCamera = this.cinematic && race ? this.cinematic.camera : this.camera;
    this.renderPass.camera = activeCamera;
    this.environment.update(
      effectsFrozen ? 0 : visualDt,
      focus,
      this.stadium.sectorWidth,
      this.settings,
      this.renderer,
      this.reduced,
    );
    const shadowBounds = this.environment.fitShadows(
      activeCamera,
      Math.max(
        10,
        ...(race?.riders.map((p, i) => lerp(this.previous[i]?.height, p.height) * SCALE + 2) ?? []),
      ),
    );
    for (const p of this.pieces) {
      const center = p.base + (p.bounds.min.x + p.bounds.max.x) / 2;
      const wrapped = p.base + Math.round((focus - center) / loop) * loop;
      p.group.position.x = wrapped;
      p.group.visible =
        wrapped + p.bounds.max.x >= shadowBounds.min.x &&
        wrapped + p.bounds.min.x <= shadowBounds.max.x;
    }
    this.stadium.update(
      activeCamera,
      Math.min(0.15, visualDt),
      race,
      this.mode,
      effectsFrozen,
      alpha,
      this.reduced || !vfxSettings(this.settings).ambient,
      effectTime,
      shadowBounds,
    );
    this.surfaces.update(this.environment.rainAmount, this.environment.snowAmount);
    this.weatherEffects.update(
      dt,
      activeCamera,
      this.settings,
      this.environment.rainAmount,
      this.environment.snowAmount,
      effectsFrozen,
      this.reduced,
      this.renderer.getPixelRatio(),
      effectTime,
      this.vfx.model.seed,
    );
    this.flags.update(
      activeCamera,
      effectTime,
      this.vfx.model.seed,
      this.reduced || !vfxSettings(this.settings).ambient,
      shadowBounds,
    );
    this.stadium.setLighting(this.environment.lampLevel, this.environment.nightAmount);
    for (let i = 0; i < this.bikes.length; i++) {
      const b = this.bikes[i],
        p = race?.riders[i];
      b.root.visible = !menu && !editor && !!p;
      if (!p) continue;
      b.setAppearance(p.color, i >= this.ghostStart);
      const prev = this.previous[i];
      b.root.position.set(
        (lerp(prev?.x, p.x) +
          Math.round(((race?.riders[0].x ?? p.x) - p.x) / track.length) * track.length) *
          SCALE,
        lerp(prev?.height, p.height) * SCALE,
        (lerp(prev?.lane, p.lane) - 1.5) * LANE,
      );
      b.body.visible = !p.invincible || this.reduced || Math.floor(effectTime * 12) % 2 === 0;
      b.riderLayer.visible = b.body.visible && !(i === 0 && this.cinematic?.currentShot === 'helmet');
      const ground: GroundHeight = (x) =>
        heightAt(track, (b.root.position.x + x) / SCALE, b.root.position.z / LANE + 1.5) * SCALE -
        b.root.position.y;
      b.update({
        time,
        paused: paused || results || race?.phase === 'finished',
        speed: p.speed,
        tilt: lerp(prev?.tilt, p.tilt),
        grounded: p.grounded,
        recovery: p.recovery > 0,
        lane: p.lane,
        laneMotion: prev ? (p.lane - prev.lane) / 0.034 : 0,
        crashPhase: p.crashPhase,
        crashPhaseAge:
          prev?.crashPhase === p.crashPhase
            ? lerp(prev.crashPhaseAge, p.crashPhaseAge)
            : p.crashPhaseAge,
        crashRollDuration: p.crashRollDuration,
        crashKind: p.crashKind,
        crashStartTilt: p.crashStartTilt,
        ground,
        reducedMotion: this.reduced,
      });
    }
    for (const bike of this.bikes) bike.setLighting(this.environment.lampLevel);
    this.vfx.render(activeCamera, race, focus, this.environment.fog, this.environment.timeOfDay);
    this.grade.uniforms.time.value = this.reduced ? 0 : effectTime % 100;
    this.renderer.info.reset();
    // Both profiles use the existing offscreen target and color-output pass. Rendering
    // every low-quality mesh directly into the MSAA canvas can be expensive on software
    // GPUs; bloom and grading remain disabled in that profile.
    this.composer.render();
  }
  dispose() {
    window.removeEventListener('resize', this.onResize);
    this.vfx?.dispose();
    this.flags.dispose();
    this.weatherEffects.dispose();
    this.stadium.dispose();
    this.environment.dispose();
    this.bikes.forEach((bike) => bike.dispose());
    this.disposables.forEach((resource) => resource.dispose());
    const roadMaterial = this.roadTop.material as THREE.MeshStandardMaterial;
    const materials = [roadMaterial, this.dirt, this.field.material as THREE.MeshStandardMaterial];
    this.surfaces.dispose();
    const textures = new Set<THREE.Texture>();
    for (const material of materials) {
      if (material.map) textures.add(material.map);
      if (material.bumpMap) textures.add(material.bumpMap);
      material.dispose();
    }
    textures.forEach((texture) => texture.dispose());
    this.roadTop.geometry.dispose();
    this.composer.passes.forEach((pass) => pass.dispose());
    this.composer.dispose();
    this.renderer.dispose();
    this.scene.clear();
  }
}
