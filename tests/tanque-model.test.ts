import { beforeAll, describe, expect, it } from 'vitest';
import { Box3, Color, DoubleSide, Mesh, MeshStandardMaterial, Object3D, Raycaster, SkinnedMesh, Vector3 } from 'three';
import { Bike, validateBikeAsset, type BikeAssets, type BikeVisualState } from '../src/bike-model';
import { BIKE_SLOTS, RIDER_SLOTS, VARIANTS, defaultVehicleAppearance } from '../src/appearance';
import { VEHICLE_VISUALS } from '../src/vehicle-visual';
import { modelAssets } from './model-fixture';
import manifest from '../assets/tanque/manifest.json';

let assets: BikeAssets;
beforeAll(async () => { assets = await modelAssets('tanque'); });
const state = (overrides: Partial<BikeVisualState> = {}): BikeVisualState => ({ time: 0, paused: false, speed: 2, tilt: 0, grounded: true, recovery: false, ground: () => 0, ...overrides });
function visibleMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    let node: Object3D | null = object;
    while (node && node !== root && node.visible) node = node.parent;
    if (node === root) meshes.push(object);
  });
  return meshes;
}
describe.each(['high', 'low'] as const)('Tanque %s visual contract', (quality) => {
  it('keeps the front center on the straight inclined reference profile', () => {
    assets[quality].updateMatrixWorld(true);
    const fairing = assets[quality].getObjectByName('Slot_fairing_core') as Mesh;
    const ray = new Raycaster();
    const direction = new Vector3(-1, 0, 0).transformDirection(fairing.matrixWorld);
    for (const y of [.81, .76, .71, .64, .57]) {
      ray.set(fairing.localToWorld(new Vector3(1, y, 0)), direction);
      const hits = ray.intersectObject(fairing, false);
      expect(hits.length).toBeGreaterThan(0);
      const front = fairing.worldToLocal(hits[0].point).x;
      const reference = .380 + (.835 - y) * (.695 - .380) / (.835 - .504);
      expect(Math.abs(front - reference)).toBeLessThan(.008);
    }
  });
  it('has one fixed bike, all rider variants, no textures and the expected geometry budget', () => {
    expect(validateBikeAsset(assets[quality], 'tanque')).toBe(assets[quality]);
    expect(() => validateBikeAsset(assets[quality], 'motoneta')).toThrow(/Modelo incompleto/);
    for (const slot of BIKE_SLOTS) {
      expect(assets[quality].getObjectByName(`Slot_${slot}_sprint`)).toBeUndefined();
      expect(assets[quality].getObjectByName(`Slot_${slot}_trail`)).toBeUndefined();
    }
    for (const slot of RIDER_SLOTS) for (const variant of VARIANTS) expect(assets[quality].getObjectByName(`Slot_${slot}_${variant}`)).toBeDefined();
    expect(manifest.assets[quality].trianglesSelectedMax).toBeLessThanOrEqual(quality === 'low' ? 8000 : 24000);
    expect(manifest.assets[quality].textures).toBe(0);
    expect(Object.keys(VEHICLE_VISUALS.tanque.rig)).toEqual(Object.keys(VEHICLE_VISUALS.motoneta.rig));
    for (const bone of ['HandL','HandR','FootL','FootR'] as const)
      expect(VEHICLE_VISUALS.tanque.rig[bone]).toEqual(VEHICLE_VISUALS.motoneta.rig[bone]);
    for (const axis of ['rearX','frontX','axleY'] as const)
      expect(VEHICLE_VISUALS.tanque.dimensions[axis]).toBe(VEHICLE_VISUALS.motoneta.dimensions[axis]);
  });
  it('recolors primary and accent globally while leaving upholstery, floor and wheels neutral', () => {
    const bike = new Bike(0xbfc6cf, assets, quality, 'tanque');
    const appearance = defaultVehicleAppearance('tanque');
    appearance.paints.fairing = { primary: '#e82143', accent: '#20dc83' }; appearance.parts.wheels = 'trail';
    bike.setAppearance(appearance);
    let primary = 0, accent = 0, neutral = 0;
    for (const mesh of visibleMeshes(bike.variants[quality]).filter((m) => m.name.startsWith('Slot_'))) {
      const base = (assets[quality].getObjectByName(mesh.name) as Mesh).geometry.attributes.color;
      const actual = mesh.geometry.attributes.color;
      for (let i = 0; i < base.count; i++) {
        const role = base.getW(i), color = new Color();
        if (role < .25) { color.set(appearance.paints.fairing.primary); primary++; }
        else if (role < .75) { color.set(appearance.paints.fairing.accent); accent++; }
        else { color.setRGB(base.getX(i), base.getY(i), base.getZ(i)); neutral++; }
        expect(actual.getX(i)).toBeCloseTo(color.r, 5); expect(actual.getY(i)).toBeCloseTo(color.g, 5); expect(actual.getZ(i)).toBeCloseTo(color.b, 5);
      }
      if (/Slot_(seat|wheels|exhaust)_/.test(mesh.name)) expect(Array.from({ length: base.count }, (_, i) => base.getW(i)).every((a) => a >= .75)).toBe(true);
    }
    expect(primary).toBeGreaterThan(0); expect(accent).toBeGreaterThan(0); expect(neutral).toBeGreaterThan(0);
    const handlebar = bike.variants[quality].getObjectByName('Handlebar')!;
    const materials = visibleMeshes(handlebar).flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
    expect(new Set(materials.map((material) => material.name)).size).toBeLessThanOrEqual(4);
    const lens = materials.find((material) => material.name === 'LampFront') as MeshStandardMaterial;
    expect(lens.transparent).toBe(true); expect(lens.opacity).toBeCloseTo(.32);
    bike.root.updateMatrixWorld(true);
    const ray = new Raycaster();
    ray.set(handlebar.localToWorld(new Vector3(.8 - .324, .960 - .94, .050)), new Vector3(-1, 0, 0));
    const lampHits = ray.intersectObjects(visibleMeshes(handlebar), false);
    expect((lampHits[0].object as Mesh).material).toBe(lens);
    bike.setLighting(1);
    expect(bike.headlight.intensity).toBeGreaterThan(0);
    expect(lens.emissiveIntensity).toBe(6);
    const reflector = materials.find((material) => material.name === 'LampReflector') as MeshStandardMaterial;
    expect(reflector.emissiveIntensity).toBe(6);
    bike.setLighting(0); expect(reflector.emissiveIntensity).toBe(0);
    expect((materials.find((material) => material.name === 'TeamPaint') as MeshStandardMaterial).color.getHexString()).toBe('e82143');
    const mechanical = visibleMeshes(handlebar).find((mesh) => (mesh.material as MeshStandardMaterial).name === 'MechanicalSurface')!;
    expect((mechanical.material as MeshStandardMaterial).color.getHexString()).toBe('ffffff');
    const neutralColors = Array.from(mechanical.geometry.attributes.color.array);
    const floor = bike.variants[quality].getObjectByName('Floorboard') as Mesh;
    expect((floor.material as MeshStandardMaterial).name).toBe('PlasticSurface');
    expect((floor.material as MeshStandardMaterial).roughness).toBeGreaterThan(.8);
    const floorColors = Array.from(floor.geometry.attributes.color.array);
    appearance.paints.fairing = { primary: '#225bda', accent: '#fb239a' }; bike.setAppearance(appearance);
    expect(Array.from(mechanical.geometry.attributes.color.array)).toEqual(neutralColors);
    expect(Array.from(floor.geometry.attributes.color.array)).toEqual(floorColors);
    const spring = bike.variants[quality].getObjectByName('Spring') as Mesh;
    expect((spring.material as MeshStandardMaterial).name).toBe('Alloy');
    bike.dispose();
  });
  it('maintains hand and seat contacts for every rider and clears slopes, crashes and recovery', () => {
    const bike = new Bike(0xbfc6cf, assets, quality, 'tanque'), appearance = defaultVehicleAppearance('tanque'), bounds = new Box3();
    const ray = new Raycaster();
    // The floor-to-leg-shield seam must stay closed through a landing impulse.
    const fairing = bike.variants[quality].getObjectByName('Slot_fairing_core')!;
    const floor = bike.variants[quality].getObjectByName('Floorboard')!;
    bike.update(state({ time: 0, grounded: false }));
    for (let frame = 1; frame <= 30; frame++) {
      bike.update(state({ time: frame / 60 })); bike.root.updateMatrixWorld(true);
      const joint = new Vector3(.267, .299, .224);
      expect(fairing.localToWorld(joint.clone()).distanceTo(floor.localToWorld(joint.clone()))).toBeLessThan(.0001);
    }
    for (const variant of VARIANTS) {
      for (const slot of RIDER_SLOTS) appearance.parts[slot] = variant;
      bike.setAppearance(appearance); bike.reset();
      for (let frame = 0; frame < 20; frame++) {
        bike.update(state({ time: frame / 60, laneMotion: frame < 10 ? 1 : -1 })); bike.root.updateMatrixWorld(true);
        const bar = bike.variants[quality].getObjectByName('Handlebar')!;
        for (const suffix of ['L', 'R'] as const) {
          const grip = new Vector3(...VEHICLE_VISUALS.tanque.rig[`Hand${suffix}`].head).sub(new Vector3(...VEHICLE_VISUALS.tanque.steering));
          bar.localToWorld(grip);
          expect(bike.rider.getObjectByName(`Hand${suffix}`)!.getWorldPosition(new Vector3()).distanceTo(grip)).toBeLessThan(.0001);
        }
      }
      bike.reset(); bike.root.updateMatrixWorld(true);
      const pants = bike.rider.getObjectByName(`Slot_pants_${variant}`) as SkinnedMesh;
      const seat = bike.variants[quality].getObjectByName('Slot_seat_core')!;
      const mat = pants.material as MeshStandardMaterial, previousSide = mat.side; mat.side = DoubleSide;
      for (const x of [-.27, -.23, -.19]) {
        ray.set(bike.body.localToWorld(new Vector3(x, 1.1, 0)), new Vector3(0, -1, 0));
        const cloth = ray.intersectObject(pants, false), saddle = ray.intersectObject(seat, false);
        expect(cloth.length).toBeGreaterThanOrEqual(2); expect(saddle.length).toBeGreaterThan(0);
        expect(cloth.at(-1)!.point.y - saddle[0].point.y).toBeGreaterThanOrEqual(-.005);
        expect(cloth.at(-1)!.point.y - saddle[0].point.y).toBeLessThan(.03);
      }
      mat.side = previousSide;
      for (const ground of [() => 0, (x: number) => x * .3]) for (const [crashPhase, crashPhaseAge] of [
        ['none', 0], ['rolling', 10], ['rolling', 24], ['down', 0], ['mounting', 0], ['mounting', 8], ['mounting', 15],
      ] as const) {
        bike.update(state({ recovery: crashPhase !== 'none', crashPhase, crashPhaseAge, crashRollDuration: 40, ground }));
        bike.root.updateMatrixWorld(true); bike.getVisualBounds(bounds);
        let lowest = Infinity;
        for (const mesh of [...visibleMeshes(bike.variants[quality]), ...visibleMeshes(bike.rider)]) for (let i = 0; i < mesh.geometry.attributes.position.count; i += 4) {
          const point = mesh.getVertexPosition(i, new Vector3()).applyMatrix4(mesh.matrixWorld);
          lowest = Math.min(lowest, point.y - ground(point.x)); expect(bounds.containsPoint(point)).toBe(true);
        }
        expect(lowest, `${variant}/${crashPhase}`).toBeGreaterThan(-.02);
      }
    }
    bike.setAppearance(appearance, true); bike.setLighting(1); expect(bike.headlight.intensity).toBe(0);
    for (const mesh of visibleMeshes(bike.variants[quality])) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material])
      if (/^Lamp(Front|Rear|Reflector)$/.test(material.name)) expect((material as MeshStandardMaterial).emissiveIntensity).toBe(0);
    bike.dispose();
  });
});
