import { beforeAll, describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, SkinnedMesh, Vector3 } from 'three';
import {
  Bike,
  createBikeAssetLoader,
  solveTwoBone,
  type BikeAssets,
  type BikeVisualState,
} from '../src/bike-model';
import { modelAssets } from './model-fixture';

let assets: BikeAssets;
beforeAll(async () => {
  assets = await modelAssets();
});
const state = (overrides: Partial<BikeVisualState> = {}): BikeVisualState => ({
  time: 0,
  paused: false,
  speed: 2,
  tilt: 0,
  grounded: true,
  recovery: false,
  ground: () => 0,
  ...overrides,
});
const meshes = (root: Group) => {
  const result: Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof Mesh) result.push(o);
  });
  return result;
};
const snapshot = (bike: Bike) => {
  bike.root.updateMatrixWorld(true);
  const result: number[] = [];
  bike.body.traverse((o) => result.push(...o.matrix.elements));
  bike.riderLayer.traverse((o) => result.push(...o.matrix.elements));
  return result;
};

describe('exported model resources and lifecycle', () => {
  it.each([
    ['high', 30000],
    ['low', 8000],
  ] as const)('%s stays within its triangle budget', (quality, limit) => {
    let triangles = 0;
    for (const mesh of meshes(assets[quality])) {
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
      expect(mesh.geometry.attributes.color).toBeDefined();
    }
    expect(triangles).toBeGreaterThan(1000);
    expect(triangles).toBeLessThanOrEqual(limit);
    expect(meshes(assets[quality]).some((m) => m instanceof SkinnedMesh)).toBe(true);
  });

  it('shares geometry, isolates skeletons and team colors, and retains neutral materials', () => {
    const a = new Bike(0xff0000, assets),
      b = new Bike(0x0000ff, assets);
    const ma = [...meshes(a.variants.high), ...meshes(a.rider)],
      mb = [...meshes(b.variants.high), ...meshes(b.rider)];
    ma.forEach((m, i) => expect(m.geometry).toBe(mb[i].geometry));
    const sa = ma.find((m) => m instanceof SkinnedMesh) as SkinnedMesh;
    const sb = mb.find((m) => m instanceof SkinnedMesh) as SkinnedMesh;
    expect(sa.skeleton).not.toBe(sb.skeleton);
    expect(sa.skeleton.bones[0]).not.toBe(sb.skeleton.bones[0]);
    const materials = (list: Mesh[]) =>
      list.flatMap((m) =>
        Array.isArray(m.material) ? m.material : [m.material],
      ) as MeshStandardMaterial[];
    const ca = materials(ma).find((m) => m.name === 'TeamPaint')!;
    const cb = materials(mb).find((m) => m.name === 'TeamPaint')!;
    expect(ca).not.toBe(cb);
    expect(ca.color.getHex()).toBe(0xff0000);
    expect(cb.color.getHex()).toBe(0x0000ff);
    expect(materials(ma).find((m) => m.name === 'Alloy')).toBe(
      materials(mb).find((m) => m.name === 'Alloy'),
    );
    const before = snapshot(b);
    a.update(state({ tilt: 0.8, grounded: false }));
    expect(snapshot(b)).toEqual(before);
    a.dispose();
    b.dispose();
  });

  it('coalesces simultaneous loads and retries only the failed resource', async () => {
    const calls = { high: 0, low: 0 };
    const load = createBikeAssetLoader(async (quality) => {
      calls[quality]++;
      if (quality === 'low' && calls.low === 1) throw new Error('network');
      return assets[quality];
    });
    const failures = await Promise.allSettled([load(), load()]);
    expect(failures.every((r) => r.status === 'rejected')).toBe(true);
    const [a, b] = await Promise.all([load(), load()]);
    expect(calls).toEqual({ high: 1, low: 2 });
    expect(a.high).toBe(b.high);
    expect(a.low).toBe(b.low);
  });

  it('rejects incomplete assets before a race can use them', async () => {
    const load = createBikeAssetLoader(async () => new Group());
    await expect(load()).rejects.toThrow('Modelo incompleto');
  });
});

