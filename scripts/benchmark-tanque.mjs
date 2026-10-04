import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, release } from 'node:os';

const commit = execFileSync('git', ['rev-parse', process.argv[2] ?? 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
const candidateHashes = Object.fromEntries(await Promise.all([
  'public/models/tanque-low.glb', 'public/models/tanque-high.glb', 'src/bike-model.ts', 'src/vehicle-visual.ts',
].map(async (path) => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
const baseline = 'tmp/tanque-benchmark/baseline';
await mkdir(`${baseline}/models`, { recursive: true });
for (const name of ['bike-model.ts', 'renderer.ts']) {
  let content = execFileSync('git', ['show', `${commit}:src/${name}`], { encoding: 'utf8', windowsHide: true });
  content = content.replaceAll("from './", "from '/src/");
  if (name === 'renderer.ts') content = content.replace("from '/src/bike-model'", "from './bike-model'");
  if (name === 'bike-model.ts') for (const vehicle of ['motocross', 'motoneta'])
    content = content.replaceAll(`models/${vehicle}-`, `${baseline}/models/${vehicle}-`);
  await writeFile(`${baseline}/${name}`, content);
}
for (const vehicle of ['motocross', 'motoneta']) for (const quality of ['low', 'high'])
  await writeFile(`${baseline}/models/${vehicle}-${quality}.glb`, execFileSync('git', ['show', `${commit}:public/models/${vehicle}-${quality}.glb`], { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }));
const origin = process.env.REVIEW_ORIGIN ?? 'http://127.0.0.1:5173';
const seconds = Number(process.env.TANQUE_BENCHMARK_SECONDS ?? 10);
if (!Number.isFinite(seconds) || seconds < 1) throw new Error('Invalid benchmark duration');
const browser = await chromium.launch({ headless: true, args: ['--enable-webgl', '--enable-gpu', '--use-angle=d3d11'] });
const runs = [];
try {
  for (const quality of ['low', 'high']) for (const environment of [
    { timeOfDay: 'morning', weather: 'clear' }, { timeOfDay: 'night', weather: 'rain' },
  ]) for (let sample = 1; sample <= 3; sample++) for (const kind of ['baseline', 'candidate']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/tanque-benchmark`, (route) => route.fulfill({ contentType: 'text/html', body: '<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>' }));
    await page.goto(`${origin}/tanque-benchmark`);
    const result = await page.evaluate(async ({ kind, quality, environment, baseline, seconds }) => {
      const source = (path) => import(/* @vite-ignore */ path);
      const [{ World }, models, { loadCrowdAssets }, { defaultSettings }, { createRace }, { makeBots }, { BUILTINS }, appearanceModule] = await Promise.all([
        source(kind === 'baseline' ? `/${baseline}/renderer.ts` : '/src/renderer.ts'),
        source(kind === 'baseline' ? `/${baseline}/bike-model.ts` : '/src/bike-model.ts'), source('/src/crowd-assets.ts'),
        source('/src/core/types.ts'), source('/src/core/racing.ts'), source('/src/core/game.ts'), source('/src/core/maps.ts'), source('/src/appearance.ts'),
      ]);
      const vehicle = kind === 'baseline' ? 'motoneta' : 'tanque';
      const appearance = appearanceModule.defaultVehicleAppearance(vehicle);
      const world = new World(document.querySelector('canvas'), { ...defaultSettings, quality, ...environment, volume: 0 }, await models.loadVehicleAssets(), await loadCrowdAssets());
      const race = createRace({ ...BUILTINS[0], ...environment, mode: 'quick', player: { id: 'one', name: 'Piloto', color: '#bfc6cf', appearance }, bots: makeBots(5), difficulty: 'hard', seed: 1984 });
      race.riders.forEach((r, i) => { r.x = 800 + i * 12; r.lane = i % 4; r.speed = 3; });
      race.riders.push(...race.riders.slice(1).map((r) => structuredClone(r)));
      world.appearances = Array.from({ length: 11 }, () => structuredClone(appearance));
      world.ensureBikes(11); world.setTrack(race.track); world.mode = 'race'; world.ghostStart = 6;
      world.setTimeOfDay(environment.timeOfDay); world.setWeather(environment.weather);
      const gl = world.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
      const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      if (!debug || /swiftshader|llvmpipe|software|warp/i.test(gpu)) throw new Error(`Hardware GPU unavailable: ${gpu}`);
      let clock = 0;
      const render = () => world.render(clock += 1 / 60, race, false);
      const warmEnd = performance.now() + 3000;
      while (performance.now() < warmEnd) { await new Promise(requestAnimationFrame); render(); }
      const cpu = [], intervals = []; let previous = null;
      const end = performance.now() + seconds * 1000;
      while (performance.now() < end) {
        const frame = await new Promise(requestAnimationFrame);
        if (previous !== null) intervals.push(frame - previous); previous = frame;
        const start = performance.now(); render(); cpu.push(performance.now() - start);
      }
      const summarize = (values) => { const sorted = values.toSorted((a, b) => a - b); return { count: sorted.length, medianMs: sorted[Math.floor(sorted.length / 2)], p95Ms: sorted[Math.floor(sorted.length * .95)] }; };
      // Track rebuilds settle camera and visible stadium sectors before comparison.
      for (let i = 0; i < 3; i++) { world.setTrack(structuredClone(race.track)); render(); }
      const memory = { ...world.renderer.info.memory };
      for (let i = 0; i < 20; i++) { world.setTrack(structuredClone(race.track)); render(); }
      const after = { ...world.renderer.info.memory };
      const result = { gpu, cpu: summarize(cpu), frameIntervals: summarize(intervals), memory, after, stableResources: JSON.stringify(memory) === JSON.stringify(after), drawCalls: world.renderer.info.render.calls };
      world.dispose(); return result;
    }, { kind, quality, environment, baseline, seconds });
    if (errors.length) throw new Error(errors.join('\n'));
    runs.push({ kind, quality, environment, sample, ...result }); await page.close();
    console.log(`${quality}/${environment.weather} ${kind} ${sample}/3: CPU p95 ${result.cpu.p95Ms.toFixed(2)} ms`);
  }
} finally { await browser.close(); }
const median = (values) => values.toSorted((a, b) => a - b)[1];
const comparisons = [];
for (const quality of ['low', 'high']) for (const weather of ['clear', 'rain']) {
  const values = (kind) => runs.filter((r) => r.kind === kind && r.quality === quality && r.environment.weather === weather).map((r) => r.cpu.p95Ms);
  const before = median(values('baseline')), after = median(values('candidate'));
  const changePercent = (after / before - 1) * 100;
  comparisons.push({ quality, weather, baselineP95Ms: before, candidateP95Ms: after, changePercent, limitPercent: 10, passes: changePercent <= 10 });
}
const report = { baselineCommit: commit, baselineVehicle: 'motoneta', candidateVehicle: 'tanque', candidateHashes, platform: `${platform()} ${release()}`, cpu: cpus()[0]?.model,
  browser: browser.version(), viewport: { width: 1440, height: 900 }, seconds, samples: 3, warmupSeconds: 3,
  method: 'Same hardware GPU and Chromium/D3D11, six riders and five ghosts; High/Low in morning/clear and night/rain. Reference visual runtime and GLBs come from the recorded Git commit; unchanged dependencies use current sources. Sequential interleaved samples after shader warmup. Measure CPU render/submission without gl.finish; this does not measure GPU execution. Median of three run p95 values. Browser served by Vite; physical mobile performance is not measured.',
  stableResources: runs.every((r) => r.stableResources), comparisons, runs };
await writeFile('assets/tanque/performance-comparison.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ stableResources: report.stableResources, comparisons }, null, 2));
if (!report.stableResources || comparisons.some((c) => !c.passes)) process.exitCode = 1;
