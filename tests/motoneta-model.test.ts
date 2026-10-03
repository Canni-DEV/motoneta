import { beforeAll, describe, expect, it } from 'vitest';
import { Box3, DoubleSide, Mesh, MeshStandardMaterial, Object3D, Raycaster, SkinnedMesh, Vector3 } from 'three';
import { Bike, type BikeAssets, type BikeVisualState } from '../src/bike-model';
import { BIKE_SLOTS, defaultAppearance, SLOTS, VARIANTS } from '../src/appearance';
import { VEHICLE_VISUALS } from '../src/vehicle-visual';
import { modelAssets } from './model-fixture';
import manifest from '../assets/motoneta/manifest.json';

let assets: BikeAssets;
beforeAll(async () => { assets = await modelAssets('motoneta'); });
const state = (overrides: Partial<BikeVisualState> = {}): BikeVisualState => ({
  time: 0, paused: false, speed: 2, tilt: 0, grounded: true, recovery: false, ground: () => 0, ...overrides,
});
function visibleMeshes(root: Object3D) {
  const meshes: Mesh[] = [];
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    let node: Object3D | null = object;
    while (node && node !== root && node.visible) node = node.parent;
    if (node === root) meshes.push(object);
  });
  return meshes;
}

describe.each(['high', 'low'] as const)('Motoneta %s visual contract', (quality) => {
  it('has distinct interchangeable families, two paint channels and a bounded full combination', () => {
    const bike = new Bike(0xe05a3b, assets, quality, 'motoneta');
    const catalog: Mesh[] = [];
    bike.variants[quality].traverse((object) => { if (object instanceof Mesh) catalog.push(object); });
    bike.rider.traverse((object) => { if (object instanceof Mesh) catalog.push(object); });
    const triangles = (mesh: Mesh) => (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
    const groups = SLOTS.map((slot) => VARIANTS.map((variant) => catalog.filter((m) => m.name.startsWith(`Slot_${slot}_${variant}`))));
    const maximum = catalog.filter((m) => !m.name.startsWith('Slot_')).reduce((sum,m) => sum+triangles(m),0)
      + groups.reduce((sum,variants) => sum+Math.max(...variants.map((parts) => parts.reduce((s,m) => s+triangles(m),0))),0);
    expect(maximum).toBe(manifest.assets[quality].trianglesSelectedMax);
    expect(maximum).toBeLessThanOrEqual(quality === 'low' ? 8000 : 30000);
    for (const slot of BIKE_SLOTS) {
      const variants = VARIANTS.map((variant) => catalog.filter((m) => m.name.startsWith(`Slot_${slot}_${variant}`)));
      expect(new Set(variants.map((parts) => JSON.stringify(parts.map((m) => Array.from(m.geometry.attributes.position.array))))).size).toBe(3);
      for (const parts of variants) {
        const roles = parts.flatMap((m) => {
          const color=(assets[quality].getObjectByName(m.name) as Mesh).geometry.attributes.color;
          return Array.from({length:color.count},(_,i) => color.getW(i));
        });
        expect(roles.some((a) => a < .25)).toBe(true);
        expect(roles.some((a) => a >= .25 && a < .75)).toBe(true);
      }
    }
    const appearance = defaultAppearance(); appearance.vehicle = 'motoneta';
    const allocation = (bike as any).ownedGeometries.length;
    for (let i=0;i<BIKE_SLOTS.length;i++) for(let j=i+1;j<BIKE_SLOTS.length;j++) for(const a of VARIANTS) for(const b of VARIANTS) {
      appearance.parts[BIKE_SLOTS[i]]=a; appearance.parts[BIKE_SLOTS[j]]=b; bike.setAppearance(appearance);
      for(const slot of [BIKE_SLOTS[i],BIKE_SLOTS[j]]) for(const variant of VARIANTS) {
        const nodes = catalog.filter((m) => m.name.startsWith(`Slot_${slot}_${variant}`));
        expect(nodes.every((m) => m.visible === (appearance.parts[slot] === variant))).toBe(true);
      }
      appearance.parts[BIKE_SLOTS[i]]='core'; appearance.parts[BIKE_SLOTS[j]]='core';
    }
    expect((bike as any).ownedGeometries.length).toBe(allocation);
    bike.dispose();
  });

  it('keeps every wheel family above flat ground and ramps', () => {
    const bike = new Bike(0xe05a3b, assets, quality, 'motoneta');
    const appearance = defaultAppearance(); appearance.vehicle = 'motoneta';
    for(const variant of VARIANTS) for(const slope of [0,.35,-.35]) for(const tilt of [Math.atan(slope),.7,1.35,-.5,2.05]) {
      appearance.parts.wheels=variant; bike.setAppearance(appearance); bike.wheelAngle=tilt*1.73;
      bike.update(state({tilt,ground:(x) => slope*x})); bike.root.updateMatrixWorld(true);
      let lowest = Infinity;
      for(const wheel of bike.wheels) for(const mesh of visibleMeshes(wheel)) {
        for(let i=0;i<mesh.geometry.attributes.position.count;i++) {
          const point=new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld);
          lowest=Math.min(lowest,point.y-slope*point.x);
        }
      }
      expect(lowest, `${variant}/${slope}/${tilt}`).toBeGreaterThanOrEqual(-.001);
    }
    bike.dispose();
  });

  it('holds hands on the bars, boots on the floor and the seated support above the saddle', () => {
    const bike = new Bike(0xe05a3b, assets, quality, 'motoneta');
    const appearance = defaultAppearance(); appearance.vehicle = 'motoneta';
    const ray=new Raycaster();
    for(const variant of VARIANTS) {
      for(const slot of SLOTS) appearance.parts[slot]=variant;
      bike.setAppearance(appearance); bike.reset();
      for(let frame=0;frame<60;frame++) {
        bike.update(state({time:frame/60,laneMotion:frame<30?1:-1})); bike.root.updateMatrixWorld(true);
        const bar=bike.variants[quality].getObjectByName('Handlebar')!;
        for(const suffix of ['L','R']) {
          const rest=VEHICLE_VISUALS.motoneta.rig;
          const grip=new Vector3(...rest[`Hand${suffix}` as 'HandL'|'HandR'].head)
            .sub(new Vector3(...VEHICLE_VISUALS.motoneta.steering));
          bar.localToWorld(grip);
          expect(bike.rider.getObjectByName(`Hand${suffix}`)!.getWorldPosition(new Vector3()).distanceTo(grip)).toBeLessThan(.0001);
        }
      }
      bike.reset(); bike.root.updateMatrixWorld(true);
      const pants=bike.rider.getObjectByName(`Slot_pants_${variant}`) as SkinnedMesh;
      const seat=bike.variants[quality].getObjectByName(`Slot_seat_${variant}`)!;
      const mat=pants.material as MeshStandardMaterial; const side=mat.side; mat.side=DoubleSide;
      for(const x of [-.27,-.23,-.19]) for(const z of [-.025,.025]) {
        ray.set(bike.body.localToWorld(new Vector3(x,1.1,z)),new Vector3(0,-1,0));
        const cloth=ray.intersectObject(pants,false), saddle=ray.intersectObject(seat,false);
        expect(cloth.length).toBeGreaterThanOrEqual(2); expect(saddle.length).toBeGreaterThan(0);
        expect(cloth.at(-1)!.point.y-saddle[0].point.y).toBeGreaterThanOrEqual(-.002);
        expect(cloth.at(-1)!.point.y-saddle[0].point.y).toBeLessThan(.025);
      }
      mat.side=side;
      const boots=bike.rider.getObjectByName(`Slot_boots_${variant}`) as SkinnedMesh;
      let min=Infinity;
      for(let i=0;i<boots.geometry.attributes.position.count;i++) {
        const point=boots.getVertexPosition(i,new Vector3());
        min=Math.min(min,point.y);
      }
      expect(min).toBeGreaterThanOrEqual(.288-.004);
      expect(min).toBeLessThan(.305);
    }
    bike.dispose();
  });

  it('clears the ground through crashes and recovery and preserves visible bounds', () => {
    const bike = new Bike(0xe05a3b, assets, quality, 'motoneta');
    const bounds=new Box3(); const appearance=defaultAppearance(); appearance.vehicle='motoneta';
    for(const variant of VARIANTS) {
      for(const slot of SLOTS) appearance.parts[slot]=variant;
      bike.setAppearance(appearance);
      for(const ground of [() => 0,(x:number) => x*.3]) for(const [crashPhase,crashPhaseAge] of [
        ['rolling',10],['rolling',24],['rolling',40],['down',0],['mounting',0],['mounting',8],['mounting',15],
      ] as const) {
        bike.update(state({recovery:true,crashPhase,crashPhaseAge,crashRollDuration:40,lane:2,ground}));
        bike.root.updateMatrixWorld(true);bike.getVisualBounds(bounds);
        let lowest=Infinity;
        for(const mesh of [...visibleMeshes(bike.variants[quality]),...visibleMeshes(bike.rider)]) for(let i=0;i<mesh.geometry.attributes.position.count;i+=4) {
          const point=mesh.getVertexPosition(i,new Vector3()).applyMatrix4(mesh.matrixWorld);
          lowest=Math.min(lowest,point.y-ground(point.x));
          expect(bounds.containsPoint(point)).toBe(true);
        }
        expect(lowest,`${variant}/${crashPhase}/${crashPhaseAge}`).toBeGreaterThan(-.02);
      }
    }
    bike.update(state());
    expect(bike.riderLayer.position.distanceTo(bike.body.position)).toBeLessThan(.0001);
    bike.setAppearance(appearance,true);bike.setLighting(1);expect(bike.headlight.intensity).toBe(0);
    bike.dispose();
  });
});
