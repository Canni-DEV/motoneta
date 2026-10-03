import { readFile, readdir, writeFile } from 'node:fs/promises';

const stage = process.argv[3] ?? 'esencial';
if (!/^[a-z0-9-]+$/.test(stage)) throw new Error('Use a simple review label');
const root = `assets/motocross/review/${stage}/performance`;
const readRuns = async (kind) => Promise.all((await readdir(`${root}/${kind}`)).filter((file) => /^run-\d+\.json$/.test(file)).sort().map(async (file) => JSON.parse(await readFile(`${root}/${kind}/${file}`, 'utf8'))));
const baseline = await readRuns('baseline');
const candidate = await readRuns('candidate');
if (baseline.length !== 3 || candidate.length !== 3) throw new Error('Expected three runs per model');
const median = (numbers) => numbers.toSorted((a, b) => a - b)[1];
const samples = [];
for (let viewport = 0; viewport < baseline[0].length; viewport++) {
  for (const quality of ['low', 'high']) {
    const values = (runs) => runs.map((run) => run[viewport].values.find((value) => value.quality === quality && value.scenario === 'six-riders-five-ghosts'));
    const before = values(baseline), after = values(candidate);
    const baselineP95Ms = median(before.map((value) => value.p95Ms));
    const candidateP95Ms = median(after.map((value) => value.p95Ms));
    const changePercent = (candidateP95Ms / baselineP95Ms - 1) * 100;
    const limitPercent = quality === 'low' ? 10 : 20;
    samples.push({ viewport: baseline[0][viewport].viewport, quality, scenario: 'six-riders-five-ghosts', baselineP95Ms, candidateP95Ms,
      baselineRunsP95Ms: before.map((value) => value.p95Ms), candidateRunsP95Ms: after.map((value) => value.p95Ms),
      changePercent: Math.round(changePercent * 10) / 10, limitPercent, passes: changePercent <= limitPercent,
      baselineDrawCalls: median(before.map((value) => value.drawCalls)), candidateDrawCalls: median(after.map((value) => value.drawCalls)) });
  }
}
const baselineReference = process.argv[2] ?? null;
const report = { reviewStage: stage, baselineCommit: /^[a-f0-9]{40}$/.test(baselineReference ?? '') ? baselineReference : null, baselineReference,
  method: 'Same Playwright Chromium/SwiftShader configuration; baseline GLBs and visual runtime routed from the preserved snapshot when MODEL_BENCHMARK_RUNTIME is set; three sequential runs per model, 20 warmed gl.finish render samples per scenario, median of run p95 values. Mobile viewport is emulated.',
  lowLimitPercent: 10, highLimitPercent: 20, stableResources: [...baseline, ...candidate].every((run) => run.every((row) => JSON.stringify(row.baseline) === JSON.stringify(row.after))), samples };
await writeFile(`${root}/comparison.json`, JSON.stringify(report, null, 2) + '\n');
await writeFile('assets/motocross/performance-comparison.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(samples, null, 2));
if (samples.some((sample) => !sample.passes) || !report.stableResources) process.exitCode = 1;
