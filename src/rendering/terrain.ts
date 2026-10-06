import * as THREE from 'three';
import { isTerrainSurface, pointInTerrain, terrainPolygons, terrainShape, TERRAIN_INFO, type TerrainSurface } from '../core/terrain';
import type { Segment, Settings } from '../core/types';
import type { WeatherSurfaces } from '../weather-surfaces';
import { WORLD_SCALE as SCALE, LANE_WIDTH as LANE } from '../world-space';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

type Resources = (THREE.BufferGeometry | THREE.Material)[];
const noise = (x: number, y: number) => {
  const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return v - Math.floor(v);
};
/** Original, tiled albedo and height/roughness maps. No external textures. */
export function terrainTextures(surface: TerrainSurface) {
  const w = 256, h = 128, albedo = new Uint8Array(w * h * 4), control = new Uint8Array(w * h * 4);
  const base = new THREE.Color(TERRAIN_INFO[surface].color);
  // Canvas-like authored colors stored in sRGB; the renderer decodes once.
  base.convertLinearToSRGB();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h, n = noise(x, y);
    const broad = Math.sin(u * Math.PI * 6 + Math.sin(v * Math.PI * 4)) * 0.5 + 0.5;
    const rut = Math.exp(-(((v - 0.32 - Math.sin(u * Math.PI * 2) * 0.02) / 0.033) ** 2)) +
      Math.exp(-(((v - 0.66 - Math.sin(u * Math.PI * 2) * 0.015) / 0.035) ** 2));
    let tint = 0.85 + n * 0.23, height = 0.5, roughness = 0.94;
    let r = base.r, g = base.g, b = base.b;
    if (surface === 'mud') {
      const puddle = Math.max(0, (Math.cos(u * Math.PI * 4 + Math.sin(v * Math.PI * 4)) *
        Math.sin(v * Math.PI * 6) - 0.38) / 0.62);
      tint = 0.8 + broad * 0.2 + n * 0.16 - rut * 0.28 - puddle * 0.18;
      height = 0.48 + n * 0.15 - rut * 0.3;
      roughness = 0.9 - puddle * 0.7;
    } else if (surface === 'grass') {
      const bare = Math.max(0, (broad * Math.cos(v * Math.PI * 4) - 0.2) * 0.65);
      r = r * (1 - bare) + 0.48 * bare; g = g * (1 - bare) + 0.32 * bare; b = b * (1 - bare) + 0.16 * bare;
      tint = 0.78 + broad * 0.24 + n * 0.25 - rut * 0.21;
      height = 0.5 + n * 0.25 - rut * 0.15;
    } else if (surface === 'sand') {
      const dune = Math.sin(u * Math.PI * 8 + Math.sin(v * Math.PI * 2) * 2);
      tint = 0.9 + dune * 0.04 + n * 0.1 - rut * 0.18;
      height = 0.5 + dune * 0.15 + n * 0.12 - rut * 0.15;
    } else if (surface === 'gravel') {
      const cx = Math.floor(u * 26), cy = Math.floor(v * 12);
      const px = (u * 26) % 1 - 0.3 - noise(cx, cy) * 0.35;
      const py = (v * 12) % 1 - 0.3 - noise(cx + 9, cy) * 0.35;
      const stone = Math.max(0, 1 - Math.hypot(px * 2.7, py * 2.3));
      tint = 0.64 + stone * (0.33 + noise(cx, cy + 5) * 0.28) + n * 0.1;
      height = 0.25 + stone * 0.6;
      if (noise(cx + 4, cy + 8) < 0.28) { r *= 1.12; g *= 0.99; b *= 0.72; }
    } else {
      tint = 0.78 + broad * 0.12 + n * 0.08 + Math.sin(u * Math.PI * 20 + v * 5) * 0.07;
      height = 0.5 + Math.sin(u * Math.PI * 20 + Math.sin(v * Math.PI * 2)) * 0.06;
      roughness = 0.28 + broad * 0.13;
    }
    const i = (y * w + x) * 4;
    albedo.set([Math.min(255, r * tint * 255), Math.min(255, g * tint * 255), Math.min(255, b * tint * 255), 255], i);
    control.set([height * 255, roughness * 255, 0, 255], i);
  }
  const texture = (data: Uint8Array, colorSpace: THREE.ColorSpace = THREE.NoColorSpace) => {
    const map = new THREE.DataTexture(data, w, h);
    map.colorSpace = colorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = 8; map.needsUpdate = true;
    return map;
  };
  return { map: texture(albedo, THREE.SRGBColorSpace), control: texture(control) };
}
export function terrainMaterials(surfaces: WeatherSurfaces, resources: Resources) {
  const materials = {} as Record<TerrainSurface, THREE.MeshStandardMaterial>;
  for (const surface of ['mud', 'grass', 'cool', 'sand', 'gravel'] as const) {
    const textures = terrainTextures(surface);
    surfaces.ownTrackTexture(textures.map); surfaces.ownTrackTexture(textures.control);
    const material = new THREE.MeshStandardMaterial({
      map: textures.map, roughnessMap: textures.control, bumpMap: textures.control,
      bumpScale: surface === 'cool' ? 0.012 : surface === 'sand' ? 0.035 : 0.045,
      roughness: 1, metalness: surface === 'cool' ? 0.12 : 0,
    });
    surfaces.register(material, { profile: surface, temporary: true });
    resources.push(material); materials[surface] = material;
  }
  const detail = {} as Record<'grass' | 'gravel' | 'mud', THREE.MeshStandardMaterial>;
  for (const surface of ['grass', 'gravel', 'mud'] as const) {
    const material = new THREE.MeshStandardMaterial({ color: TERRAIN_INFO[surface].color,
      side: surface === 'grass' ? THREE.DoubleSide : THREE.FrontSide, roughness: 0.94 });
    surfaces.register(material, { profile: surface, temporary: true }); resources.push(material); detail[surface] = material;
  }
  const blade = new THREE.BufferGeometry();
  const points: number[] = [];
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI / 3, x = Math.cos(a), z = Math.sin(a);
    points.push(-x, 0, -z, x, 0, z, x * 0.2, 1, z * 0.2);
  }
  blade.setAttribute('position', new THREE.Float32BufferAttribute(points, 3)); blade.computeVertexNormals();
  const stone = new THREE.IcosahedronGeometry(1, 0);
  resources.push(blade, stone);
  return { materials, detail, blade, stone };
}
type TerrainMaterials = ReturnType<typeof terrainMaterials>;

