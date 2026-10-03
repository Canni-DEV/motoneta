import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { platform, release, cpus } from 'node:os';

// Production-only sampling. No gl.finish(), software-GPU flags or game debug hooks.
const options = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=') || 'true'];
}));
const seconds = Number(options.seconds ?? 30);
const samples = Number(options.samples ?? 3);
const warmup = Number(options.warmup ?? 5);
if (![seconds, samples, warmup].every((n) => Number.isFinite(n) && n > 0) || !Number.isInteger(samples))
  throw new Error('seconds/warmup must be positive; samples must be a positive integer.');
const output = resolve(options.output ?? `tmp/refactor/${options.label ?? 'candidate'}-gpu.json`);
const directory = resolve(options.directory ?? 'dist');
const server = await preview({
  configFile: false,
  build: { outDir: directory },
  preview: { host: '127.0.0.1', port: Number(options.port ?? 4174), strictPort: true },
});
let browser;
const percentile = (sorted, fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
const summarize = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return { count: sorted.length, medianMs: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95), p99Ms: percentile(sorted, 0.99) };
};
const report = {
  label: options.label ?? 'candidate',
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceVersion: execFileSync('git', ['describe', '--always', '--dirty'], { encoding: 'utf8' }).trim(),
  buildDirectory: directory,
  buildFingerprint: createHash('sha256').update(await readFile(join(directory, 'index.html'))).digest('hex'),
  platform: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  seconds, samples, warmup,
  configuration: { track: 1, laps: 9, bots: 5, difficulty: 'normal', seed: 1984, input: 'KeyZ', volume: 0, effects: 'defaults' },
  measurements: [],
};
try {
  browser = await chromium.launch({
    headless: options.visible !== 'true',
    args: ['--enable-webgl', '--enable-gpu', '--use-angle=d3d11'],
  });
  report.browser = browser.version();
  for (const quality of ['low', 'high']) for (const environment of [
    { timeOfDay: 'morning', weather: 'clear' },
    { timeOfDay: 'night', weather: 'rain' },
  ]) for (let sample = 0; sample < samples; sample++) {
    const context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1 });
    try {
      await context.addInitScript(({ quality, environment }) => {
        localStorage.setItem('motoneta.settings.v3', JSON.stringify({ quality, ...environment, volume: 0, attractReplays: false }));
        const nativeRaf = window.requestAnimationFrame.bind(window);
        const state = { active: false, last: null, intervals: [], cpu: [] };
        window.__frameSample = state;
        window.requestAnimationFrame = (callback) => nativeRaf((timestamp) => {
          if (state.active && state.last !== timestamp) {
            if (state.last !== null) state.intervals.push(timestamp - state.last);
            state.last = timestamp;
          }
          const start = performance.now();
          callback(timestamp);
          if (state.active) state.cpu.push(performance.now() - start);
        });
      }, { quality, environment });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(server.resolvedUrls.local[0]);
      await page.locator('#model-status').waitFor({ state: 'hidden', timeout: 60000 });
      report.graphics ??= await page.evaluate(() => {
        const gl = document.querySelector('#world').getContext('webgl2');
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        const renderer = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        return { renderer, vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), hardwareConfirmed: !!debug && !/swiftshader|llvmpipe|software|basic render|warp/i.test(renderer) };
      });
      if (!report.graphics.hardwareConfirmed)
        throw new Error(`A real GPU could not be confirmed: ${report.graphics.renderer}`);
      await page.locator('.home-modes [data-value="quick"]').click();
      await page.locator('#bots').selectOption('5');
      await page.locator('#laps').selectOption('9');
      await page.locator('[data-action="start"]').click();
      await page.locator('.race-ui').waitFor();
      await page.keyboard.down('z');
      await page.waitForTimeout(warmup * 1000);
      await page.evaluate(() => { window.__frameSample.active = true; });
      await page.waitForTimeout(seconds * 1000);
      const frames = await page.evaluate(() => {
        const state = window.__frameSample;
        state.active = false;
        return { intervals: state.intervals, cpu: state.cpu };
      });
      if (errors.length) throw new Error(errors.join('\n'));
      if (!frames.intervals.length) throw new Error('No frames were sampled.');
      const measurement = {
        quality, ...environment, sample,
        frames: summarize(frames.intervals),
        cpuSubmission: summarize(frames.cpu),
        averageFps: frames.intervals.length * 1000 / frames.intervals.reduce((a, b) => a + b, 0),
        framesOver33Ms: frames.intervals.filter((n) => n > 33.4).length,
        framesOver50Ms: frames.intervals.filter((n) => n > 50).length,
      };
      report.measurements.push(measurement);
      console.log(`${report.label}: ${quality}/${environment.timeOfDay}/${environment.weather} #${sample + 1}: ${measurement.averageFps.toFixed(1)} FPS, CPU p95 ${measurement.cpuSubmission.p95Ms.toFixed(2)} ms`);
    } finally { await context.close(); }
  }
} catch (error) {
  report.error = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
  console.log(`Report: ${output}`);
}
