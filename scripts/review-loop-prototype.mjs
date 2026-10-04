// Render the real GLB inside the real game renderer, without advancing gameplay.
import { chromium } from '@playwright/test';
import validator from 'gltf-validator';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const directory = 'assets/track-pieces/loop-prototype/review';
await mkdir(directory, { recursive: true });
const path = 'assets/track-pieces/loop-prototype/loop-prototype.glb';
const gltf = await validator.validateBytes(new Uint8Array(await readFile(path)), {
  uri: path, format: 'glb', maxIssues: 100, writeTimestamp: false,
});
if (gltf.issues.numErrors || gltf.issues.numWarnings)
  throw new Error(`GLB inválido: ${JSON.stringify(gltf.issues)}`);
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-webgl', '--enable-gpu', '--use-angle=d3d11'],
});
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1695, height: 928 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:5173/loop-prototype.html');
  await page.waitForFunction(() => window.__loopPrototype?.ready, undefined, { timeout: 60000 });
  const initialRiders = await page.evaluate(() => JSON.stringify(window.__loopPrototype.race.riders));
  const screenshots = [];
  for (const view of ['game', 'top', 'side']) {
    await page.locator(`[data-view="${view}"]`).click();
    await page.waitForTimeout(600);
    await page.locator('main').screenshot({ path: `${directory}/${view}.png` });
    screenshots.push(`${directory}/${view}.png`);
  }
  const integration = await page.evaluate(async () => {
    const review = window.__loopPrototype;
    const { getTrack } = await import('/src/core/tracks.ts');
    const THREE = await import('/node_modules/three/build/three.module.js');
    const heights = review.world.bikes.slice(0, 4).map((bike) => {
      const bounds = bike.getVisualBounds(new THREE.Box3());
      return bounds.max.y - bounds.min.y;
    });
    return {
      ...review.validation,
      maximumStationaryRiderHeight: Math.max(...heights),
      clearanceMargin: review.validation.bypassClearance - Math.max(...heights),
      unchangedTrack: JSON.stringify(review.race.track) === JSON.stringify(getTrack(0)),
      framesAdvanced: review.race.frame,
      riders: JSON.stringify(review.race.riders),
    };
  });
  if (Math.abs(integration.entryLane - 4) > 1e-5 ||
      Math.abs(integration.exitLane - 1) > 1e-5 ||
      Math.abs(integration.landingLane - 1) > 1e-5 ||
      integration.maximumWidth !== 2 * integration.width ||
      integration.entryWidth !== integration.width || integration.exitWidth !== integration.width ||
      integration.entryDirection[0] < 0.999 || integration.exitDirection[0] < 0.999 ||
      !integration.unchangedTrack || integration.framesAdvanced !== 0 ||
      integration.riders !== initialRiders || integration.clearanceMargin < 0.25)
    throw new Error(`Integración incorrecta: ${JSON.stringify(integration)}`);
  delete integration.riders;
  await page.locator('[data-view="game"]').click();
  await page.locator('#guides').uncheck();
  await page.waitForTimeout(600);
  await page.locator('main').screenshot({ path: `${directory}/game-clean.png` });
  screenshots.push(`${directory}/game-clean.png`);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${directory}/mobile.png` });
  screenshots.push(`${directory}/mobile.png`);
  await page.setViewportSize({ width: 640, height: 900 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${directory}/narrow.png` });
  screenshots.push(`${directory}/narrow.png`);
  const report = {
    prototype: 'visual-only',
    gltf: { errors: gltf.issues.numErrors, warnings: gltf.issues.numWarnings,
      triangles: gltf.info.totalTriangleCount },
    integration,
    screenshots,
    errors,
  };
  await writeFile(`${directory}/validation.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
