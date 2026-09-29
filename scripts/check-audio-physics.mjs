import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { deepStrictEqual } from 'node:assert';
const baseline = JSON.parse(await readFile('tests/fixtures/motoneta-physics.json', 'utf8'));
const result = await build({
  entryPoints: ['tests/physics-fixture.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { physicsTrace } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`
);
for (const expected of baseline)
  deepStrictEqual(physicsTrace(expected.track, expected.bots), expected);
console.log('MotoNeta: ten complete races match the ruleset 2 physics and results.');
