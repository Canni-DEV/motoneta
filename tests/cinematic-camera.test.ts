import { describe, expect, it } from 'vitest';
import { Box3, Group, Mesh, InstancedMesh, Line, LineSegments, BufferGeometry, LineBasicMaterial, BoxGeometry, MeshBasicMaterial, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { CinematicCamera, CINEMATIC_MODES, cinematicModeForKey } from '../src/cinematic-camera';
import { CinematicCourse } from '../src/cinematic-course';
import type { CinematicTimeline } from '../src/cinematic-timeline';
import { LOOP_SAMPLES } from '../src/core/loop-geometry';
import { WORLD_SCALE } from '../src/world-space';
import { placedPiece, testRace, testTrack } from './race-fixture';

const timeline = (): CinematicTimeline => ({ events: [], moments: [], poses: [], lapEnds: [10000], slowMotion: [], lastFrame: 10000 });
const live = () => {
  const race = testRace(testTrack({ length: 4096 }));
  race.phase = 'racing'; race.countdown = 0; race.frame = 181;
  return race;
};
const pose = { x: 10, y: 0, z: 0 };
const view = { position: new Vector3(10.2, 1.4, 0), quaternion: new Quaternion() };

describe('cinematic selection and composition', () => {
  it('maps only the nine digit and numpad keys', () => {
    for (const mode of CINEMATIC_MODES) {
      expect(cinematicModeForKey(`Digit${mode.key}`)).toBe(mode.id);
      expect(cinematicModeForKey(`Numpad${mode.key}`)).toBe(mode.id);
    }
    for (const code of ['Digit0', 'Numpad0', 'KeyC', 'Digit10', '2']) expect(cinematicModeForKey(code)).toBeUndefined();
  });
  it('changes every view without mutating the replay simulation', () => {
    const race = live(), before = structuredClone(race), camera = new CinematicCamera(timeline());
    for (const mode of CINEMATIC_MODES) {
      camera.setMode(mode.id);
      camera.update(race, pose, 0.016, 16 / 9, false, null, view);
      expect(race).toEqual(before);
    }
  });
  it('holds every manual mode through events and drone quotas; repeat selection is a no-op', () => {
    for (const { id } of CINEMATIC_MODES.slice(1)) {
      const race = live(), camera = new CinematicCamera(timeline());
      camera.timeline.moments = [{ type: 'crash', lap: 0, start: 200, peak: 240, end: 400, score: 5 }];
      camera.setMode(id);
      for (let i = 0; i < 400; i++) {
        race.frame++; camera.update(race, pose, 0.1, 16 / 9, false, 0, view);
      }
      expect(camera.selectedMode).toBe(id);
      expect(camera.currentShot).toBe(id);
      const cuts = camera.cuts.length;
      camera.setMode(id); camera.update(race, pose, 0.1, 16 / 9, false, 0, view);
      expect(camera.cuts).toHaveLength(cuts);
      camera.setMode('mix'); camera.update(race, pose, 0.016, 16 / 9, false, 0, view);
      expect(camera.selectedMode).toBe('mix');
      expect(camera.currentShot).not.toBe('opening');
    }
  });
  it('uses opening only in countdown and selects a manual view immediately', () => {
    const race = testRace(), camera = new CinematicCamera(timeline());
    camera.update(race, pose, 0.016, 1, false, null, view);
    expect(camera.currentShot).toBe('opening');
    camera.setMode('firstPerson'); camera.update(race, pose, 0.016, 1, false, null, view);
    expect(camera.currentShot).toBe('firstPerson');
    camera.setMode('mix'); camera.update(race, pose, 0.016, 1, false, null, view);
    expect(camera.currentShot).toBe('opening');
  });
  it('reanchors fixed views after passing and logs cuts of the same type', () => {
    for (const mode of ['tripod', 'crowd'] as const) {
      const race = live(), camera = new CinematicCamera(timeline());
      camera.setMode(mode); camera.update(race, pose, 0.016, 1, false, null);
      const anchor = camera.camera.position.clone();
      camera.update(race, { ...pose, x: anchor.x + 2 }, 0.016, 1, false, null);
      expect(camera.camera.position.x).toBeGreaterThan(anchor.x);
      expect(camera.cuts.map(c => c.shot)).toEqual([mode, mode]);
      expect(camera.cuts[1].reason).toBe('reencuadre');
    }
  });
  it('follows eye position, smooths rotations across 180°, freezes pause and stabilizes reduced motion', () => {
    const race = live(), camera = new CinematicCamera(timeline());
    const eyes = { position: view.position.clone(), quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 179 * Math.PI / 180) };
    camera.setMode('firstPerson'); camera.update(race, pose, 0.016, 1, false, null, eyes);
    const initial = camera.camera.quaternion.clone();
    eyes.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -179 * Math.PI / 180);
    eyes.position.x += 1;
    camera.update(race, pose, 0.016, 2, false, null, eyes);
    expect(initial.angleTo(camera.camera.quaternion)).toBeLessThan(2 * Math.PI / 180);
    expect(camera.camera.position.equals(eyes.position)).toBe(true);
    expect(camera.camera.near).toBe(0.02); expect(camera.camera.fov).toBe(68);
    const frozen = camera.camera.quaternion.clone();
    camera.update(race, pose, 0.016, 1, true, null, eyes);
    expect(camera.camera.quaternion.equals(frozen)).toBe(true);
    camera.update(race, pose, 0.016, 1, false, null, eyes, true);
    const direction = camera.camera.getWorldDirection(new Vector3());
    expect(direction.x).toBeGreaterThan(0.98); expect(Math.abs(direction.z)).toBeLessThan(1e-6);
    expect(direction.y).toBeLessThan(0);
  });
  it('includes first person in the automatic rotation without requesting a subject in frame', () => {
    const race = live(), camera = new CinematicCamera(timeline());
    for (let i = 0; i < 3000; i++) {
      race.frame++; camera.update(race, pose, 0.05, 16 / 9, false, 0, view);
    }
    expect(camera.cuts.some(c => c.shot === 'firstPerson')).toBe(true);
  });
});