export function setTerrainQuality(group: THREE.Object3D, quality: Settings['quality']) {
  group.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.userData.terrainDetail)
      object.count = quality === 'high' ? object.userData.highCount : object.userData.lowCount;
  });
}
export function disposeTerrainInstances(group: THREE.Object3D) {
  group.traverse((object) => { if (object instanceof THREE.InstancedMesh) object.dispose(); });
}

export function buildTerrain(s: Segment, group: THREE.Group, shared: TerrainMaterials, resources: Resources, quality: Settings['quality']) {
  if (!isTerrainSurface(s.surface)) return;
  const polygons = terrainPolygons(s), surface = s.surface, variant = terrainShape(s).variant;
  for (const polygon of polygons) {
    const shape = new THREE.Shape(polygon.map(([x, lane]) => new THREE.Vector2(x * SCALE, -(lane - 1.5) * LANE)));
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++)
      uv.setXY(i, positions.getX(i) / 1.8 + (variant % 31) / 31, positions.getZ(i) / LANE + 0.5);
    resources.push(geometry);
    const mesh = new THREE.Mesh(geometry, shared.materials[surface]);
    mesh.position.y = 0.025; mesh.receiveShadow = true;
    mesh.name = 'Terrain_' + surface; mesh.userData.terrainPolygon = polygon;
    group.add(mesh);
  }
  if (surface === 'grass' || surface === 'gravel' || surface === 'mud') {
    const lanes = [0,1,2,3].filter((lane) => s.lanes & (1 << lane));
    const area = s.length * SCALE * lanes.length * LANE;
    const count = Math.min(surface === 'grass' ? 900 : 400, Math.ceil(area * (surface === 'grass' ? 26 : surface === 'gravel' ? 12 : 2.5)));
    const details = new THREE.InstancedMesh(surface === 'grass' ? shared.blade : shared.stone, shared.detail[surface], count);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion();
    const axis = new THREE.Vector3(0,1,0), tint = new THREE.Color();
    let seed = variant, actual = 0;
    const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let attempt = 0; attempt < count * 4 && actual < count; attempt++) {
      const x = random() * s.length, lane = lanes[Math.floor(random() * lanes.length)] + random() - 0.5;
      if (!polygons.some((p) => pointInTerrain(p, x, lane))) continue;
      if (surface === 'grass' && random() > 0.4 + 0.5 * Math.sin(x * 0.25 + Math.sin(lane * 8)) ** 2) continue;
      // Wheel tracks stay partly flattened, giving the turf a used, uneven appearance.
      const wheelPath = Math.abs((lane + 0.5) % 1 - 0.32) < 0.055 || Math.abs((lane + 0.5) % 1 - 0.66) < 0.055;
      const height = surface === 'grass' ? (0.08 + random() * 0.12) * (wheelPath ? 0.25 : 1) : 0.013 + random() * 0.022;
      const width = surface === 'grass' ? 0.023 + random() * 0.024 : 0.026 + random() * 0.065;
      position.set(x * SCALE, 0.03, (lane - 1.5) * LANE);
      scale.set(width, height, width * (0.6 + random() * 0.6));
      rotation.setFromAxisAngle(axis, random() * Math.PI * 2);
      matrix.compose(position, rotation, scale); details.setMatrixAt(actual, matrix);
      tint.setScalar(0.7 + random() * 0.65);
      if (surface === 'gravel' && random() < 0.28) tint.multiply(new THREE.Color(1.12,0.99,0.72));
      details.setColorAt(actual++, tint);
    }
    details.count = actual; details.castShadow = surface === 'grass'; details.receiveShadow = true;
    details.name = 'Terrain_detail_' + surface;
    details.userData.terrainDetail = true; details.userData.highCount = actual; details.userData.lowCount = Math.ceil(actual * 0.45);
    details.computeBoundingBox(); details.computeBoundingSphere(); group.add(details);
  }
  if (surface === 'cool') buildSprinklers(s, group, resources);
  setTerrainQuality(group, quality);
}

