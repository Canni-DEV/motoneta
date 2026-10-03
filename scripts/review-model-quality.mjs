// Review the exported GLBs through the real Bike/World renderers.
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const label = process.argv[2] ?? 'esencial';
const families = process.argv.includes('--families');
const variants = families ? ['core', 'sprint', 'trail'] : ['core'];
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Use a simple review label');
const directory = `assets/motocross/review/${label}`;
await mkdir(directory, { recursive: true });
let server;
const url = 'http://127.0.0.1:5173';
try { await fetch(url); } catch {
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173'], { stdio: 'ignore' });
  for (let attempt = 0; attempt < 100; attempt++) {
    try { await fetch(url); break; } catch { await new Promise((resolve) => setTimeout(resolve, 200)); }
  }
}
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  if (process.env.MODEL_REVIEW_RUNTIME) await page.route('**/src/bike-model.ts*', async (route) => {
    const response = await route.fetch({ url: new URL(process.env.MODEL_REVIEW_RUNTIME, route.request().url()).href });
    await route.fulfill({ response });
  });
  if (process.env.MODEL_REVIEW_MODELS) {
    await page.route('**/models/motocross-*.glb', async (route) => route.fulfill({
      contentType: 'model/gltf-binary', body: await readFile(join(process.env.MODEL_REVIEW_MODELS, new URL(route.request().url()).pathname.split('/').at(-1))),
    }));
  }
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__motoneta?.models === 'ready');
  await page.evaluate(async ({ neutral, clearanceFamilies }) => {
    // The review renders explicitly; stop the menu's background animation from competing for SwiftShader.
    window.requestAnimationFrame = () => 0;
    const source = (path) => import(/* @vite-ignore */ path);
    const threeUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => /\/deps\/three\.js\?/.test(name));
    const THREE = await import(threeUrl);
    const [{ Bike, loadBikeAssets }, { defaultAppearance }] = await Promise.all([source('/src/bike-model.ts'), source('/src/appearance.ts')]);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(1200, 1000);
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '10000' });
    document.body.append(renderer.domElement);
    document.body.style.margin = '0';
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#17232b');
    scene.add(new THREE.HemisphereLight('#d7ecff', '#45545e', 2));
    const key = new THREE.DirectionalLight('#fff0e0', 3.4);
    key.position.set(2, 5, 4); key.castShadow = true; key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0003; key.shadow.normalBias = 0.012;
    Object.assign(key.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: 0.1, far: 15 });
    scene.add(key);
    const rim = new THREE.DirectionalLight('#c9eaff', 2.4); rim.position.set(-3, 3, -4); scene.add(rim);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), new THREE.MeshStandardMaterial({ color: '#65818e', roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.016; floor.receiveShadow = true; scene.add(floor);
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 30);
    const bike = new Bike(0xe05a3b, await loadBikeAssets());
    const appearance = defaultAppearance('#e05a3b');
    for (const slot of ['fairing', 'fender', 'plate', 'exhaust', 'wheels']) appearance.paints[slot].primary = '#fa3439';
    appearance.paints.seat.primary = '#20262a';
    appearance.paints.boots.primary = '#e05a3b';
    bike.setAppearance(appearance); scene.add(bike.root);
    const visibleMeshes = () => {
      const meshes = [];
      bike.root.traverseVisible((object) => { if (object.isMesh) meshes.push(object); });
      return meshes;
    };
    window.modelReviewGeometry = () => {
      bike.root.updateMatrixWorld(true);
      const candidates = [];
      if (clearanceFamilies) {
        for (const root of [bike.variants[bike.quality], bike.rider]) root.traverse((mesh) => { if (mesh.isMesh) candidates.push(mesh); });
      } else candidates.push(...visibleMeshes());
      return candidates.filter((mesh) => /Slot_(pants|torso|boots|seat|fairing)_/.test(mesh.name)).map((mesh) => {
        const position = mesh.geometry.attributes.position, vertices = [], supportVertices = [];
        for (let i = 0; i < position.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(position, i);
          if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, point);
          vertices.push(point.applyMatrix4(mesh.matrixWorld).toArray());
        }
        if (/Slot_pants_/.test(mesh.name)) {
          // Sample the actual cloth surface; a decimated mesh need not retain
          // vertices at the six anatomical contact locations.
          const seat = bike.variants[bike.quality].getObjectByName('Slot_seat_core');
          const material = mesh.material, previousSide = material.side;
          material.side = THREE.DoubleSide; mesh.computeBoundingSphere();
          const direction = new THREE.Vector3(0, -1, 0).transformDirection(seat.matrixWorld);
          for (const x of [-.26, -.22, -.18]) for (const z of [-.025, .025]) {
            const origin = seat.localToWorld(new THREE.Vector3(x, 1.1, z));
            const hits = new THREE.Raycaster(origin, direction).intersectObject(mesh, false);
            if (hits.length >= 2) supportVertices.push(hits.at(-1).point.toArray());
          }
          material.side = previousSide;
        }
        return { name: mesh.name, vertices, supportVertices, indices: mesh.geometry.index ? Array.from(mesh.geometry.index.array) : Array.from({ length: position.count }, (_, i) => i) };
      });
    };
    window.modelQualityReview = (quality, view, pose = 'ground', parts = {}) => {
      const [poseName, explicitAge] = pose.split('@');
      pose = poseName;
      for (const slot of Object.keys(appearance.parts)) appearance.parts[slot] = parts[slot] ?? 'core';
      bike.setAppearance(appearance);
      bike.setQuality(quality); bike.reset();
      const crash = ['rolling', 'down', 'mounting'].includes(pose);
      for (let frame = 0; frame < 75; frame++) {
        const airborne = pose === 'flight' || (pose === 'landing' && frame < 69);
        bike.update({ time: frame / 60, paused: false, speed: 2.8, grounded: !airborne, ground: () => airborne ? -2 : 0,
          recovery: crash, tilt: pose === 'wheelie' ? 0.7 : pose === 'flight' ? 0.26 : 0,
          laneMotion: pose === 'steering' ? 1 : 0, lane: 2,
          crashPhase: crash ? pose : 'none', crashPhaseAge: explicitAge !== undefined ? Number(explicitAge) : pose === 'rolling' ? 16 : pose === 'mounting' ? 18 : 24,
          crashRollDuration: 40, crashKind: 'impact', crashStartTilt: 0 });
      }
      const contact = ['contact', 'cutaway', 'seat'].includes(view);
      for (const mesh of visibleMeshes()) {
        if (neutral) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          material.vertexColors = false;
          material.color.set(mesh.isSkinnedMesh ? '#c3c6c9' : /seat/.test(mesh.name) ? '#5c6369' : '#8a949c');
          material.roughness = 0.78; material.metalness = 0;
          material.transparent = view === 'cutaway' && mesh.isSkinnedMesh;
          material.opacity = material.transparent ? 0.38 : 1;
          material.depthWrite = !material.transparent; material.needsUpdate = true;
        }
      }
      const hidden = view === 'seat' ? visibleMeshes().filter((mesh) => mesh.isSkinnedMesh) : [];
      hidden.forEach((mesh) => { mesh.visible = false; });
      const close = view === 'helmet' || view === 'body' || contact;
      const scale = view === 'helmet' ? 0.5 : contact ? 0.95 : view === 'body' ? 1.15 : crash ? 3.7 : 2.15;
      camera.left = -scale * 0.6; camera.right = scale * 0.6; camera.top = scale * 0.5; camera.bottom = -scale * 0.5;
      const target = new THREE.Vector3(contact ? -.16 : view === 'helmet' ? 0.115 : view === 'body' ? -0.04 : crash ? -0.3 : 0.02, contact ? .83 : view === 'helmet' ? 1.43 : view === 'body' ? 1 : 0.8, 0);
      const offset = view === 'side' ? [0, 0.12, 5] : view === 'front' ? [5, 0.15, 0] : view === 'rear-quarter' ? [-3, 1.2, 5] : view === 'rear' ? [-5, 0.15, 0] : [3, close ? 1.2 : 1.8, 5];
      camera.position.copy(target).add(new THREE.Vector3(...offset)); camera.lookAt(target); camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      hidden.forEach((mesh) => { mesh.visible = true; });
      return { triangles: renderer.info.render.triangles, draws: renderer.info.render.calls,
        pelvis: bike.rider.getObjectByName('Pelvis').getWorldPosition(new THREE.Vector3()).toArray(),
        head: bike.rider.getObjectByName('Head').getWorldPosition(new THREE.Vector3()).toArray() };
    };
  }, { neutral: process.argv.includes('--neutral'), clearanceFamilies: process.argv.includes('--clearance-families') });
  const report = [];
  const posedGeometry = [];
  for (const quality of ['high', 'low']) {
    for (const variant of variants) {
      const parts = Object.fromEntries(['fairing', 'fender', 'seat', 'exhaust', 'plate', 'wheels', 'helmet', 'visor', 'torso', 'gloves', 'pants', 'boots'].map((slot) => [slot, variant]));
      const prefix = `${quality}-${families ? `${variant}-` : ''}`;
      for (const view of (process.argv.includes('--quick') ? ['three-quarter', 'rear-quarter', 'rear', 'side', 'contact', 'seat'] : ['three-quarter', 'side', 'front', 'rear', 'rear-quarter', 'helmet', 'body', 'contact', 'cutaway', 'seat'])) {
        const stats = await page.evaluate(({ quality, view, parts }) => window.modelQualityReview(quality, view, 'ground', parts), { quality, view, parts });
        await page.screenshot({ path: `${directory}/${prefix}${view}.png` });
        report.push({ quality, variant, view, ...stats });
        if (view === 'side' && process.argv.includes('--poses-json')) posedGeometry.push({ quality, variant, pose: 'ground', meshes: await page.evaluate(() => window.modelReviewGeometry()) });
      }
      for (const pose of (process.argv.includes('--quick') ? ['landing', 'mounting'] : ['steering', 'wheelie', 'flight', 'landing', 'rolling', 'down', 'mounting'])) {
        const stats = await page.evaluate(({ quality, pose, parts }) => window.modelQualityReview(quality, 'three-quarter', pose, parts), { quality, pose, parts });
        await page.screenshot({ path: `${directory}/${prefix}${pose}.png` });
        report.push({ quality, variant, pose, ...stats });
        if (process.argv.includes('--poses-json')) posedGeometry.push({ quality, variant, pose, meshes: await page.evaluate(() => window.modelReviewGeometry()) });
      }
      console.log(`Captured ${quality}/${variant}`);
      if (process.argv.includes('--sweep') || process.argv.includes('--mount-sweep')) {
        for (const phase of (process.argv.includes('--mount-sweep') ? ['mounting'] : ['rolling', 'mounting'])) for (let age = 0; age <= (phase === 'rolling' ? 40 : 21); age++) {
          await page.evaluate(({ quality, pose, parts }) => window.modelQualityReview(quality, 'three-quarter', pose, parts), { quality, pose: `${phase}@${age}`, parts });
          posedGeometry.push({ quality, variant, pose: `${phase}@${age}`, meshes: await page.evaluate(() => window.modelReviewGeometry()) });
        }
      }
    }
  }
  if (process.argv.includes('--mixed')) {
    for (const quality of ['high', 'low']) for (const [first, second, view] of [
      ['helmet', 'visor', 'helmet'], ['torso', 'pants', 'body'], ['torso', 'gloves', 'body'], ['pants', 'boots', 'body'],
      ['fairing', 'seat', 'side'], ['fairing', 'fender', 'three-quarter'],
    ]) {
      const cells = [];
      for (const a of variants) for (const b of variants) {
        await page.evaluate(({ quality, view, parts }) => window.modelQualityReview(quality, view, 'ground', parts), { quality, view, parts: { [first]: a, [second]: b } });
        cells.push({ a, b, data: (await page.screenshot()).toString('base64') });
      }
      const sheet = await browser.newPage({ viewport: { width: 1200, height: 1060 } });
      await sheet.setContent(`<style>body{margin:0;background:#17232b;color:white;font:16px system-ui}h1{font-size:20px;margin:10px}main{display:grid;grid-template-columns:repeat(3,1fr)}figure{margin:0}img{width:400px;height:333px;display:block}figcaption{position:absolute;background:#17232b;padding:4px 10px}</style><h1>${quality}: ${first} × ${second}</h1><main>${cells.map(({ a, b, data }) => `<figure><figcaption>${a} / ${b}</figcaption><img src="data:image/png;base64,${data}"></figure>`).join('')}</main>`);
      await sheet.screenshot({ path: `${directory}/${quality}-mixed-${first}-${second}.png` });
      await sheet.close();
      console.log(`Captured ${quality}: ${first} / ${second}`);
    }
  }
  await writeFile(`${directory}/runtime-review.json`, JSON.stringify({ errors, report }, null, 2) + '\n');
  if (posedGeometry.length) await writeFile(`${directory}/posed-geometry.json.gz`, gzipSync(JSON.stringify(posedGeometry)));
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Runtime views saved to ${directory}`);
} finally { await browser.close(); server?.kill(); }
