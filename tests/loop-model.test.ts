import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { BufferGeometry, Material, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildLoopModel } from '../src/rendering/loop-model';
import { LOOP_OFFSET } from '../src/core/loop-geometry';
import { WeatherSurfaces } from '../src/weather-surfaces';

it('matches the exported Blender riding surface to the actual in-game model', async () => {
  const buffer = await readFile(new URL('../assets/track-pieces/loop-prototype/loop-prototype.glb', import.meta.url));
  const data = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  const asset = await new GLTFLoader().parseAsync(data, '');
  const surfaces = new WeatherSurfaces(), dirt = new MeshStandardMaterial();
  const disposables: (BufferGeometry | Material)[] = [];
  const runtime = buildLoopModel(dirt, surfaces, disposables);
  try {
    asset.scene.updateMatrixWorld(true);
    runtime.updateMatrixWorld(true);
    const exported = asset.scene.getObjectByName('Loop_RidingSurface');
    expect(exported).toBeInstanceOf(Mesh);
    const positions = (mesh: Mesh) => {
      const attribute = mesh.geometry.getAttribute('position');
      return Array.from({ length: attribute.count }, (_, i) =>
        new Vector3().fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld));
    };
    const expected = positions(exported as Mesh).map(p => p.add(new Vector3(LOOP_OFFSET, 0, 0)));
    const actual = positions(runtime.children[0] as Mesh);
    // Compare world coordinates in both directions; exporter vertex ordering may differ.
    for (const [points, reference] of [[actual, expected], [expected, actual]])
      for (const point of points)
        expect(Math.min(...reference.map(other => point.distanceToSquared(other)))).toBeLessThan(1e-8);
  } finally {
    surfaces.dispose();
    dirt.dispose();
    disposables.forEach(resource => resource.dispose());
    asset.scene.traverse(object => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material) ? object.material : [object.material])
          material.dispose();
      }
    });
  }
});
