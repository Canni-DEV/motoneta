import { describe, expect, it } from 'vitest';
import { emptyDesign, generateMap, generatorDefaults, placedPiece, revision, validateMap } from '../src/core/maps';
import { surfaceAt, surfacePath } from '../src/core/tracks';
import { isFlatTerrain, pointInTerrain, terrainPolygons } from '../src/core/terrain';
import { Input, type Track } from '../src/core/types';
import { stepRace } from '../src/core/racing';
import { fingerprint } from '../src/core/simulation';
import { DRIVE } from '../src/core/handling';
import { testRace, testTrack } from './race-fixture';
import { appendInput, newRecording, validateRecording } from '../src/core/recording';
import { materialFor } from '../src/presentation-material';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import audio from '../src/audio/terrain-manifest.json';
import * as THREE from 'three';
import { WeatherSurfaces } from '../src/weather-surfaces';
import { buildTerrain, terrainMaterials, setTerrainQuality, disposeTerrainInstances } from '../src/rendering/terrain';
import { WORLD_SCALE, LANE_WIDTH } from '../src/world-space';
import { terrainFactors } from '../src/core/terrain';

function live(piece = 'K') {
  const s = { ...placedPiece(piece, 100, 15), length: 10000 };
  const track: Track = { ...testTrack(), length: 20000, segments: [s] };
  const race = testRace(track);
  race.phase = 'racing'; race.countdown = 0;
  Object.assign(race.riders[0], { x: 5000, lane: 1, progress: 5000 });
  return race;
}
describe('shared organic footprints', () => {
  it('joins adjacent lanes, separates islands and uses continuous lateral positions', () => {
    const s = placedPiece('K', 100, 5), track = testTrack({ items: [s] });
    expect(terrainPolygons(s)).toHaveLength(2);
    expect(surfaceAt(track, 112, 0)?.surface).toBe('mud');
    expect(surfaceAt(track, 112, 1)).toBeUndefined();
    expect(surfaceAt(track, 100, 0)).toBeUndefined();
    expect(surfaceAt(track, 112, 0.49)).toBeUndefined();
    const joined = placedPiece('U', 100, 3), joinedTrack = testTrack({ items: [joined] });
    expect(terrainPolygons(joined)).toHaveLength(1);
    expect(surfaceAt(joinedTrack, 132, 0.49)?.surface).toBe('sand');
    expect(surfaceAt(joinedTrack, 132, 0.51)?.surface).toBe('sand');
    expect(surfaceAt(joinedTrack, 132, 1.5)).toBeUndefined();
  });
  it('keeps contours reproducible and within their envelope for every lane mask', () => {
    for (let lanes = 1; lanes <= 15; lanes++) for (let variant = 0; variant < 16; variant++) {
      const s = { ...placedPiece('V', 100, lanes), terrainShape: { version: 1 as const, variant } };
      const polygons = terrainPolygons(s);
      expect(terrainPolygons(structuredClone(s))).toEqual(polygons);
      for (const polygon of polygons) {
        for (const [x,lane] of polygon) {
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(s.length);
          expect(lanes & (1 << Math.round(lane))).toBeTruthy();
        }
        const center = polygon.reduce((v,p) => [v[0]+p[0]/polygon.length,v[1]+p[1]/polygon.length], [0,0]);
        expect(pointInTerrain(polygon,center[0],center[1])).toBe(true);
      }
    }
  });
  it('detects a complete crossing of a one-unit sector between frames, including lap wrap', () => {
    const s = { ...placedPiece('M', 2), length: 1 }, track = testTrack({ items: [s] });
    expect(surfaceAt(track, 639, 0)).toBeUndefined();
    expect(surfaceAt(track, 646, 0)).toBeUndefined();
    const contacts = surfacePath(track,639,0,646,0);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].exit - contacts[0].enter).toBeGreaterThan(0.1);
    expect(contacts[0].enter).toBeGreaterThan(0);
  });
  it('preserves shapes on resize/move and includes variants in the map revision', () => {
    const d = validateMap({ ...emptyDesign(), items: [placedPiece('U',100)] });
    const s = d.items[0], moved = { ...s, x: 200 };
    expect(terrainPolygons(moved)).toEqual(terrainPolygons(s));
    expect(validateMap(JSON.parse(JSON.stringify(d)))).toEqual(d);
    const changed = structuredClone(d); changed.items[0].terrainShape!.variant++;
    expect(revision(changed)).not.toBe(d.revision);
    expect(terrainPolygons(changed.items[0])).not.toEqual(terrainPolygons(s));
    for (const shape of [{version:2,variant:1},{version:1,variant:-1},{version:1,variant:0.5},{version:1,variant:2**32},null]) {
      expect(() => validateMap({ ...d, items: [{ ...s, terrainShape: shape }] })).toThrow(/Contorno/);
    }
  });
  it('migrates format 3 maps without changing placements or heights', () => {
    const d = emptyDesign(), item = placedPiece('P',100); delete item.terrainShape;
    const old = { ...d, version: 3, items: [item] };
    const a = validateMap(old), b = validateMap(old);
    expect(a).toEqual(b); expect(a.version).toBe(4);
    expect(a.items[0]).toMatchObject(item);
    expect(a.items[0].terrainShape?.version).toBe(1);
  });
});
describe('terrain handling', () => {
  it('removes exactly 40% of longitudinal penalties with a wheelie, preserving gravel resistance', () => {
    for (const surface of ['mud','grass','sand','gravel'] as const) {
      const regular = terrainFactors(surface), wheelie = terrainFactors(surface,true);
      expect(1-wheelie.speed).toBeCloseTo((1-regular.speed)*0.6,10);
      expect(1-wheelie.acceleration).toBeCloseTo((1-regular.acceleration)*0.6,10);
      expect(wheelie.lateral).toBe(regular.lateral);
    }
  });
  it.each([['K',0.65],['P',0.9],['U',0.8],['V',1]] as const)('limits sustained A/B speed on %s', (piece,ratio) => {
    for (const input of [Input.A,Input.B]) {
      const r = live(piece); r.riders[0].speed = 3.25;
      for (let i=0;i<180;i++) stepRace(r,input);
      expect(r.riders[0].speed).toBeCloseTo((input === Input.A ? DRIVE.normalSpeed : DRIVE.turboSpeed)*ratio,2);
      expect(r.riders[0].crashes).toBe(0);
    }
  });
  it.each([['K',0.7],['P',0.9],['U',0.5],['V',1]] as const)('scales A/B acceleration on %s', (piece,ratio) => {
    for (const input of [Input.A,Input.B]) {
      const r=live(piece); for(let i=0;i<4;i++) stepRace(r,input);
      expect(r.riders[0].speed).toBeCloseTo((input===Input.A?DRIVE.normalAcceleration:DRIVE.turboAcceleration)*ratio,4);
    }
  });
  it('applies a gradual slowdown and a partial wheelie benefit', () => {
    const regular=live(), wheelie=live();
    regular.riders[0].speed=wheelie.riders[0].speed=DRIVE.normalSpeed;
    wheelie.riders[0].wheelie=0.5;
    stepRace(regular,Input.A);
    expect(DRIVE.normalSpeed-regular.riders[0].speed).toBeLessThanOrEqual(0.08);
    for(let i=0;i<35;i++) { stepRace(regular,Input.A); stepRace(wheelie,Input.A|Input.LEFT); }
    expect(wheelie.riders[0].speed).toBeGreaterThan(regular.riders[0].speed);
    expect(wheelie.riders[0].speed).toBeLessThan(DRIVE.normalSpeed);
  });
  it('slows gravel lane changes while preserving airborne controls', () => {
    const gravel=live('V'), ordinary=live('M');
    stepRace(gravel,Input.DOWN); stepRace(ordinary,Input.DOWN);
    expect(gravel.riders[0].lane-1).toBeCloseTo((ordinary.riders[0].lane-1)*0.6,4);
    const air=live('V'); air.riders[0].grounded=false; air.riders[0].height=80;
    stepRace(air,Input.DOWN);
    expect(air.riders[0].lane).toBe(ordinary.riders[0].lane);
  });
  it('does not omit gravel or acceleration resistance when crossing a whole short sector in one frame', () => {
    const r = testRace(testTrack({items:[{...placedPiece('V',91,15),length:1}]})), p=r.riders[0];
    r.phase='racing';r.countdown=0;Object.assign(p,{x:90,lane:1,speed:3.25});
    stepRace(r,Input.DOWN);
    expect(p.x).toBeGreaterThan(92);
    expect(p.lane-1).toBeLessThan(Math.round(0.034*256)/256);
    expect(p.lane-1).toBeGreaterThan(Math.round(0.034*256)/256*0.6);
    const sand = testRace(testTrack({items:[{...placedPiece('U',91,15),length:1}]}));
    sand.phase='racing';sand.countdown=0;sand.frame=3;
    Object.assign(sand.riders[0],{x:90,lane:1,speed:2});
    stepRace(sand,Input.B);
    expect(sand.riders[0].speed-2).toBeGreaterThan(0);
    expect(sand.riders[0].speed-2).toBeLessThan(DRIVE.turboAcceleration);
  });
  it('cools once on lateral entry, permits re-entry and does not reset while remaining inside', () => {
    const s=placedPiece('M',100), r=testRace(testTrack({items:[s]})), p=r.riders[0];
    r.phase='racing';r.countdown=0;
    const edge=1-surfacePath(r.track,108,1,108,0)[0].enter;
    Object.assign(p,{x:108,lane:edge+0.015,speed:0,heat:80});
    stepRace(r,Input.UP);
    expect(p.heat).toBe(0); expect(r.events.filter(e=>e.cause==='surface')).toHaveLength(1);
    for(let i=0;i<4;i++) stepRace(r,Input.B);
    expect(p.heat).toBeGreaterThan(0); expect(r.events.some(e=>e.cause==='surface')).toBe(false);
    p.speed=0;p.lane=1-surfacePath(r.track,p.x,1,p.x,0)[0].enter+0.015;stepRace(r,Input.UP);
    expect(p.heat).toBe(0); expect(r.events.some(e=>e.cause==='surface')).toBe(true);
  });
  it('recovers an overheated engine while sweeping across an entire tiny cooling zone', () => {
    const s={...placedPiece('M',91),length:1},r=testRace(testTrack({items:[s]})),p=r.riders[0];
    r.phase='racing';r.countdown=0;
    Object.assign(p,{x:90,lane:0,speed:7.25,heat:100,overheated:true});
    stepRace(r,Input.B);
    expect(p.x).toBeGreaterThan(92); expect(p.heat).toBe(0); expect(p.overheated).toBe(false);
    expect(r.events.filter(e=>e.cause==='surface')).toHaveLength(1);
  });
  it('cools on ordinary and loop-flight landings but never while passing overhead', () => {
    for(const loopAir of [false,true]) {
      const s=placedPiece('M',100),r=testRace(testTrack({items:[s]})),p=r.riders[0];
      r.phase='racing';r.countdown=0;
      Object.assign(p,{x:107,lane:0,speed:1,heat:80,height:0.1,vy:-1,grounded:false});
      if(loopAir) p.motion={kind:'loop-air',origin:0,age:1,vx:1,vlane:0,basis:[[1,0,0],[0,1,0],[0,0,1]],basisPitch:0,pendingCrash:null,ignoreRoad:10,contact:null};
      stepRace(r,Input.A); expect(p.grounded).toBe(true); expect(p.heat).toBe(0);
      expect(r.events.filter(e=>e.cause==='surface')).toHaveLength(1);
    }
    const air=live('M');Object.assign(air.riders[0],{grounded:false,height:80,heat:80});
    stepRace(air,Input.B);expect(air.riders[0].heat).toBeGreaterThan(80);
  });
  it('has identical physical results across weather and replay reconstruction', () => {
    const results=['clear','rain','snow'].map(weather=>{
      const r=live('U');r.config.weather=weather as typeof r.config.weather;
      for(let i=0;i<180;i++) stepRace(r,Input.B|Input.DOWN);
      return fingerprint(r);
    });
    expect(new Set(results).size).toBe(1);
    const r=testRace(testTrack({length:2048,items:[placedPiece('U',400,15),placedPiece('V',900,15)]}));
    const recording=newRecording(r.config);
    while(r.phase!=='finished') {appendInput(recording,Input.A);stepRace(r,Input.A);}
    expect(validateRecording(recording).result.finishes).toEqual(r.finishes);
  });
});
it('generates all five terrain types deterministically, including zero frequencies', () => {
  const terrains=['mud','cool','grass','sand','gravel'] as const;
  const maps=terrains.map(surface=>generateMap({...generatorDefaults,loops:0,ramps:0,mud:0,cool:0,grass:0,sand:0,gravel:0,[surface]:100,size:'long',seed:'terrain'}));
  const all={items:maps.flatMap(map=>map.items)};
  maps.forEach((map,i)=>expect(map.items.every(item=>item.surface===terrains[i])).toBe(true));
  expect(new Set(all.items.map(p=>p.surface))).toEqual(new Set(['mud','grass','cool','sand','gravel']));
  expect(all.items.filter(isFlatTerrain).every(p=>p.terrainShape?.version===1)).toBe(true);
  expect(generateMap({...generatorDefaults,loops:0,ramps:0,mud:0,cool:0,grass:0,sand:0,gravel:0}).items).toEqual([]);
});
it('triangulates the physical footprint exactly and preserves it across quality changes', () => {
  const weather = new WeatherSurfaces(), resources: (THREE.BufferGeometry | THREE.Material)[] = [];
  const materials = terrainMaterials(weather, resources);
  for (const piece of ['K','P','M','U','V']) for (const lanes of [3,5,15]) {
    const segment = placedPiece(piece,100,lanes), group = new THREE.Group();
    buildTerrain(segment,group,materials,resources,'high');
    const meshes = group.children.filter((o): o is THREE.Mesh => o.name.startsWith('Terrain_') && !o.name.startsWith('Terrain_detail'));
    const physical = terrainPolygons(segment);
    expect(meshes.map(mesh => mesh.userData.terrainPolygon)).toEqual(physical);
    meshes.forEach((mesh,n) => {
      const positions = mesh.geometry.getAttribute('position'), indices = mesh.geometry.index!;
      const projected = Array.from({length:positions.count},(_,i) => [positions.getX(i)/WORLD_SCALE,positions.getZ(i)/LANE_WIDTH+1.5]);
      for(let i=0;i<indices.count;i+=3) {
        const triangle = [0,1,2].map(j => projected[indices.getX(i+j)]);
        const center = [0,1].map(j => triangle.reduce((sum,p)=>sum+p[j]/3,0));
        expect(pointInTerrain(physical[n],center[0],center[1])).toBe(true);
      }
      physical[n].forEach(([x,lane],i) => {
        expect(projected[i][0]).toBeCloseTo(x,4);expect(projected[i][1]).toBeCloseTo(lane,5);
      });
    });
    const details = group.children.filter((o):o is THREE.InstancedMesh => o instanceof THREE.InstancedMesh);
    setTerrainQuality(group,'low');
    details.forEach(o=>expect(o.count).toBe(o.userData.lowCount));
    expect(meshes.map(mesh => mesh.userData.terrainPolygon)).toEqual(physical);
    setTerrainQuality(group,'high');
    details.forEach(o=>expect(o.count).toBe(o.userData.highCount));
    disposeTerrainInstances(group);
  }
  resources.forEach(resource => resource.dispose());weather.dispose();
});
it('provides original PCM sand/gravel sounds and water in clear cooling sectors', () => {
  expect(materialFor('cool','clear')).toBe('wet');
  expect(materialFor('sand','rain')).toBe('sand');expect(materialFor('gravel','clear')).toBe('gravel');
  for(const item of audio) {
    const buffer=readFileSync('public/audio/'+item.file);
    expect(buffer.toString('ascii',0,4)).toBe('RIFF');
    expect(buffer.readUInt32LE(24)).toBe(44100);
    expect(createHash('sha256').update(buffer).digest('hex')).toBe(item.sha256);
    if(item.loop) {expect(buffer.readInt16LE(44)).toBe(0);expect(buffer.readInt16LE(buffer.length-2)).toBe(0);}
  }
});
