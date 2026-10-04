/** Isolated visual review. Never starts the app, advances a race, or saves a map. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { World } from '../renderer';
import { loadVehicleAssets } from '../bike-model';
import { loadCrowdAssets } from '../crowd-assets';
import { defaultAppearance } from '../appearance';
import { createRace } from '../core/racing';
import { getTrack } from '../core/tracks';
import { defaultSettings } from '../core/types';
import { LANE_WIDTH, WORLD_SCALE } from '../world-space';
import { soilNoise } from '../rendering/scene-geometry';

type View = 'game' | 'top' | 'side';
interface Sample { position: number[]; tangent: number[]; lateral: number[]; normal: number[]; width: number }
interface Manifest {
  visualOnly: boolean;
  width: number;
  maximumWidth: number;
  height: number;
  exitHeight: number;
  entry: number[];
  exit: number[];
  minimumBypassClearance: number;
  samples: Sample[];
}
const vector = (p: readonly number[]) => new THREE.Vector3(p[0], p[1], p[2]);
const baseX = 16;
const modelUrl = new URL('../../assets/track-pieces/loop-prototype/loop-prototype.glb', import.meta.url).href;
const blendUrl = new URL('../../assets/track-pieces/loop-prototype/loop-prototype.blend', import.meta.url).href;
const manifestUrl = new URL('../../assets/track-pieces/loop-prototype/manifest.json', import.meta.url).href;
const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')];
const canvas = document.querySelector<HTMLCanvasElement>('#world')!;
const labelRoot = document.querySelector<HTMLDivElement>('#labels')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
document.querySelector<HTMLAnchorElement>('#download-model')!.href = modelUrl;
document.querySelector<HTMLAnchorElement>('#download-blend')!.href = blendUrl;

async function start() {
  const [vehicles, crowd, asset, response] = await Promise.all([
    loadVehicleAssets(), loadCrowdAssets(), new GLTFLoader().loadAsync(modelUrl), fetch(manifestUrl),
  ]);
  if (!response.ok) throw new Error('No se pudo cargar la definición del loop.');
  const manifest = await response.json() as Manifest;
  if (manifest.width !== LANE_WIDTH || manifest.maximumWidth !== 2 * LANE_WIDTH || manifest.samples[0].width !== LANE_WIDTH || manifest.samples.at(-1)!.width !== LANE_WIDTH || manifest.minimumBypassClearance < 2.35)
    throw new Error('El modelo no coincide con el ancho o el paso libre del juego.');
  const settings = structuredClone(defaultSettings);
  settings.volume = 0;
  settings.bloom = false;
  settings.cameraShake = false;
  settings.reducedMotion = true;
  settings.vfx = { race: false, tracks: false, ambient: false, intensity: 'subtle' };
  const world = new World(canvas, settings, vehicles, crowd, true);
  await world.prepareBikes(4);
  const track = getTrack(0);
  world.setTrack(track);
  world.mode = 'race';
  world.zoomTarget = 1.15;
  const colors = ['#e05a3b', '#358aad', '#e6b853', '#729766'];
  const participants = colors.map((color, i) => ({
    id: `scale-${i}`, name: `Referencia ${i + 1}`, color, appearance: defaultAppearance(color),
  }));
  const race = createRace({
    track, ref: { id: track.id, revision: 'visual-review', name: track.name },
    mode: 'practice', player: participants[0], bots: participants.slice(1), difficulty: 'normal',
    seed: 1984, timeOfDay: 'morning', weather: 'clear',
  });
  const positions = [[baseX - 5, 3], [baseX + 1, 0], [baseX + 0.5, 1], [baseX - 0.7, 2]];
  race.riders.forEach((rider, i) => {
    rider.x = positions[i][0] / WORLD_SCALE;
    rider.lane = positions[i][1];
    rider.targetLane = rider.lane;
  });
  world.appearances = participants.map((p) => p.appearance);
  world.capture(race);

  const model = asset.scene;
  model.position.x = baseX;
  const bump = soilNoise();
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
    world.disposables.push(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      world.disposables.push(material);
      if (material instanceof THREE.MeshStandardMaterial && material.name === 'Loop_Dirt') {
        material.bumpMap = bump;
        material.bumpScale = 0.025;
      }
    }
  });
  world.course.add(model);
  const localBounds = new THREE.Box3().setFromObject(model).translate(new THREE.Vector3(-baseX, 0, 0));
  world.pieces.push({ group: model, base: baseX, bounds: localBounds });

  const guides = new THREE.Group();
  world.scene.add(guides);
  const labels: { element: HTMLDivElement; point: THREE.Vector3 }[] = [];
  function label(text: string, point: THREE.Vector3, kind = '') {
    const element = document.createElement('div');
    element.className = `marker ${kind}`;
    element.textContent = text;
    labelRoot.append(element);
    labels.push({ element, point });
  }
  const entry = vector(manifest.entry).add(new THREE.Vector3(baseX, 0, 0));
  const exit = vector(manifest.exit).add(new THREE.Vector3(baseX, 0, 0));
  label('Entrada · 4', entry.clone().add(new THREE.Vector3(-0.2, 0.55, 0)), 'entry');
  label('Salida elevada · 1', exit.clone().add(new THREE.Vector3(0.25, 0.45, 0)), 'exit');
  for (let lane = 0; lane < 4; lane++) {
    label(`${lane + 1}`, new THREE.Vector3(baseX - 6.2, 0.16, (lane - 1.5) * LANE_WIDTH));
    const points: THREE.Vector3[] = [];
    for (let x = baseX - 6; x < baseX + 9; x += 0.8) {
      points.push(new THREE.Vector3(x, 0.018, (lane - 1.5) * LANE_WIDTH),
                  new THREE.Vector3(x + 0.32, 0.018, (lane - 1.5) * LANE_WIDTH));
    }
    guides.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineBasicMaterial({ color: '#faf2d6', transparent: true, opacity: 0.4 })));
  }
  const green = new THREE.MeshBasicMaterial({ color: '#79cf87', side: THREE.DoubleSide });
  const arrow = new THREE.Shape([
    new THREE.Vector2(-0.22, -0.035), new THREE.Vector2(0.025, -0.035),
    new THREE.Vector2(0.025, -0.12), new THREE.Vector2(0.22, 0),
    new THREE.Vector2(0.025, 0.12), new THREE.Vector2(0.025, 0.035),
    new THREE.Vector2(-0.22, 0.035),
  ]);
  for (const index of [12, 70, 152, 215, 293]) {
    const sample = manifest.samples[index];
    const mark = new THREE.Mesh(new THREE.ShapeGeometry(arrow), green);
    const frame = new THREE.Matrix4().makeBasis(vector(sample.tangent), vector(sample.lateral).negate(), vector(sample.normal));
    mark.quaternion.setFromRotationMatrix(frame);
    mark.position.copy(vector(sample.position).addScaledVector(vector(sample.normal), 0.012));
    mark.position.x += baseX;
    guides.add(mark);
  }
  // A guide only: the exit and the whole flight arc keep lane 1's EXACT Z.
  const flightPoints: THREE.Vector3[] = [];
  for (let i = 0; i < 40; i++) {
    for (const t of [i / 40, (i + 0.53) / 40])
      flightPoints.push(new THREE.Vector3(exit.x + 4 * t,
        0.025 + (exit.y - 0.025) * (1 - t * t), exit.z));
  }
  const landing = new THREE.Vector3(exit.x + 4, 0.025, exit.z);
  guides.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(flightPoints),
    new THREE.LineBasicMaterial({ color: '#51b4e4' })));
  const target = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.23, 32),
    new THREE.MeshBasicMaterial({ color: '#51b4e4', side: THREE.DoubleSide }));
  target.rotation.x = -Math.PI / 2;
  target.position.copy(landing);
  guides.add(target);
  label('Caída · 1', landing.clone().add(new THREE.Vector3(0, 0.22, 0)), 'exit');

  let view: View = 'game';
  const controls = new OrbitControls(world.camera, canvas);
  controls.enabled = false;
  controls.enableDamping = false;
  controls.enableZoom = true;
  controls.maxPolarAngle = Math.PI / 2 - 0.015;
  const center = new THREE.Vector3(baseX, manifest.height / 2, 0);
  function setView(next: View) {
    view = next;
    controls.enabled = next !== 'game';
    world.camera.up.set(0, 1, 0);
    if (next === 'top') {
      controls.target.set(baseX, 0, 0);
      world.camera.position.set(baseX, 24, 0.001);
      world.camera.lookAt(controls.target);
      world.camera.zoom = 1.1;
    } else if (next === 'side') {
      controls.target.copy(center);
      world.camera.position.set(baseX, center.y, 22);
      world.camera.lookAt(center);
      world.camera.zoom = 1.45;
    } else {
      world.zoomTarget = world.camera.zoom = 1.15;
    }
    world.camera.updateProjectionMatrix();
    controls.update();
    buttons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.view === next)));
    document.querySelector('#hint')!.textContent = next === 'game'
      ? 'Prototipo visual. Motos quietas para comparar escala y paso libre. Rueda del mouse: zoom.'
      : 'Arrastrá para girar la vista; botón derecho para desplazarla; rueda del mouse para acercarte.';
  }
  buttons.forEach((button) => {
    button.disabled = false;
    button.addEventListener('click', () => setView(button.dataset.view as View));
  });
  canvas.addEventListener('wheel', (event) => {
    if (view !== 'game') return;
    event.preventDefault();
    world.zoomBy(event.deltaY);
  }, { passive: false });
  let showGuides = true;
  document.querySelector<HTMLInputElement>('#guides')!.addEventListener('change', (event) => {
    showGuides = (event.target as HTMLInputElement).checked;
    guides.visible = showGuides;
    labelRoot.hidden = !showGuides;
  });
  const savedPosition = new THREE.Vector3();
  const savedRotation = new THREE.Quaternion();
  let frame = 0;
  function render(time: number) {
    frame = requestAnimationFrame(render);
    const zoom = world.camera.zoom;
    savedPosition.copy(world.camera.position);
    savedRotation.copy(world.camera.quaternion);
    world.render(time / 1000, race, true, 1, true);
    let refreshCamera = view !== 'game';
    if (view !== 'game') {
      world.camera.position.copy(savedPosition);
      world.camera.quaternion.copy(savedRotation);
      world.camera.zoom = zoom;
      world.camera.updateProjectionMatrix();
    } else {
      // Keep the same game viewing angle, while centering the specimen in a narrow panel.
      const aspect = world.width / world.height;
      const span = aspect > 1.1 ? 20 : 19;
      const shift = 5 - Math.min(5, span / world.camera.zoom * aspect * 0.14);
      world.camera.position.x += shift;
      refreshCamera = shift > 0.001;
    }
    if (refreshCamera) {
      world.camera.updateMatrixWorld();
      const bounds = world.environment.fitShadows(world.camera, manifest.height + 2);
      world.stadium.update(world.camera, 0, race, 'race', true, 1, true, 0, bounds);
      world.composer.render();
    }
    for (const item of labels) {
      const point = item.point.clone().project(world.camera);
      item.element.hidden = point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1;
      item.element.style.left = `${(point.x + 1) * canvas.clientWidth / 2}px`;
      item.element.style.top = `${(1 - point.y) * canvas.clientHeight / 2}px`;
    }
  }
  setView('game');
  status.hidden = true;
  render(0);
  Object.assign(window, { __loopPrototype: {
    ready: true, world, model, manifest, race, setView,
    validation: {
      entryLane: entry.z / LANE_WIDTH + 1.5 + 1,
      exitLane: exit.z / LANE_WIDTH + 1.5 + 1,
      landingLane: landing.z / LANE_WIDTH + 1.5 + 1,
      entryDirection: manifest.samples[0].tangent,
      exitDirection: manifest.samples.at(-1)!.tangent,
      width: manifest.width,
      maximumWidth: manifest.maximumWidth,
      entryWidth: manifest.samples[0].width,
      exitWidth: manifest.samples.at(-1)!.width,
      bypassClearance: manifest.minimumBypassClearance,
      trackId: track.id,
      physicalSegmentsAdded: 0,
    },
  } });
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(frame);
    controls.dispose();
    bump.dispose();
    const geometry = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    guides.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        geometry.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          materials.add(material);
      }
    });
    geometry.forEach((value) => value.dispose());
    materials.forEach((value) => value.dispose());
    world.dispose();
  }, { once: true });
}

void start().catch((error: unknown) => {
  status.textContent = error instanceof Error ? error.message : String(error);
  console.error(error);
});
