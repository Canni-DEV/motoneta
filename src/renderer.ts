import * as THREE from 'three';
import { WORLD_SCALE as SCALE, LANE_WIDTH as LANE } from './world-space';
import { box, mat, roadTexture, soilNoise, disposeResources } from './rendering/scene-geometry';
import { buildCourse, type CoursePiece } from './rendering/course';
import type { Appearance } from './appearance';
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
import { advanceGhostOpacity, ghostOverlapOpacity, projectGhostBounds } from './ghost-visibility';

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
  pieces: CoursePiece[] = [];
  bikes: Bike[] = [];
  ghostStart = Infinity;
  private ghostVisibilityPending = true;
  private readonly ghostWorldBounds = new THREE.Box3();
  private readonly playerScreenBounds = new THREE.Box2();
  private readonly ghostScreenBounds = new THREE.Box2();
  private readonly ghostProjectionPoint = new THREE.Vector3();
  appearances: Appearance[] = [];
  private readonly garageScene = new THREE.Scene();
  private readonly garageCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 30);
  private garageAppearance: Appearance | null = null;
  garageYaw = 0.45;
  garageZoom = 3.6;
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
  private projectionZoom = NaN;
  private readonly onResize = () => this.resize();
  constructor(
    public canvas: HTMLCanvasElement,
    public settings: Settings,
    private readonly bikeAssets: BikeAssets,
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
    this.ensureBikes(7);
    this.garageScene.background = new THREE.Color('#202b31');
    this.garageScene.add(new THREE.HemisphereLight('#f7f3e9', '#526373', 2.5));
    const garageKey = new THREE.DirectionalLight('#ffffff', 3.2);
    garageKey.position.set(2, 5, 4);
    this.garageScene.add(garageKey);
    const garageRim = new THREE.DirectionalLight('#8dc9df', 1.5);
    garageRim.position.set(-3, 2, -3);
    this.garageScene.add(garageRim);
    const garageFloor = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.38, 0.09, 48), mat('#41515c', 0.62));
    garageFloor.position.y = -0.08;
    garageFloor.receiveShadow = true;
    this.garageScene.add(garageFloor);
    this.disposables.push(garageFloor.geometry, garageFloor.material as THREE.Material);
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
  ensureBikes(count: number) {
    if (count > 11) throw new Error('Se admiten como máximo seis pilotos y cinco fantasmas.');
    const colors = [0xc91c32, 0x358aad, 0xe6b853, 0x729766, 0xba85df, 0xe184b8, 0xaabbcc];
    while (this.bikes.length < count) {
      const bike = new Bike(colors[this.bikes.length % colors.length], this.bikeAssets, this.settings.quality);
      bike.root.visible = false;
      this.bikes.push(bike);
      this.scene.add(bike.root);
    }
  }
  setGarage(appearance: Appearance | null) {
    if (appearance && !this.garageAppearance) this.garageScene.add(this.bikes[0].root);
    if (!appearance && this.garageAppearance) this.scene.add(this.bikes[0].root);
    this.garageAppearance = appearance;
    if (appearance) {
      this.bikes[0].root.visible = true;
      this.bikes[0].root.position.set(0, 0, 0);
      this.bikes[0].root.rotation.set(0, 0, 0);
      this.bikes[0].setAppearance(appearance);
      this.bikes[0].reset();
    }
  }
  private renderGarage(time: number) {
    const bike = this.bikes[0];
    bike.setAppearance(this.garageAppearance!);
    bike.update({ time, paused: true, speed: 0, tilt: 0, grounded: true, recovery: false, ground: () => 0 });
    const radius = this.garageZoom;
    const aspect = this.width / this.height;
    if (this.garageCamera.aspect !== aspect) {
      this.garageCamera.aspect = aspect;
      this.garageCamera.updateProjectionMatrix();
    }
    this.garageCamera.position.set(radius * Math.sin(this.garageYaw), 1.65, radius * Math.cos(this.garageYaw));
    this.garageCamera.lookAt(0, 0.75, 0);
    this.renderPass.scene = this.garageScene;
    this.renderPass.camera = this.garageCamera;
    this.renderer.info.reset();
    this.composer.render();
  }
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
    disposeResources(this.disposables);
    this.disposables = [];
    this.pieces = [];
    this.pieces = buildCourse(track, this.course, this.dirt, this.surfaces, this.disposables);
    this.focus = 80 * SCALE;
    this.last = 0;
    this.previous = [];
    this.bikes.forEach((bike) => bike.reset());
    this.ghostVisibilityPending = true;
  }
  capture(r: Race) {
    this.previous.length = r.riders.length;
    for (let i = 0; i < r.riders.length; i++) {
      const p = r.riders[i];
      const previous = this.previous[i] ??= {
        x: 0, lane: 0, height: 0, tilt: 0, crashPhase: 'none', crashPhaseAge: 0,
      };
      previous.x = p.x;
      previous.lane = p.lane;
      previous.height = p.height;
      previous.tilt = p.tilt;
      previous.crashPhase = p.crashPhase;
      previous.crashPhaseAge = p.crashPhaseAge;
    }
  }
  beginRace(race: Race) {
    this.ghostVisibilityPending = true;
    this.vfx.reset(race.track, race.seed);
    this.weatherEffects.reset();
  }
  onSimulationStep(race: Race) {
    this.vfx.step(race, this.environment.weather);
    this.stadium.onSimulationStep(race);
  }
  render(time: number, race: Race | null, paused = false, alpha = 1, results = false) {
    if (this.garageAppearance) { this.renderGarage(time); return; }
    this.renderPass.scene = this.scene;
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
    const projectionChanged =
      this.camera.left !== (-span * aspect) / 2 || this.camera.right !== (span * aspect) / 2 ||
      this.camera.top !== span / 2 || this.camera.bottom !== -span / 2 ||
      this.camera.near !== 0.1 || this.camera.far !== 180 || this.projectionZoom !== this.camera.zoom;
    this.camera.left = (-span * aspect) / 2;
    this.camera.right = (span * aspect) / 2;
    this.camera.top = span / 2;
    this.camera.bottom = -span / 2;
    this.camera.near = 0.1;
    this.camera.far = 180;
    if (projectionChanged) {
      this.camera.updateProjectionMatrix();
      this.projectionZoom = this.camera.zoom;
    }
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
    let shadowHeight = 10;
    if (race) for (let i = 0; i < race.riders.length; i++)
      shadowHeight = Math.max(shadowHeight, lerp(this.previous[i]?.height, race.riders[i].height) * SCALE + 2);
    const shadowBounds = this.environment.fitShadows(activeCamera, shadowHeight);
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
      b.setAppearance(this.appearances[i] ?? p.color, i >= this.ghostStart);
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
    if (!menu && !editor && race?.riders[0] && this.ghostStart < race.riders.length) {
      activeCamera.updateWorldMatrix(true, false);
      projectGhostBounds(
        this.bikes[0].getVisualBounds(this.ghostWorldBounds), activeCamera,
        this.playerScreenBounds, this.ghostProjectionPoint,
      );
      for (let i = this.ghostStart; i < race.riders.length; i++) {
        const bike = this.bikes[i];
        projectGhostBounds(
          bike.getVisualBounds(this.ghostWorldBounds), activeCamera,
          this.ghostScreenBounds, this.ghostProjectionPoint,
        );
        const target = ghostOverlapOpacity(this.playerScreenBounds, this.ghostScreenBounds);
        if (this.ghostVisibilityPending) bike.setGhostOpacity(target);
        else if (!paused) bike.setGhostOpacity(this.reduced
          ? target
          : advanceGhostOpacity(bike.ghostOpacity, target, visualDt));
      }
      this.ghostVisibilityPending = false;
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
    disposeResources(this.disposables);
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