/** Combined pipework and an embossed thermometer/down arrow, outside the riding area. */
function buildSprinklers(s: Segment, group: THREE.Group, resources: Resources) {
  const pipes: THREE.BufferGeometry[] = [], glyphs: THREE.BufferGeometry[] = [], signs: THREE.BufferGeometry[] = [], jets: number[] = [];
  const cube = (list: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, h: number, d: number) => {
    const geometry = new THREE.BoxGeometry(w,h,d); geometry.translate(x,y,z); list.push(geometry);
  };
  const length = s.length * SCALE;
  const lanes = [0,1,2,3].filter((lane) => s.lanes & (1 << lane)), center = lanes.reduce((a,b) => a+b,0) / lanes.length;
  const side = center < 1.5 ? -1 : 1, z = side * (2 * LANE + 0.26), x = length * 0.42;
  cube(pipes, x, 0.24, z, 0.065, 0.48, 0.065);
  cube(pipes, x, 0.47, z - side * 0.08, 0.16, 0.065, 0.2);
  cube(pipes, x, 0.045, z, 0.27, 0.09, 0.23);
  cube(pipes, length * 0.82, 0.42, z, 0.045, 0.84, 0.045);
  cube(signs, length * 0.82, 0.84, z, 0.58, 0.45, 0.045);
  const sx = length * 0.82, front = z + 0.028;
  cube(glyphs, sx - 0.13, 0.87, front, 0.04, 0.22, 0.015);
  const bulb = new THREE.SphereGeometry(0.067, 10, 6); bulb.scale(1,1,0.2); bulb.translate(sx - 0.13, 0.75, front); glyphs.push(bulb);
  cube(glyphs, sx + 0.11, 0.86, front, 0.037, 0.23, 0.015);
  for (const direction of [-1,1]) {
    const arm = new THREE.BoxGeometry(0.15,0.035,0.015); arm.rotateZ(direction * Math.PI / 4);
    arm.translate(sx + 0.11 + direction * 0.045, 0.76, front); glyphs.push(arm);
  }
  for (const lane of lanes) {
    const targetZ = (lane - 1.5) * LANE;
    for (let stream = -1; stream <= 1; stream++) {
      for (let i = 0; i < 15; i++) {
        const point = (t: number) => [x + stream * 0.14 * t, 0.47 * (1-t) + Math.sin(t * Math.PI) * 0.28 + 0.028*t,
          z - side * 0.12 + (targetZ - z + side * 0.12) * t];
        jets.push(...point(i / 15), ...point((i + 0.65) / 15));
      }
    }
  }
  for (const [list, color, metalness] of [[pipes, '#326e7b', 0.4], [signs, '#265d73', 0], [glyphs, '#d7f1e9', 0]] as const) {
    const geometry = mergeGeometries(list); list.forEach((g) => g.dispose());
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness });
    resources.push(geometry, material);
    const mesh = new THREE.Mesh(geometry,material); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute(jets,3));
  const material = new THREE.LineBasicMaterial({ color: '#b9dce1', transparent: true, opacity: 0.5, depthWrite: false });
  resources.push(geometry,material); group.add(new THREE.LineSegments(geometry,material));
}
