import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
try {
  const { physicsTrace } = await server.ssrLoadModule('/tests/physics-fixture.ts');
  const traces = Array.from({ length:5 },(_,track)=>[0,5].map(bots=>physicsTrace(track,bots))).flat();
  await writeFile('tests/fixtures/motoneta-4-physics.json',JSON.stringify(traces,null,2)+'\n');
  console.log('Saved ten motoneta-4 traces; the historical fixture is preserved.');
} finally { await server.close(); }
