import * as THREE from 'three';
import type { Track } from '../core/types';
import type { WeatherSurfaces } from '../weather-surfaces';
import { WORLD_SCALE as SCALE, LANE_WIDTH as LANE } from '../world-space';
import { box, mat, black, white } from './scene-geometry';
import { isLoop } from '../core/loop-geometry';
import { buildLoopModel } from './loop-model';

export interface CoursePiece {
  group: THREE.Group;
  base: number;
  bounds: THREE.Box3;
}

/** Preserve construction order and retain explicit ownership of track resources. */
export function buildCourse(
  track: Track,
  course: THREE.Group,
  dirt: THREE.MeshStandardMaterial,
  surfaces: WeatherSurfaces,
  disposables: (THREE.BufferGeometry | THREE.Material)[],
): CoursePiece[] {
  const pieces: CoursePiece[] = [];
  const mud = surfaces.register(mat('#473e2a'), { profile: 'mud', temporary: true }),
    grass = surfaces.register(mat('#76805a'), { profile: 'grass', temporary: true }),
    cool = surfaces.register(mat('#8fc3ba', 0.45), { profile: 'cool', temporary: true }),
    bump = surfaces.register(mat('#cda574'), { profile: 'bump', temporary: true });
  disposables.push(mud, grass, cool, bump);
  for (const s of track.segments) {
    if (s.piece === 'flat') continue;
    if(isLoop(s)) {
      const group=buildLoopModel(dirt,surfaces,disposables),bounds=new THREE.Box3().setFromObject(group);
      group.position.x=s.x*SCALE; course.add(group); pieces.push({group,base:s.x*SCALE,bounds});continue;
    }
    const group = new THREE.Group(),
      length = s.length * SCALE,
      hasHeight = s.profile.some((p) => p[1] > 0);
    for (let lane = 0; lane < 4; lane++) {
      if (!(s.lanes & (1 << lane))) continue;
      const z = (lane - 1.5) * LANE;
      if (hasHeight) {
        const shape = new THREE.Shape();
        shape.moveTo(0, -0.02);
        for (const [t, h] of s.profile) shape.lineTo(t * length, h * SCALE);
        shape.lineTo(length, -0.02);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: LANE - 0.012,
          bevelEnabled: false,
          steps: 1,
        });
        geo.computeVertexNormals();
        disposables.push(geo);
        const mesh = new THREE.Mesh(geo, s.surface === 'bump' ? bump : dirt);
        mesh.position.z = z - LANE / 2;
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        group.add(mesh);
        const pts = s.profile.map(
          ([t, h]) => new THREE.Vector3(t * length, h * SCALE + 0.015, z - LANE / 2 + 0.03),
        );
        const lg = new THREE.BufferGeometry().setFromPoints(pts);
        disposables.push(lg);
        const lm = new THREE.LineBasicMaterial({
          color: '#f5d9ad',
          transparent: true,
          opacity: 0.7,
        });
        disposables.push(lm);
        group.add(new THREE.Line(lg, lm));
      } else if (s.surface !== 'dirt') {
        box(
          group,
          length / 2,
          0.012,
          z,
          length,
          0.028,
          LANE - 0.04,
          s.surface === 'mud' ? mud : s.surface === 'cool' ? cool : grass,
        );
        if (s.surface === 'cool')
          for (let j = 0; j < 3; j++)
            box(group, length * (0.25 + j * 0.22), 0.035, z, 0.05, 0.01, 0.64, white, 0.2);
        if (s.surface === 'grass')
          for (let j = 0; j < Math.min(10, Math.floor(length * 2)); j++)
            box(group, j * 0.45 + 0.1, 0.07, z + Math.sin(j) * 0.35, 0.035, 0.13, 0.04, grass);
      }
    }
    const bounds = new THREE.Box3().setFromObject(group);
    group.position.x = s.x * SCALE;
    course.add(group);
    pieces.push({ group, base: s.x * SCALE, bounds });
  }
  // Start and finish share a line, offset to the same logical origin as the timing system.
  const gate = new THREE.Group();
  for (const z of [-2.85, 2.85]) {
    box(gate, 0, 1.9, z, 0.14, 3.8, 0.15, white);
    box(gate, 0, 0.65, z, 0.22, 1.3, 0.23, black);
  }
  box(gate, 0, 3.7, 0, 0.26, 0.58, 5.95, black);
  for (let i = 0; i < 14; i++)
    for (let j = 0; j < 2; j++)
      box(
        gate,
        0.14,
        3.51 + j * 0.19,
        -2.66 + i * 0.4,
        0.018,
        0.18,
        0.38,
        (i + j) % 2 ? black : white,
      );
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 2; j++)
      box(
        gate,
        -0.1 + j * 0.22,
        0.022,
        -2.2 + i * 0.49,
        0.22,
        0.025,
        0.49,
        (i + j) % 2 ? black : white,
      );
  course.add(gate);
  pieces.push({
    group: gate,
    base: 80 * SCALE,
    bounds: new THREE.Box3().setFromObject(gate),
  });
  return pieces;
}
