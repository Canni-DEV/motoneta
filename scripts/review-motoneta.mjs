import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const directory = 'assets/motoneta/review/essential';
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
const origin = process.env.REVIEW_ORIGIN ?? 'http://127.0.0.1:5173';
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.route(`${origin}/`, (route) => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0;background:#202321}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>' }));
await page.goto(origin);
await page.evaluate(async () => {
  const source = (path) => import(/* @vite-ignore */ path);
  const [THREE,{Bike,loadVehicleAssets},{defaultAppearance}] = await Promise.all([source('/node_modules/three/build/three.module.js'),source('/src/bike-model.ts'),source('/src/appearance.ts')]);
  const assets = await loadVehicleAssets();
  const renderer = new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true});
  renderer.setSize(1200,900);renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#303738');
  scene.add(new THREE.HemisphereLight('#eef4ff','#74705e',2));
  const light=new THREE.DirectionalLight('#fff3d9',3);light.position.set(2,5,3);light.castShadow=true;light.shadow.mapSize.set(2048,2048);scene.add(light);
  const fill=new THREE.DirectionalLight('#bed2f4',1.8);fill.position.set(-2,3,-4);scene.add(fill);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:'#424a46',roughness:.94}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;scene.add(floor);
  const camera=new THREE.PerspectiveCamera(32,1200/900,.01,50);
  const appearance=defaultAppearance('#e05a3b');appearance.vehicle='motoneta';
  const bike=new Bike(0xe05a3b,assets.motoneta,'high','motoneta');bike.setAppearance(appearance);scene.add(bike.root);
  const state={time:0,paused:false,speed:0,tilt:0,grounded:true,recovery:false,ground:()=>0,crashPhase:'none',lane:2};
  window.review={THREE,renderer,scene,camera,bike,state,appearance};
});
const captures=[];
for (const [name, cameraPosition, state, options = {}] of [
  ['garage-three-quarter',[2,1.5,2.6],{}],['garage-side',[0,1.25,3.5],{}],['garage-front',[3.3,1.4,.02],{}],
  ['riding',[2,1.5,2.7],{speed:3.125,tilt:.06}],
  ['airborne',[2,1.8,2.9],{speed:3.125,tilt:.35,grounded:false}],
  ['crash',[2.5,1.8,3.6],{speed:0,recovery:true,crashPhase:'down',crashPhaseAge:20}],
  ['mounting',[2.5,1.8,3.6],{speed:0,recovery:true,crashPhase:'mounting',crashPhaseAge:16}],
  ['competition',[2,1.5,2.6],{}, {variant:'sprint'}],
  ['touring',[2,1.5,2.6],{}, {variant:'trail'}],
  ['essential-low',[2,1.5,2.6],{}, {quality:'low'}],
  ['mixed-low',[2,1.5,2.6],{}, {quality:'low',mixed:true}],
]) {
  await page.evaluate(({cameraPosition,state,options})=>{
    const r=window.review;r.bike.reset();r.camera.position.set(...cameraPosition);r.camera.lookAt(0,.75,0);
    const appearance=structuredClone(r.appearance);
    const slots=['fairing','fender','seat','exhaust','plate','wheels'];
    slots.forEach((slot,i)=>appearance.parts[slot]=options.mixed?['core','sprint','trail'][i%3]:options.variant??'core');
    r.bike.setQuality(options.quality??'high');r.bike.setAppearance(appearance);
    r.bike.update({...r.state,...state,time:.016});r.renderer.render(r.scene,r.camera);r.renderer.getContext().finish();
  },{cameraPosition,state,options});
  await page.screenshot({path:`${directory}/${name}.png`});captures.push(name);
}
await browser.close();
if(errors.length)throw new Error(errors.join('\n'));
await writeFile(`${directory}/index.html`, `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Motoneta · revisión del modelo</title><style>body{background:#202321;color:#eff0ec;font:16px system-ui;margin:32px auto;max-width:1200px;padding:0 20px}img{width:100%;height:auto;border-radius:12px}section{margin:32px 0}p{line-height:1.6}h2{text-transform:capitalize}a{color:#f1b28f}</style><h1>Motoneta clásica</h1><p>Esencial aprobada con la referencia del usuario. Competición y Travesía conservan el rig y los apoyos de esa base. Incluye ambas calidades y una combinación de piezas. Las prendas conservan sus opciones actuales.</p><p><a href="../../performance-comparison.json">Informe de rendimiento</a> · <a href="../../model-validation.json">Validación de la fuente Blender</a></p>${captures.map(name=>`<section><h2>${name.replaceAll('-',' ')}</h2><img src="${name}.png" alt="Motoneta: ${name}" loading="lazy"></section>`).join('')}<h2>Integración en el juego</h2>${[1440,844].map(width=>['garage-locked','garage-unlocked','quick-race'].map(name=>`<section><h3>${name.replaceAll('-',' ')} · ${width}px</h3><img src="../ui/${name}-${width}.png" alt="${name}: ${width}px" loading="lazy"></section>`).join('')).join('')}</html>`);
console.log(`Revisión: ${directory}/index.html`);