describe('occlusion stability and repeated track pieces', () => {
  it('keeps manual views and fixed anchors stable when the loop hides the rider', () => {
    const origin = 512, track = testTrack({ length: 4096, items: [placedPiece('T', origin)] });
    const sample = LOOP_SAMPLES.reduce((highest, s) => s.position[1] > highest.position[1] ? s : highest);
    const point = new Vector3((origin + sample.position[0]) * WORLD_SCALE, sample.position[1] * WORLD_SCALE,
      sample.position[2] * WORLD_SCALE);
    const race = testRace(track);
    race.phase = 'racing'; race.countdown = 0;
    race.riders[0].motion = { kind: 'loop', origin, distance: sample.distance, age: 0, vx: 0, vy: 0, vlane: 0 };
    for (const mode of ['chase', 'front', 'ground', 'drone', 'mounted', 'tripod', 'crowd'] as const) {
      const camera = new CinematicCamera(timeline());
      const subject = { x: point.x, y: point.y, z: point.z };
      camera.setMode(mode); camera.update(race, subject, 0.016, 1, false, null);
      const position = camera.camera.position.clone();
      // A hidden rider must not push the camera outward, lift it or repeatedly cut fixed views.
      expect(Math.abs(position.z)).toBeLessThanOrEqual(8.5);
      if (mode === 'ground') expect(position.y).toBeCloseTo(1.2);
      for (let frame = 0; frame < 400; frame++) {
        race.frame++;
        camera.update(race, subject, 0.016, 1, false, null);
        expect(camera.camera.position.distanceTo(position)).toBeLessThan(1e-8);
        expect(camera.currentShot).toBe(mode);
      }
      expect(camera.cuts).toHaveLength(1);
    }
  });
  it('shares geometry in bounded copies, reuses the pool and removes only copies on clear', () => {
    const course = new Group(), group = new Group();
    const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
    group.add(new Mesh(geometry, material)); course.add(group);
    const pieces = [{ group, base: 0, bounds: new Box3(new Vector3(-1, 0, -1), new Vector3(1, 2, 1)) }];
    const pool = new CinematicCourse(), camera = new PerspectiveCamera(68, 1, 0.02, 50);
    camera.position.set(19, 1, 0); camera.lookAt(50, 1, 0);
    const shadows = new Box3(new Vector3(10, 0, -3), new Vector3(40, 3, 3));
    pool.update(pieces, camera, 19, 20, shadows);
    expect(course.children.length).toBeGreaterThan(1);
    expect(course.children.length).toBeLessThanOrEqual(7);
    for (const copy of course.children) expect((copy.children[0] as Mesh).geometry).toBe(geometry);
    const count = course.children.length;
    pool.update(pieces, camera, 19, 20, shadows); expect(course.children).toHaveLength(count);
    pool.hide(); expect(course.children).toEqual([group]);
    pool.clear(); expect(course.children).toEqual([group]);
    geometry.dispose(); material.dispose();
  });
  it('batches repeated boxes in lap copies and disposes their instance buffers', () => {
    const course = new Group(), group = new Group();
    const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
    const duplicateGeometry = geometry.clone();
    const lineGeometries: BufferGeometry[] = [], lineMaterials: LineBasicMaterial[] = [];
    for (let i = 0; i < 4; i++) {
      const box = new Mesh(i % 2 ? duplicateGeometry : geometry, material);
      box.position.y = i;
      group.add(box);
      const contour = new BufferGeometry().setFromPoints([new Vector3(0, 0, i), new Vector3(1, 1, i), new Vector3(2, 0, i)]);
      const lineMaterial = new LineBasicMaterial({ color: 'white', transparent: true, opacity: 0.7 });
      group.add(new Line(contour, lineMaterial)); lineGeometries.push(contour); lineMaterials.push(lineMaterial);
    }
    course.add(group);
    const pool = new CinematicCourse(), camera = new PerspectiveCamera(68, 1, 0.02, 50);
    camera.position.set(19, 1, 0); camera.lookAt(50, 1, 0);
    pool.update([{ group, base: 0, bounds: new Box3(new Vector3(-1, 0, -1), new Vector3(1, 4, 1)) }], camera, 19, 20,
      new Box3(new Vector3(10, 0, -3), new Vector3(40, 4, 3)));
    const instance = course.children.find(c => c !== group)!.children[0] as InstancedMesh;
    expect(instance).toBeInstanceOf(InstancedMesh);
    expect(instance.count).toBe(4); expect(instance.geometry).toBe(geometry); expect(instance.material).toBe(material);
    expect(group.children).toHaveLength(8);
    const border = course.children.find(c => c !== group)!.children.find(c => c instanceof LineSegments) as LineSegments;
    expect(border.geometry.getAttribute('position').count).toBe(16);
    const otherCopy = course.children.find(c => c !== group && c.children.includes(border) === false)!;
    expect(otherCopy.children.find(c => c instanceof LineSegments)!.geometry).toBe(border.geometry);
    let lineDisposed = false;
    border.geometry.addEventListener('dispose', () => { lineDisposed = true; });
    let disposed = false;
    instance.addEventListener('dispose', () => { disposed = true; });
    pool.clear(); expect(disposed).toBe(true); expect(lineDisposed).toBe(true);
    geometry.dispose(); duplicateGeometry.dispose(); material.dispose();
    lineGeometries.forEach(g => g.dispose()); lineMaterials.forEach(m => m.dispose());
  });
});
