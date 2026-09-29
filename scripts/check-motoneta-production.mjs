import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { strict as assert } from 'node:assert';
import { chromium } from '@playwright/test';
import { identity, browserIdentity, evidenceRoot } from './game-identity.mjs';

const root = resolve('dist');
const directory = evidenceRoot;
await mkdir(directory, { recursive: true });
const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream',
  '.wav': 'audio/wav',
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/preview/')) {
      response.writeHead(404).end();
      return;
    }
    const file = resolve(
      root,
      decodeURIComponent(url.pathname.slice('/preview/'.length)) || 'index.html',
    );
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    response.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    response.end(await readFile(file));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [],
  failures = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('response', (response) => {
    if (response.status() >= 400) failures.push({ url: response.url(), status: response.status() });
  });
  await page.addInitScript(
    (key) => localStorage.setItem(key, JSON.stringify({ quality: 'high', volume: 0 })),
    browserIdentity.settingsKey,
  );
  await page.goto(url);
  await page.locator('#model-status').waitFor({ state: 'hidden' });
  await page.locator('.brand').waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.title(), identity.words.join(''));
  assert.equal(await page.locator('.brand').textContent(), identity.words.join(''));
  assert.equal(await page.locator('.brand .sr-only').textContent(), identity.words.join(''));
  const debug = await page.evaluate((key) => key in window, browserIdentity.debugKey);
  assert.equal(debug, false);
  const layout = [];
  for (const [width, height, label] of [
    [1440, 900, 'inicio-escritorio'],
    [844, 390, 'inicio-movil'],
    [640, 360, 'inicio-minimo'],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const bounds = await page.locator('.brand').boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
    await page.screenshot({ path: `${directory}/${identity.id}-${label}.png` });
    layout.push({ width, height, brand: bounds });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('.home-modes [data-value="quick"]').click();
  await page.locator('[data-action="start"]').click();
  await page.locator('.race-ui').waitFor();
  await page.waitForFunction(() => document.querySelector('#countdown')?.textContent === '');
  await page.screenshot({ path: `${directory}/${identity.id}-estadio.png` });
  const favicon = await page.request.get(url + 'favicon.svg');
  assert.equal(favicon.status(), 200);
  assert.match(await favicon.text(), /<title>MN<\/title>/);
  const iconPage = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await iconPage.setContent(
    `<style>body{margin:0}img{width:64px;height:64px;display:block}</style><img src="${url}favicon.svg">`,
  );
  await iconPage.locator('img').evaluate((image) => image.decode());
  await iconPage.screenshot({ path: `${directory}/${identity.id}-icono.png` });
  await iconPage.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(failures, []);
  await writeFile(
    `${directory}/${identity.id}-production.json`,
    JSON.stringify(
      {
        title: identity.words.join(''),
        debug,
        servedUnderSubdirectory: true,
        errors,
        failures,
        layout,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'MotoNeta production: title, logo, MN favicon, responsive layout, subdirectory assets and absent debug API verified.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
