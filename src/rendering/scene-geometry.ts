import * as THREE from 'three';

export const mat = (color: THREE.ColorRepresentation, roughness = 0.82, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
export const black = mat('#293731'),
  white = mat('#ebe9d8');
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
export function box(
  parent: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  m: THREE.Material,
  rot = 0,
) {
  const o = new THREE.Mesh(boxGeo, m);
  o.position.set(x, y, z);
  o.scale.set(w, h, d);
  o.rotation.z = rot;
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
export function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#9c673d';
  ctx.fillRect(0, 0, 512, 256);
  let seed = 421;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 15000; i++) {
    const v = random();
    ctx.fillStyle = v > 0.5 ? 'rgba(233,181,119,.10)' : 'rgba(42,30,17,.10)';
    ctx.fillRect(random() * 512, random() * 256, random() * 4 + 1, random() * 2 + 1);
  }
  for (let lane = 0; lane < 4; lane++)
    for (let j = 0; j < 3; j++) {
      ctx.strokeStyle = 'rgba(54,36,21,.15)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, lane * 64 + 20 + j * 9);
      ctx.lineTo(512, lane * 64 + 20 + j * 9);
      ctx.stroke();
    }
  ctx.setLineDash([25, 29]);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = 'rgba(247,222,169,.5)';
  for (const y of [64, 128, 192]) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(512, y);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 1);
  t.anisotropy = 8;
  return t;
}
export function soilNoise() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d')!,
    data = ctx.createImageData(128, 128);
  for (let i = 0; i < data.data.length; i += 4) {
    const n = 120 + Math.sin(i * 23.193) * 34;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = n;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.3, 1.3);
  return t;
}
/** Dispose only resources owned by the caller; shared meshes/materials stay shared. */
export function disposeResources(resources: readonly (THREE.BufferGeometry | THREE.Material)[]) {
  resources.forEach((resource) => resource.dispose());
}
