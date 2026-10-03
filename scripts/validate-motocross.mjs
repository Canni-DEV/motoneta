import { readFile } from 'node:fs/promises';
import validator from 'gltf-validator';

let failed = false;
for (const vehicle of ['motocross', 'motoneta']) for (const quality of ['low', 'high']) {
  const path = `public/models/${vehicle}-${quality}.glb`;
  const bytes = await readFile(path);
  const report = await validator.validateBytes(new Uint8Array(bytes), {
    uri: path,
    format: 'glb',
    maxIssues: 1000,
    writeTimestamp: false,
    // The rider's meshes intentionally sit under RiderRig. The game drives the
    // bones and moves rig + meshes together; parent transforms are not used to
    // deform a skin. Runtime crash/ground-contact tests cover this hierarchy.
    ignoredIssues: ['NODE_SKINNED_MESH_NON_ROOT'],
  });
  const { numErrors, numWarnings, messages } = report.issues;
  console.log(`${vehicle}/${quality}: ${numErrors} errors, ${numWarnings} warnings; ${report.info?.totalTriangleCount ?? '?'} triangles in catalog`);
  for (const issue of messages.filter((item) => item.severity <= 1))
    console.log(`  ${issue.code}: ${issue.message} ${issue.pointer ?? ''}`);
  failed ||= numErrors > 0 || numWarnings > 0;
}
if (failed) process.exitCode = 1;
