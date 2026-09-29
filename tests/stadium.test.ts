import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { placedPiece } from '../src/core/maps';
import { fingerprint } from '../src/core/simulation';
import { getTrack } from '../src/core/tracks';
import { HZ } from '../src/core/types';
import { createCrowdAssetLoader } from '../src/crowd-assets';
import { visibleSectorRange } from '../src/stadium';
import { sectorSeats, stadiumLayout, StadiumMotion } from '../src/stadium-layout';
import { testRace, testTrack } from './race-fixture';

const empty = () => testTrack({ name: 'Short', laps: 9 });
const read = async (name: string) => {
  const buffer = await readFile(new URL(`../public/models/crowd/${name}`, import.meta.url));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
};

describe('stable stadium layout', () => {
  it('closes each loop exactly, with identical people on later and negative laps', () => {
    for (const track of [empty(), getTrack(0), getTrack(4)]) {
      const layout = stadiumLayout(track);
      expect(layout.count * layout.width).toBeCloseTo(track.length * 0.052, 10);
      const first = sectorSeats(layout, 0);
      expect(sectorSeats(layout, layout.count)).toEqual(first);
      expect(sectorSeats(layout, -layout.count)).toEqual(first);
      expect(first.every((s) => s.x > 0.7 && s.x < layout.width - 0.7)).toBe(true);
      expect(new Set(first.map((s) => s.z)).size).toBe(10);
      const filled = first.filter((s) => s.occupied);
      expect(filled.length / first.length).toBeGreaterThan(0.85);
      expect(filled.length / first.length).toBeLessThan(0.98);
      expect(filled.some((s) => s.standing)).toBe(true);
      expect(filled.some((s) => !s.standing)).toBe(true);
    }
  });
  it('distinguishes custom tracks sharing the same id', () => {
    const a = empty(),
      b = testTrack({ name: 'Other', laps: 9, length: 704, items: [placedPiece('C', 320)] });
    expect(a.id).toBe(b.id);
    expect(stadiumLayout(a).seed).not.toBe(stadiumLayout(b).seed);
  });
  it('covers every intersecting sector, including distant scenery and ultrawide short loops', () => {
    for (const aspect of [0.462, 1.6, 4])
      for (const focus of [-40, 0, 15, 500]) {
        const camera = new THREE.OrthographicCamera(-10 * aspect, 10 * aspect, 10, -10, 0.1, 180);
        camera.position.set(focus - 1, 11.5, 20);
        camera.lookAt(focus + 5, 0.65, 0);
        camera.updateMatrixWorld();
        const frustum = new THREE.Frustum().setFromProjectionMatrix(
          new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
        );
        const { width } = stadiumLayout(empty()),
          range = visibleSectorRange(camera, width);
        for (let i = -20; i < 80; i++) {
          const box = new THREE.Box3(
            new THREE.Vector3(i * width - 14, -0.8, -62),
            new THREE.Vector3((i + 1) * width + 14, 15, 4.6),
          );
          if (frustum.intersectsBox(box)) {
            expect(i).toBeGreaterThanOrEqual(range.first);
            expect(i).toBeLessThanOrEqual(range.last);
          }
        }
      }
  });
});

describe('visual reactions', () => {
  it('reacts once per large flight, observes cooldown and never mutates the race', () => {
    const race = testRace(empty(), 0),
      motion = new StadiumMotion(stadiumLayout(race.track));
    race.phase = 'racing';
    race.riders[0].grounded = false;
    race.riders[0].height = 20;
    race.frame = 100;
    const before = fingerprint(race);
    motion.step(race);
    expect(fingerprint(race)).toBe(before);
    expect(motion.reactions.size).toBeGreaterThan(0);
    const first = [...motion.reactions.values()][0].time;
    race.frame = 150;
    motion.step(race);
    expect([...motion.reactions.values()][0].time).toBe(first);
    race.riders[0].grounded = true;
    race.frame = 155;
    motion.step(race);
    race.riders[0].grounded = false;
    race.frame = 160;
    motion.step(race);
    expect([...motion.reactions.values()][0].time).toBe(first);
    race.riders[0].grounded = true;
    race.frame = 290;
    motion.step(race);
    race.riders[0].grounded = false;
    race.frame = 300;
    motion.step(race);
    expect([...motion.reactions.values()][0].time).toBeCloseTo(300 / HZ);
  });
  it('preserves events across simulation steps, repeats deterministically, clears on restart', () => {
    const race = testRace(empty(), 0);
    const a = new StadiumMotion(stadiumLayout(race.track)),
      b = new StadiumMotion(stadiumLayout(race.track));
    for (let frame = 1; frame <= 600; frame++) {
      race.frame = frame;
      race.events = frame === 200 ? [{ type: 'lap', rider: 0, frame }] : [];
      if (frame === 600) {
        race.phase = 'finished';
        race.events = [{ type: 'finish', rider: 0, frame }];
      }
      a.step(race);
      b.step(race);
      if (frame === 201) expect(a.reactions.size).toBeGreaterThan(0);
    }
    expect(a).toEqual(b);
    expect(a.finished).toBe(true);
    expect(a.reactions.size).toBeGreaterThan(0);
    a.reset();
    expect(a.time).toBe(0);
    expect(a.reactions.size).toBe(0);
    expect(a.finished).toBe(false);
  });
});