describe('visual animation', () => {
  it.each(['high', 'low'] as const)('%s steers the bars, forks, wheel and rider toward a lane', (quality) => {
    const bike = new Bike(0xc91c32, assets, quality);
    for (let i = 0; i < 16; i++) bike.update(state({ time: i / 60, laneMotion: 1 }));
    const bar = bike.variants[quality].getObjectByName('Handlebar')!;
    const fork = bike.variants[quality].getObjectByName('ForkLowerL')!;
    expect(bar.rotation.y).toBeLessThan(-0.15);
    expect(bike.wheels[1].rotation.y).toBeCloseTo(bar.rotation.y, 5);
    expect(fork.position.z).toBeGreaterThan(0.089);
    expect(bike.body.rotation.x).toBeGreaterThan(0.09);
    const grip = bike.rider.getObjectByName('HandL')!.getWorldPosition(new Vector3());
    const barGrip = bike.body.localToWorld(new Vector3(0.35, 0.91 - bike.compression, 0.222)
      .sub(new Vector3(0.324, 0.89 - bike.compression, 0))
      .applyAxisAngle(new Vector3(0, 1, 0), bar.rotation.y)
      .add(new Vector3(0.324, 0.89 - bike.compression, 0)));
    expect(grip.distanceTo(barGrip)).toBeLessThan(1e-4);
    for (let i = 16; i < 46; i++) bike.update(state({ time: i / 60, laneMotion: 0 }));
    expect(Math.abs(bar.rotation.y)).toBeLessThan(0.01);
    for (let i = 46; i < 62; i++) bike.update(state({ time: i / 60, laneMotion: -1 }));
    expect(bar.rotation.y).toBeGreaterThan(0.15);
    expect(bike.body.rotation.x).toBeLessThan(-0.09);
    bike.dispose();
  });
  it('separates the rider and motorcycle during a crash, then returns both to riding pose', () => {
    const bike = new Bike(0xc91c32, assets);
    bike.update(state({ crashPhase: 'rolling', crashPhaseAge: 24, crashRollDuration: 40,
      crashKind: 'backflip', crashStartTilt: 1.4, lane: 0 }));
    expect(bike.riderLayer.position.distanceTo(bike.body.position)).toBeGreaterThan(0.4);
    const hand = bike.rider.getObjectByName('HandL')!.getWorldPosition(new Vector3());
    const grip = bike.body.localToWorld(new Vector3(0.35, 0.91, 0.222));
    expect(hand.distanceTo(grip)).toBeGreaterThan(0.2);
    const rolling = snapshot(bike);
    bike.update(state({ time: 1 / 60, crashPhase: 'down', crashPhaseAge: 12, lane: 0 }));
    expect(snapshot(bike)).not.toEqual(rolling);
    bike.update(state({ time: 2 / 60, crashPhase: 'mounting', crashPhaseAge: 22, lane: 0 }));
    bike.update(state({ time: 3 / 60 }));
    expect(bike.riderLayer.position.distanceTo(bike.body.position)).toBeLessThan(1e-6);
    bike.dispose();
  });
  it.each(['high', 'low'] as const)('%s keeps the fallen rider on flat ground and ramps', (quality) => {
    const bike = new Bike(0xc91c32, assets, quality);
    const riderMeshes = meshes(bike.rider).filter((mesh): mesh is SkinnedMesh => mesh instanceof SkinnedMesh);
    const profiles = [
      () => 0,
      (x: number) => x * 0.3,
      (x: number) => x < 0 ? 0 : x < 1 ? x * 0.65 : 0.65,
    ];
    for (const ground of profiles) {
      for (const [crashPhase, crashPhaseAge] of [
        ['rolling', 10], ['rolling', 24], ['rolling', 40],
        ['down', 0], ['down', 24], ['mounting', 0],
        ['mounting', 4], ['mounting', 8], ['mounting', 12],
      ] as const) {
        bike.update(state({ recovery: true, crashPhase, crashPhaseAge,
          crashRollDuration: 40, lane: 2, ground }));
        bike.root.updateMatrixWorld(true);
        let lowest = Infinity;
        for (const rider of riderMeshes) {
          const vertices = rider.geometry.attributes.position;
          for (let i = 0; i < vertices.count; i++) {
            const vertex = rider.applyBoneTransform(i, new Vector3().fromBufferAttribute(vertices, i));
            rider.localToWorld(vertex);
            lowest = Math.min(lowest, vertex.y - ground(vertex.x));
          }
        }
        expect(lowest).toBeGreaterThan(-0.02);
        expect(lowest).toBeLessThan(0.09);
      }
    }
    bike.dispose();
  });
  it('joins crash phases without a rider jump and preserves the pose across quality changes', () => {
    const bike = new Bike(0xc91c32, assets);
    const crashed = (crashPhase: BikeVisualState['crashPhase'], crashPhaseAge: number) =>
      state({ recovery: true, crashPhase, crashPhaseAge, crashRollDuration: 40,
        crashKind: 'impact', lane: 0, ground: (x) => Math.max(0, x) * 0.3 });
    const head = () => bike.rider.getObjectByName('Head')!.getWorldPosition(new Vector3());
    bike.update(crashed('rolling', 40));
    const rollingPosition = bike.riderLayer.position.clone();
    const rollingHead = head();
    bike.update(crashed('down', 0));
    expect(bike.riderLayer.position.distanceTo(rollingPosition)).toBeLessThan(0.001);
    expect(head().distanceTo(rollingHead)).toBeLessThan(0.001);
    bike.setQuality('low');
    expect(bike.riderLayer.position.distanceTo(rollingPosition)).toBeLessThan(0.001);
    expect(head().distanceTo(rollingHead)).toBeLessThan(0.001);
    bike.update(crashed('mounting', 21));
    const seatedPosition = bike.riderLayer.position.clone();
    const seatedHead = head();
    bike.update(state({ ground: (x) => Math.max(0, x) * 0.3 }));
    expect(bike.riderLayer.position.distanceTo(seatedPosition)).toBeLessThan(0.05);
    expect(head().distanceTo(seatedHead)).toBeLessThan(0.05);
    bike.dispose();
  });
  it('derives the fallen rider pose from the crash frame rather than render history', () => {
    const first = new Bike(0xc91c32, assets),
      second = new Bike(0xc91c32, assets);
    const falling = state({ time: 2, recovery: true, crashPhase: 'down',
      crashPhaseAge: 24, lane: 3, ground: (x) => Math.max(0, x) * 0.25 });
    first.update(falling);
    for (let i = 0; i < 80; i++) second.update(state({ time: i / 60,
      speed: i % 4, tilt: Math.sin(i / 10), laneMotion: i % 2 ? 1 : -1 }));
    second.update(falling);
    first.root.updateMatrixWorld(true);
    second.root.updateMatrixWorld(true);
    expect(second.riderLayer.position.distanceTo(first.riderLayer.position)).toBeLessThan(1e-6);
    expect(second.riderLayer.rotation.toArray()).toEqual(first.riderLayer.rotation.toArray());
    for (const name of ['Head', 'HandL', 'HandR', 'FootL', 'FootR']) {
      const a = first.rider.getObjectByName(name)!.getWorldPosition(new Vector3());
      const b = second.rider.getObjectByName(name)!.getWorldPosition(new Vector3());
      expect(b.distanceTo(a)).toBeLessThan(1e-6);
    }
    first.dispose();
    second.dispose();
  });
  it('keeps crash timing while reduced motion removes full spins and pause freezes the pose', () => {
    const bike = new Bike(0xc91c32, assets);
    const falling = state({ time: 0, recovery: true, crashPhase: 'rolling',
      crashPhaseAge: 20, crashRollDuration: 40, crashKind: 'impact', lane: 3,
      reducedMotion: true });
    bike.update(falling);
    expect(bike.body.rotation.z).toBe(0);
    expect(bike.riderLayer.position.distanceTo(bike.body.position)).toBeGreaterThan(0.3);
    const before = snapshot(bike);
    bike.update({ ...falling, time: 1, paused: true, crashPhaseAge: 40 });
    expect(snapshot(bike)).toEqual(before);
    bike.update({ ...falling, time: 1.01, crashPhaseAge: 40 });
    expect(snapshot(bike)).not.toEqual(before);
    bike.dispose();
  });
  it('freezes all transforms on pause and resumes without a wheel jump', () => {
    const bike = new Bike(0xc91c32, assets);
    for (let i = 0; i < 40; i++) bike.update(state({ time: i / 60 }));
    const before = snapshot(bike),
      angle = bike.wheelAngle;
    for (let i = 0; i < 60; i++) bike.update(state({ time: 1 + i / 60, paused: true }));
    expect(snapshot(bike)).toEqual(before);
    bike.update(state({ time: 2 }));
    expect(Math.abs(bike.wheelAngle - angle)).toBeLessThan(0.36);
  });

  it('resets wheel rotation, suspension and pose between races', () => {
    const bike = new Bike(0xc91c32, assets),
      fresh = new Bike(0xc91c32, assets);
    for (let i = 0; i < 80; i++) bike.update(state({ time: i / 60, grounded: i > 35, tilt: 0.7 }));
    bike.reset();
    expect(snapshot(bike)).toEqual(snapshot(fresh));
    expect(bike.wheelAngle).toBe(0);
    expect(bike.compression).toBe(0);
  });

  it.each(['high', 'low'] as const)(
    'keeps %s hands and boots on anchors in riding, flight, landing and recovery',
    (quality) => {
      const bike = new Bike(0xc91c32, assets, quality);
      for (let i = 0; i < 150; i++) {
        bike.update(
          state({
            time: i / 60,
            tilt: Math.sin(i / 20),
            grounded: i < 40 || i > 90,
            recovery: i > 130,
          }),
        );
        bike.root.updateMatrixWorld(true);
        for (const [side, suffix] of [
          [-1, 'R'],
          [1, 'L'],
        ] as const) {
          const hand = bike.body.worldToLocal(
            bike.rider
              .getObjectByName('Hand' + suffix)!
              .getWorldPosition(new Vector3()),
          );
          const foot = bike.body.worldToLocal(
            bike.rider
              .getObjectByName('Foot' + suffix)!
              .getWorldPosition(new Vector3()),
          );
          expect(
            hand.distanceTo(new Vector3(0.35, 0.91 - bike.compression, side * 0.222)),
          ).toBeLessThan(1e-5);
          expect(
            foot.distanceTo(new Vector3(-0.102, 0.418 - bike.compression, side * 0.21)),
          ).toBeLessThan(1e-5);
        }
      }
    },
  );

  it('compresses on landing without moving the wheel contact envelope', () => {
    const bike = new Bike(0xc91c32, assets);
    for (let i = 0; i < 60; i++) bike.update(state({ time: i / 60, grounded: false }));
    const extended = bike.compression;
    for (let i = 60; i < 67; i++) bike.update(state({ time: i / 60, grounded: true }));
    expect(bike.compression).toBeGreaterThan(extended + 0.02);
    expect(bike.compression).toBeLessThanOrEqual(0.055);
    bike.root.updateMatrixWorld(true);
    expect(bike.wheels[0].getWorldPosition(new Vector3()).y).toBeCloseTo(0.309, 6);
  });

  it('switches quality without resetting the animated pose', () => {
    const bike = new Bike(0xc91c32, assets);
    for (let i = 0; i < 20; i++) bike.update(state({ time: i / 60, tilt: 0.8 }));
    const angle = bike.wheelAngle,
      compression = bike.compression;
    bike.setQuality('low');
    expect(bike.variants.low.visible).toBe(true);
    expect(bike.variants.high.visible).toBe(false);
    expect(bike.wheelAngle).toBe(angle);
    expect(bike.compression).toBe(compression);
    expect(bike.wheels[0].rotation.z).toBe(angle);
  });

  it('handles singular IK poles and unreachable targets without nonfinite joints', () => {
    for (const end of [new Vector3(), new Vector3(0, 8, 0), new Vector3(0, 0.2, 0)]) {
      const joint = solveTwoBone(new Vector3(), end, 0.2, 0.3, new Vector3(0, 1, 0));
      expect(joint.toArray().every(Number.isFinite)).toBe(true);
      expect(joint.length()).toBeCloseTo(0.2, 6);
    }
  });
});
