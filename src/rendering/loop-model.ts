import * as THREE from 'three';
import { LOOP_MANIFEST, LOOP_OFFSET, LOOP_SAMPLES } from '../core/loop-geometry';
import { WORLD_SCALE } from '../world-space';
import { mat } from './scene-geometry';
import type { WeatherSurfaces } from '../weather-surfaces';
/** The same sampled ribbon exported by Blender; no second runtime curve. */
export function buildLoopModel(dirt: THREE.MeshStandardMaterial, surfaces: WeatherSurfaces, disposables: (THREE.BufferGeometry | THREE.Material)[]) {
  const group = new THREE.Group(), steel = mat('#35443d', 0.65), edge = mat('#e5c898', 0.85), paint = mat('#83a175', 0.9);
  steel.metalness = 0.25;
  disposables.push(steel, edge, paint);
  const vec = (p: number[]) => new THREE.Vector3(...p as [
    number,
    number,
    number
  ]);
  const mesh = (vertices: THREE.Vector3[], faces: number[], material: THREE.Material, uv?: number[]) => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(p => p.toArray()), 3));
    if (uv)
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(faces);
    geometry.computeVertexNormals();
    disposables.push(geometry);
    const object = new THREE.Mesh(geometry, material);
    object.castShadow = true;
    object.receiveShadow = true;
    group.add(object);
  };
  type Sample = (typeof LOOP_MANIFEST.samples)[number];
  const quads = (span: (s: Sample) => number, shift: (s: Sample) => number, lift: number) => {
    const vertices: THREE.Vector3[] = [], faces: number[] = [];
    for (const s of LOOP_MANIFEST.samples) {
      const p = vec(s.position), l = vec(s.lateral), n = vec(s.normal);
      const width = span(s), offset = shift(s);
      vertices.push(p.clone().addScaledVector(l, offset - width / 2).addScaledVector(n, lift), p.clone().addScaledVector(l, offset + width / 2).addScaledVector(n, lift));
    }
    for (let i = 0; i < LOOP_MANIFEST.samples.length - 1; i++) {
      const a = 2 * i, b = a + 2;
      faces.push(a, a + 1, b + 1, a, b + 1, b);
    }
    return { vertices, faces };
  };
  const surface = quads(s => s.width, () => 0, 0);
  const uv = LOOP_SAMPLES.flatMap(s => [s.distance * WORLD_SCALE, 0, s.distance * WORLD_SCALE, s.width * WORLD_SCALE]);
  mesh(surface.vertices, surface.faces, dirt, uv);
  const shell: THREE.Vector3[] = [], faces: number[] = [];
  for (const s of LOOP_MANIFEST.samples) {
    const p = vec(s.position), l = vec(s.lateral), n = vec(s.normal), left = p.clone().addScaledVector(l, -s.width / 2), right = p.clone().addScaledVector(l, s.width / 2);
    shell.push(left, right, right.clone().addScaledVector(n, -LOOP_MANIFEST.thickness), left.clone().addScaledVector(n, -LOOP_MANIFEST.thickness));
  }
  const quad = (a: number, b: number, c: number, d: number) => faces.push(a, b, c, a, c, d);
  for (let i = 0; i < LOOP_MANIFEST.samples.length - 1; i++) {
    const a = i * 4, b = a + 4;
    quad(a + 3, b + 3, b + 2, a + 2);
    quad(a, b, b + 3, a + 3);
    quad(a + 1, a + 2, b + 2, b + 1);
  }
  quad(0, 3, 2, 1);
  const end = shell.length - 4;
  quad(end, end + 1, end + 2, end + 3);
  mesh(shell, faces, steel);
  for (const side of [-1, 1]) {
    const q = quads(() => 0.026, s => side * (s.width / 2 - 0.045), 0.003);
    mesh(q.vertices, q.faces, edge);
  }
  for (const beam of LOOP_MANIFEST.beams) {
    const a = vec(beam.a), b = vec(beam.b), axis = b.clone().sub(a).normalize(), ref = Math.abs(axis.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = axis.clone().cross(ref).normalize(), v = axis.clone().cross(u).normalize(), vertices: THREE.Vector3[] = [], indices: number[] = [];
    for (const point of [a, b])
      for (let i = 0; i < 4; i++)
        vertices.push(point.clone().addScaledVector(u, beam.radius * Math.cos(i * Math.PI / 2)).addScaledVector(v, beam.radius * Math.sin(i * Math.PI / 2)));
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      indices.push(i, j, j + 4, i, j + 4, i + 4);
    }
    indices.push(3, 2, 1, 3, 1, 0, 4, 5, 6, 4, 6, 7);
    mesh(vertices, indices, steel);
  }
  for (const i of [12, 64, 116, 180, 240, 292]) {
    const s = LOOP_MANIFEST.samples[i], p = vec(s.position).addScaledVector(vec(s.normal), 0.009), t = vec(s.tangent), l = vec(s.lateral);
    const vertices = [p.clone().addScaledVector(t, 0.15), p.clone().addScaledVector(t, -0.08).addScaledVector(l, 0.12), p.clone().addScaledVector(t, -0.03), p.clone().addScaledVector(t, -0.08).addScaledVector(l, -0.12)];
    mesh(vertices, [0, 2, 1, 0, 3, 2], paint);
  }
  for (const child of group.children)
    child.position.x += LOOP_OFFSET;
  surfaces.register(steel, { profile: 'bump', temporary: true });
  return group;
}
