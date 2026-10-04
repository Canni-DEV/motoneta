import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = 'assets/tanque/review/essential';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const origin = process.env.REVIEW_ORIGIN ?? 'http://127.0.0.1:5173';
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>' }));
await page.goto(origin);
await page.evaluate(async () => {
  const source = (path) => import(/* @vite-ignore */ path);
  const [THREE, { Bike, loadVehicleAssets }, { defaultVehicleAppearance }] = await Promise.all([
    source('/node_modules/three/build/three.module.js'), source('/src/bike-model.ts'), source('/src/appearance.ts'),
  ]);
  const assets = await loadVehicleAssets();
  const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true });
  renderer.setSize(1200, 900); renderer.setPixelRatio(1); renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#303738');
  const hemisphere = new THREE.HemisphereLight('#eef4ff', '#74705e', 1.4); scene.add(hemisphere);
  const light = new THREE.DirectionalLight('#fff3d9', 2.5); light.position.set(2, 5, 3); light.castShadow = true; light.shadow.mapSize.set(2048, 2048); light.shadow.normalBias = .004; light.shadow.bias = -.0001; scene.add(light);
  const fill = new THREE.DirectionalLight('#bed2f4', 1.8); fill.position.set(-2, 3, -4); scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#424a46', roughness: .94 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(32, 1200 / 900, .01, 50);
  const appearance = defaultVehicleAppearance('tanque');
  const bike = new Bike(0xbfc6cf, assets.tanque, 'high', 'tanque'); bike.setAppearance(appearance); scene.add(bike.root);
  window.review = { renderer, scene, camera, bike, appearance, hemisphere, light, fill };
});
const captures = [];
for (const quality of ['high', 'low']) for (const [name, camera, state = {}, options = {}] of [
  ['three-quarter', [2, 1.5, -2.6], {}, { vehicleOnly: true }],
  ['three-quarter-left', [2, 1.5, 2.6], {}, { vehicleOnly: true }],
  ['side', [0, .9, 3.5], {}, { vehicleOnly: true }],
  ['rear', [-3.3, 1.1, .02], {}, { vehicleOnly: true }],
  ['front', [3.3, 1.4, .02], {}, { vehicleOnly: true }],
  ['riding', [2, 1.5, 2.7], { speed: 3.125, tilt: .06 }],
  ['airborne', [2, 1.8, 2.9], { speed: 3.125, tilt: .35, grounded: false }],
  ['crash', [2.5, 1.8, 3.6], { recovery: true, crashPhase: 'down', crashPhaseAge: 20 }],
  ['mounting', [2.5, 1.8, 3.6], { recovery: true, crashPhase: 'mounting', crashPhaseAge: 16 }],
  ['repainted', [2, 1.5, 2.6], {}, { paint: { primary: '#c82640', accent: '#ecd074' } }],
  ['rider-sprint', [2, 1.5, 2.6], {}, { rider: 'sprint' }],
  ['rider-trail', [2, 1.5, 2.6], {}, { rider: 'trail' }],
  ['night', [2, 1.5, 2.6], {}, { night: true }],
  ['ghost', [2, 1.5, 2.6], {}, { ghost: true }],
]) {
  const diagnostics = await page.evaluate(({ quality, camera, state, options }) => {
    const r = window.review; r.bike.reset(); r.camera.position.set(...camera); r.camera.lookAt(0, options.vehicleOnly ? .55 : .75, 0);
    const appearance = structuredClone(r.appearance);
    if (options.paint) appearance.paints.fairing = options.paint;
    for (const slot of ['helmet', 'visor', 'torso', 'gloves', 'pants', 'boots']) appearance.parts[slot] = options.rider ?? 'core';
    r.bike.setQuality(quality); r.bike.setAppearance(appearance, !!options.ghost); r.bike.riderLayer.visible = !options.vehicleOnly;
    r.scene.background.set(options.night ? '#101822' : '#303738');
    r.hemisphere.intensity = options.night ? .18 : 1.4;
    r.light.intensity = options.night ? .2 : 2.5; r.fill.intensity = options.night ? .15 : 1.8;
    r.bike.setLighting(options.night || options.ghost ? 1 : 0);
    r.bike.update({ time: .016, paused: false, speed: 0, tilt: 0, grounded: true, recovery: false, ground: () => 0, crashPhase: 'none', lane: 2, ...state });
    r.renderer.render(r.scene, r.camera); r.renderer.getContext().finish();
    if (options.night || options.ghost) {
      const lamps = []; r.bike.variants[quality].traverse((object) => {
        for (const mat of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : [])
          if (/^Lamp(Front|Reflector)$/.test(mat.name)) lamps.push(mat.emissiveIntensity);
      });
      if (r.bike.headlight.intensity !== (options.ghost ? 0 : 28) || lamps.some((level) => level !== (options.ghost ? 0 : 6)))
        throw new Error('Unexpected night/ghost lamp state');
      return { headlight: r.bike.headlight.intensity, emissive: lamps };
    }
  }, { quality, camera, state, options });
  if (diagnostics) console.log(`${quality} night lighting: ${JSON.stringify(diagnostics)}`);
  const filename = `${quality}-${name}`;
  await page.screenshot({ path: `${directory}/${filename}.png` }); captures.push(filename);
}
await browser.close();
if (errors.length) throw new Error(errors.join('\n'));
const labels = { 'three-quarter': 'Tres cuartos · lado izquierdo', 'three-quarter-left': 'Tres cuartos · lado derecho', side: 'Lateral', rear: 'Atrás', front: 'Frente', riding: 'Conducción', airborne: 'Salto', crash: 'Caída', mounting: 'Reincorporación', repainted: 'Principal y secundario', 'rider-sprint': 'Piloto Competición', 'rider-trail': 'Piloto Travesía', night: 'Faro nocturno', ghost: 'Fantasma' };
await writeFile(`${directory}/index.html`, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Tanque · revisión</title><style>body{background:#202b31;color:#eff0ec;font:16px system-ui;max-width:1200px;margin:auto;padding:24px}img{width:100%;border-radius:12px}section{margin:32px 0}a{color:#f1b28f}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}.pair figure{margin:0}.pair div{overflow:hidden;aspect-ratio:4/3}.pair img{height:100%;object-fit:contain}.pair .current{transform:scale(1.18)}figcaption{margin-top:8px}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>Tanque · revisión 4</h1><p>Carrocería fija, dos colores globales y piloto compartido. Frente con planos inclinados, pliegues diagonales del lateral, asiento moldeado y faro con lente y reflector.</p><div class="pair"><figure><div><img class="current" src="high-three-quarter-left.png" alt="Tanque actual"></div><figcaption>Modelo actual · High</figcaption></figure><figure><div><img src="../../concepts/model-reference.png" alt="Referencia proporcionada por el usuario"></div><figcaption>Referencia proporcionada</figcaption></figure></div><p><a href="../../concepts/turnaround-reference.png">Referencia de las cuatro vistas</a> · <a href="../../model-validation.json">Validación Blender</a> · <a href="../../performance-comparison.json">Rendimiento</a></p>${captures.map((name) => { const quality = name.startsWith('high-') ? 'High' : 'Low'; const label = labels[name.slice(quality.length + 1)]; return `<section><h2>${quality} · ${label}</h2><img src="${name}.png" alt="Tanque ${quality}: ${label}" loading="lazy"></section>`; }).join('')}</html>`);
console.log(`Revisión: ${directory}/index.html`);