describe('real crowd assets', () => {
  it('loads concurrently, retains successful files on retry and shares loaded resources', async () => {
    const requests: string[] = [];
    let fail = true;
    const loader = createCrowdAssetLoader(async (name) => {
      requests.push(name);
      if (name === 'low.json' && fail) throw Error('offline');
      return read(name);
    });
    const first = loader();
    expect(loader()).toBe(first);
    await expect(first).rejects.toThrow('offline');
    fail = false;
    const assets = await loader();
    expect(await loader()).toBe(assets);
    expect(requests.filter((n) => n === 'high.json')).toHaveLength(1);
    expect(requests.filter((n) => n === 'low.json')).toHaveLength(2);
    expect(assets.geometry.low[0].index!.count).toBeLessThan(assets.geometry.high[0].index!.count);
    expect(assets.animation.image.width).toBe(40);
    expect(assets.animation.image.height).toBe(192);
    const data = assets.animation.image.data as Float32Array;
    for (const posture of [0, 1]) {
      const gaps = [];
      for (let frame = 0; frame < 32; frame++) {
        const left = new THREE.Vector3(-0.225, 0.547, 0.04).applyMatrix4(
          new THREE.Matrix4().fromArray(data, ((posture * 96 + 32 + frame) * 10 + 3) * 16),
        );
        const right = new THREE.Vector3(0.225, 0.547, 0.04).applyMatrix4(
          new THREE.Matrix4().fromArray(data, ((posture * 96 + 32 + frame) * 10 + 5) * 16),
        );
        gaps.push(left.distanceTo(right));
        expect(left.x).toBeLessThan(0);
        expect(right.x).toBeGreaterThan(0);
      }
      expect(Math.min(...gaps)).toBeLessThan(0.065);
      expect(Math.max(...gaps)).toBeGreaterThan(0.16);
    }
    // Optimization contract: hips and legs really are stationary across all three clips.
    for (const posture of [0, 1])
      for (const joint of [0, 6, 7, 8, 9]) {
        const base = Array.from(
          data.slice((posture * 96 * 10 + joint) * 16, (posture * 96 * 10 + joint) * 16 + 16),
        );
        for (let frame = 0; frame < 96; frame++) {
          const start = ((posture * 96 + frame) * 10 + joint) * 16;
          expect(Array.from(data.slice(start, start + 16))).toEqual(base);
        }
      }
    const point = new THREE.Vector3(),
      matrix = new THREE.Matrix4();
    for (const geometries of Object.values(assets.geometry))
      for (const geometry of geometries) {
        const position = geometry.getAttribute('position'),
          joint = geometry.getAttribute('crowdJoint');
        for (let row = 0; row < 192; row++)
          for (let i = 0; i < position.count; i++) {
            matrix.fromArray(data, (row * 10 + joint.getX(i)) * 16);
            point.fromBufferAttribute(position, i).applyMatrix4(matrix);
            expect(Number.isFinite(point.length())).toBe(true);
            expect(point.y).toBeGreaterThan(-0.035);
            expect(point.y).toBeLessThan(1.9);
            expect(Math.abs(point.x)).toBeLessThan(0.5);
          }
      }
  });
  it('retries a corrupt animation without discarding good geometry downloads', async () => {
    let bad = true;
    const loader = createCrowdAssetLoader((name) =>
      name === 'animation.bin' && bad ? Promise.resolve(new ArrayBuffer(8)) : read(name),
    );
    await expect(loader()).rejects.toThrow('Animación');
    bad = false;
    await expect(loader()).resolves.toHaveProperty('animation');
  });
});
