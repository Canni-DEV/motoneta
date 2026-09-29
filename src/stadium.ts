import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HZ, type Race, type Track } from './core/types';
import { crowdMaterial, type CrowdAssets, type CrowdQuality } from './crowd-assets';
import { stadiumLamp } from './environment';
import {
  FRONT_Z,
  hash,
  modulo,
  ROW_DEPTH,
  ROW_RISE,
  ROWS,
  sectorSeats,
  stadiumLayout,
  StadiumMotion,
  type StadiumLayout,
} from './stadium-layout';

const SHIRTS = [
  '#b5253b',
  '#e3dfd5',
  '#2e455c',
  '#d3a253',
  '#353a40',
  '#648180',
  '#7b485a',
  '#788058',
].map((c) => new THREE.Color(c));
const SKIN = ['#e5b898', '#c7916a', '#ad7552', '#815039', '#53382c'].map((c) => new THREE.Color(c));
const HAIR = ['#28211e', '#584232', '#977454', '#c7bca3'].map((c) => new THREE.Color(c));
const solid = (color: string, roughness = 0.85, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });
const matrix = new THREE.Matrix4(),
  transform = new THREE.Object3D();

interface Sector {
  root: THREE.Group;
  absolute: number;
  logical: number;
  signature: number;
  structure: THREE.Mesh[];
  sign: THREE.Mesh;
  mountain: THREE.Mesh;
  glow: THREE.Sprite;
  people: THREE.InstancedMesh[];
  variants: THREE.BufferGeometry[][];
  reaction: { value: THREE.Vector2 };
  material: THREE.MeshStandardMaterial;
}

// The two cached vector masters are shared with the UI. Each stadium owns only
// two GPU textures; all its sectors reuse those materials.
const signLogos = new Map<boolean, Promise<HTMLImageElement | null>>();
function signLogo(inverse: boolean) {
  let pending = signLogos.get(inverse);
  if (!pending) {
    pending = new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = `${import.meta.env.BASE_URL}branding/motoneta-on-${inverse ? 'light' : 'dark'}.svg`;
    });
    signLogos.set(inverse, pending);
  }
  return pending;
}
function signTexture(inverse: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 192;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = inverse ? '#f5ead6' : '#202321';
  ctx.fillRect(0, 0, 1024, 192);
  ctx.fillStyle = '#d8332f';
  ctx.fillRect(0, 0, 26, 192);
  ctx.fillRect(998, 0, 26, 192);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let disposed = false;
  texture.addEventListener('dispose', () => {
    disposed = true;
  });
  void signLogo(inverse).then((image) => {
    if (!image || disposed) return;
    ctx.drawImage(image, 132, 24, 760, 144);
    texture.needsUpdate = true;
  });
  return texture;
}

function lampGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,248,224,1)');
  gradient.addColorStop(0.16, 'rgba(255,240,205,.55)');
  gradient.addColorStop(0.42, 'rgba(222,232,255,.16)');
  gradient.addColorStop(1, 'rgba(200,222,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Bounds of the full set, including animated arms, lamps and the distant landscape. */
export function visibleSectorRange(camera: THREE.OrthographicCamera, width: number) {
  camera.updateMatrixWorld();
  const e = matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).elements;
  let min = Infinity,
    max = -Infinity;
  for (const y of [-0.8, 15])
    for (const z of [-62, 4.6])
      for (const edge of [-1, 1]) {
        const x = (edge - e[4] * y - e[8] * z - e[12]) / e[0];
        min = Math.min(min, x);
        max = Math.max(max, x);
      }
  // Landscape can extend 14 units past the nominal sector. One more sector is the prefetch margin.
  return { first: Math.floor((min - 14) / width) - 1, last: Math.floor((max + 14) / width) + 1 };
}

export class Stadium {
  readonly root = new THREE.Group();
  private sectors: Sector[] = [];
  private layout!: StadiumLayout;
  private motion!: StadiumMotion;
  private quality: CrowdQuality;
  private clock = { value: 0 };
  private reduced = { value: 0 };
  private finishElapsed = 0;
  private template: THREE.BufferGeometry[] = [];
  private materials = [
    solid('#89908a'),
    solid('#424c52', 0.46, 0.6),
    solid('#b6253d', 0.5),
    solid('#333c44', 0.6),
    solid('#e7e5dc'),
    solid('#454f44'),
  ];
  private light = new THREE.MeshStandardMaterial({
    color: '#f2eee1',
    emissive: '#fff2d5',
    emissiveIntensity: 0,
  });
  private accessLight = new THREE.MeshStandardMaterial({
    color: '#f6d8a2',
    emissive: '#ffc579',
    emissiveIntensity: 0,
  });
  private edgeLight = new THREE.MeshStandardMaterial({
    color: '#d8e7f4',
    emissive: '#b5dfff',
    emissiveIntensity: 0,
  });
  private signs = [false, true].map(
    (inverse) =>
      new THREE.MeshStandardMaterial({
        map: signTexture(inverse),
        roughness: 0.75,
        side: THREE.DoubleSide,
      }),
  );
  private signGeometry = new THREE.PlaneGeometry(5.5, 0.98);
  private mountainGeometry = new THREE.ConeGeometry(12, 12, 6);
  private mountainMaterial = solid('#687a70');
  private glowMaterial = new THREE.SpriteMaterial({
    map: lampGlowTexture(),
    color: '#fff0d5',
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0,
    toneMapped: false,
  });
  constructor(
    private assets: CrowdAssets,
    quality: CrowdQuality,
  ) {
    this.quality = quality;
    this.root.name = 'Stadium';
    this.materials.push(this.light, this.accessLight, this.edgeLight);
  }
  get sectorWidth() {
    return this.layout?.width ?? 0;
  }
  setLighting(level: number, night = 0) {
    this.light.emissiveIntensity = level * 5 + night * 11;
    this.accessLight.emissiveIntensity = level * 2.5;
    this.edgeLight.emissiveIntensity = level * 2;
    this.glowMaterial.opacity = night * 0.8;
    for (const sector of this.sectors) sector.glow.visible = night > 0;
  }

  setTrack(track: Track) {
    const layout = stadiumLayout(track);
    if (!this.layout || layout.width !== this.layout.width) {
      this.sectors.forEach((s) => this.disposeSector(s));
      this.sectors = [];
      this.template.forEach((g) => g.dispose());
      this.template = [];
      this.buildStructure(layout);
    }
    this.layout = layout;
    if (this.motion) this.motion.reset(layout);
    else this.motion = new StadiumMotion(layout);
    this.clock.value = 0;
    this.finishElapsed = 0;
    for (const sector of this.sectors) {
      sector.absolute = Infinity;
      sector.root.visible = false;
      sector.reaction.value.set(-10, 0);
    }
  }

  private buildStructure(layout: StadiumLayout) {
    const lists: THREE.BufferGeometry[][] = this.materials.map(() => []),
      width = layout.width;
    const box = (x: number, y: number, z: number, w: number, h: number, d: number, m: number) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      geometry.translate(x, y, z);
      lists[m].push(geometry);
    };
    const rod = (a: number[], b: number[], radius: number, m: number) => {
      const av = new THREE.Vector3(...a),
        bv = new THREE.Vector3(...b),
        delta = bv.clone().sub(av);
      const geometry = new THREE.CylinderGeometry(radius, radius, delta.length(), 6);
      transform.position.copy(av).add(bv).multiplyScalar(0.5);
      transform.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      transform.scale.set(1, 1, 1);
      transform.updateMatrix();
      geometry.applyMatrix4(transform.matrix);
      lists[m].push(geometry);
    };
    box(width / 2, -0.1, -4.9, width, 0.18, 3.7, 0);
    box(width / 2, -0.08, 3.5, width, 0.15, 1.7, 0);
    box(width / 2, -0.17, -6.55, width, 0.1, 0.3, 5);
    for (const z of [-2.62, 2.62]) {
      box(width / 2, 0.035, z, width, 0.08, 0.075, 4);
      for (let x = 0.75; x < width; x += 3) {
        box(x, 0.2, z, 0.065, 0.4, 0.065, 4);
        box(x, 0.41, z, 0.095, 0.06, 0.095, 8);
      }
    }
    for (let row = 0; row < ROWS; row++) {
      const y = 0.22 + row * ROW_RISE,
        z = FRONT_Z - row * ROW_DEPTH;
      box(width / 2, y - 0.065, z, width, 0.13, ROW_DEPTH, 0);
      box(width / 2, y - 0.22, z + ROW_DEPTH / 2 - 0.04, width, 0.31, 0.08, 0);
      // Half-height stair treads at both ends connect all rows.
      for (const x of [0.32, width - 0.32])
        box(x, y - ROW_RISE / 2 - 0.05, z + ROW_DEPTH * 0.65, 0.64, 0.1, ROW_DEPTH / 2, 0);
      for (const x of [0.58, width - 0.58])
        box(x, y + 0.02, z + ROW_DEPTH * 0.42, 0.16, 0.06, 0.08, 7);
    }
    for (const seat of sectorSeats(layout, 0)) {
      const red = Math.floor(seat.y / ROW_RISE) % 3 === 0 ? 2 : 3;
      box(seat.x, seat.y + 0.275, seat.z - 0.08, 0.4, 0.07, 0.36, red);
      box(seat.x, seat.y + 0.48, seat.z - 0.24, 0.4, 0.4, 0.065, red);
      box(seat.x, seat.y + 0.13, seat.z - 0.12, 0.055, 0.26, 0.055, 1);
    }
    // The supporting frame is visible underneath the rear deck.
    const back = FRONT_Z - (ROWS - 1) * ROW_DEPTH - 0.55,
      deck = 0.22 + (ROWS - 1) * ROW_RISE;
    box(width / 2, deck - 0.065, back, width, 0.13, 0.9, 0);
    for (const x of [0.6, width / 2, width - 0.6]) {
      rod([x, -0.1, back], [x, deck, back], 0.085, 1);
      rod([x, 0, -6.7], [x, deck - 0.12, back], 0.075, 1);
      rod([x, deck, back - 0.4], [x, deck + 1.05, back - 0.4], 0.028, 1);
    }
    for (const y of [deck + 0.6, deck + 1.03])
      rod([0, y, back - 0.4], [width, y, back - 0.4], 0.027, 1);
    for (const x of [0.66, width - 0.66]) {
      rod([x, 1.02, -6.6], [x, deck + 0.9, back], 0.029, 1);
      for (const row of [0, 3, 6, 9]) {
        const y = 0.22 + row * ROW_RISE,
          z = FRONT_Z - row * ROW_DEPTH;
        rod([x, y, z], [x, y + 0.85, z], 0.025, 1);
      }
    }
    for (const x of [0.7, width / 2, width - 0.7])
      rod([x, 0.02, -6.15], [x, 1.12, -6.15], 0.028, 1);
    for (const y of [0.53, 1.08]) rod([0, y, -6.15], [width, y, -6.15], 0.028, 1);
    const pole = width * 0.5;
    rod([pole, 0, -5.65], [pole, 7.7, -5.65], 0.055, 1);
    box(pole, 7.7, -5.65, 1.55, 0.25, 0.34, 3);
    for (const stands of [false, true]) {
      const { position } = stadiumLamp(width, 0, stands);
      for (let j = 0; j < 4; j++)
        box(position.x - 0.57 + j * 0.38, position.y, position.z, 0.29, 0.14, 0.05, 6);
    }
    box(pole, 1.06, -4.3, 5.65, 1.1, 0.13, 3);
    for (const x of [pole - 2.5, pole + 2.5]) rod([x, 0, -4.3], [x, 1.59, -4.3], 0.033, 1);
    this.template = lists.map((parts) => {
      const merged = mergeGeometries(parts)!;
      parts.forEach((g) => g.dispose());
      return merged;
    });
  }

  private createSector(): Sector {
    const root = new THREE.Group();
    root.name = 'Stadium sector';
    this.root.add(root);
    const structure = this.template.map((geometry, i) => {
      const mesh = new THREE.Mesh(geometry, this.materials[i]);
      mesh.receiveShadow = true;
      // Seats, signs, fixture housings and track markers also occlude the light.
      mesh.castShadow = i <= 5;
      root.add(mesh);
      return mesh;
    });
    const sign = new THREE.Mesh(this.signGeometry, this.signs[0]);
    sign.receiveShadow = true;
    sign.position.set(this.layout.width / 2, 1.06, -4.22);
    root.add(sign);
    const mountain = new THREE.Mesh(this.mountainGeometry, this.mountainMaterial);
    root.add(mountain);
    const glow = new THREE.Sprite(this.glowMaterial);
    glow.name = 'Floodlight glow';
    // Place the corona just in front of its housing, with depth testing so it
    // cannot shine through a ramp, rider or another part of the stadium.
    glow.position.set(this.layout.width / 2, 7.73, -5.18);
    glow.scale.set(3.5, 1.65, 1);
    glow.visible = false;
    root.add(glow);
    const reaction = { value: new THREE.Vector2(-10, 0) };
    const material = crowdMaterial(this.assets, this.clock, reaction, this.reduced);
    const variants: THREE.BufferGeometry[][] = [];
    const people = [0, 1].map((variant) => {
      const geometries = (['high', 'low'] as const).map((q) =>
        this.assets.geometry[q][variant].clone(),
      );
      for (const [name, size] of [
        ['crowdStyle', 4],
        ['crowdSkin', 3],
        ['crowdHair', 3],
      ] as const) {
        const attribute = new THREE.InstancedBufferAttribute(new Float32Array(400 * size), size);
        geometries.forEach((g) => g.setAttribute(name, attribute));
      }
      variants.push(geometries);
      const mesh = new THREE.InstancedMesh(
        geometries[this.quality === 'high' ? 0 : 1],
        material,
        400,
      );
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(400 * 3), 3);
      mesh.name = `Spectators ${variant}`;
      mesh.receiveShadow = true;
      root.add(mesh);
      return mesh;
    });
    const sector = {
      root,
      absolute: Infinity,
      logical: 0,
      signature: 0,
      structure,
      sign,
      mountain,
      glow,
      reaction,
      people,
      material,
      variants,
    };
    this.sectors.push(sector);
    return sector;
  }

  private configure(sector: Sector, absolute: number) {
    const logical = modulo(absolute, this.layout.count),
      seats = sectorSeats(this.layout, logical);
    sector.absolute = absolute;
    sector.logical = logical;
    sector.signature = hash(JSON.stringify(seats));
    sector.root.position.x = absolute * this.layout.width;
    sector.root.visible = true;
    sector.sign.material = this.signs[logical % 2];
    sector.mountain.position.set(this.layout.width / 2, 3, -47 - (logical % 3) * 3);
    sector.mountain.scale.set(1, 0.7 + (logical % 5) * 0.12, 1);
    sector.mountain.rotation.y = logical * 1.27;
    const count = [0, 0];
    for (const seat of seats) {
      if (!seat.occupied) continue;
      const mesh = sector.people[seat.variant],
        i = count[seat.variant]++;
      transform.position.set(seat.x, seat.y, seat.z + (seat.standing ? 0.24 : 0));
      // Feet keep their placement; small variation remains within each seat's footprint.
      transform.rotation.set(0, (seat.phase - 0.5) * 0.12, 0);
      transform.scale.set(seat.scale, seat.scale, seat.scale);
      transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
      mesh.setColorAt(i, SHIRTS[seat.shirt]);
      const style = mesh.geometry.getAttribute('crowdStyle') as THREE.InstancedBufferAttribute;
      const skin = mesh.geometry.getAttribute('crowdSkin') as THREE.InstancedBufferAttribute;
      const hair = mesh.geometry.getAttribute('crowdHair') as THREE.InstancedBufferAttribute;
      style.setXYZW(i, seat.phase, seat.speed, seat.standing ? 1 : 0, seat.clap);
      skin.setXYZ(i, SKIN[seat.skin].r, SKIN[seat.skin].g, SKIN[seat.skin].b);
      hair.setXYZ(i, HAIR[seat.hair].r, HAIR[seat.hair].g, HAIR[seat.hair].b);
    }
    sector.people.forEach((mesh, i) => {
      mesh.count = count[i];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor!.needsUpdate = true;
      for (const name of ['crowdStyle', 'crowdSkin', 'crowdHair'])
        (mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute).needsUpdate = true;
      // Include the whole baked animation envelope, not only the bind pose.
      mesh.boundingBox = new THREE.Box3(
        new THREE.Vector3(0, 0.05, -14.3),
        new THREE.Vector3(this.layout.width, 5.6, -6.4),
      );
      mesh.boundingSphere = mesh.boundingBox.getBoundingSphere(new THREE.Sphere());
    });
  }

  onSimulationStep(race: Race) {
    this.motion.step(race);
  }
  setQuality(quality: CrowdQuality) {
    this.quality = quality;
    this.sectors.forEach((sector) =>
      sector.people.forEach(
        (mesh, i) => (mesh.geometry = sector.variants[i][quality === 'high' ? 0 : 1]),
      ),
    );
  }
  update(
    camera: THREE.OrthographicCamera,
    dt: number,
    race: Race | null,
    mode: string,
    paused: boolean,
    alpha: number,
    reduced: boolean,
    presentationTime?: number,
    shadowBounds?: THREE.Box3,
  ) {
    if (!this.layout) return;
    this.reduced.value = reduced ? 1 : 0;
    if (reduced) this.clock.value = 0;
    else if (presentationTime !== undefined) this.clock.value = presentationTime;
    else if (!paused) {
      if (mode === 'race' && race) {
        if (race.phase === 'finished') {
          this.finishElapsed = Math.min(2, this.finishElapsed + dt);
          this.clock.value = this.motion.time + this.finishElapsed;
        } else
          this.clock.value = Math.max(
            this.clock.value,
            Math.max(0, this.motion.time + (alpha - 1) / HZ),
          );
      } else this.clock.value += dt;
    }
    let { first, last } = visibleSectorRange(camera, this.layout.width);
    if (shadowBounds) {
      first = Math.min(first, Math.floor(shadowBounds.min.x / this.layout.width));
      last = Math.max(last, Math.floor(shadowBounds.max.x / this.layout.width));
    }
    const active = new Map<number, Sector>();
    const spare: Sector[] = [];
    for (const sector of this.sectors) {
      if (sector.absolute >= first && sector.absolute <= last) {
        sector.root.visible = true;
        active.set(sector.absolute, sector);
      } else {
        sector.root.visible = false;
        spare.push(sector);
      }
    }
    for (let absolute = first; absolute <= last; absolute++) {
      let sector = active.get(absolute);
      if (!sector) {
        sector = spare.pop() ?? this.createSector();
        this.configure(sector, absolute);
      }
      const reaction = this.motion.reactions.get(sector.logical);
      sector.reaction.value.set(reaction?.time ?? -10, reaction?.strength ?? 0);
    }
  }
  diagnostics() {
    return {
      time: this.clock.value,
      quality: this.quality,
      layout: this.layout,
      pool: this.sectors.length,
      reactions: [...this.motion.reactions].map(([sector, value]) => ({ sector, ...value })),
      sectors: this.sectors
        .filter((s) => s.root.visible)
        .map((s) => ({
          absolute: s.absolute,
          logical: s.logical,
          x: s.root.position.x,
          signature: s.signature,
          sign: s.logical % 2,
          people: s.people.reduce((n, m) => n + m.count, 0),
        }))
        .sort((a, b) => a.absolute - b.absolute),
    };
  }
  private disposeSector(sector: Sector) {
    this.root.remove(sector.root);
    sector.material.dispose();
    sector.people.forEach((mesh) => mesh.dispose());
    sector.variants.flat().forEach((g) => g.dispose());
  }
  dispose() {
    this.sectors.forEach((s) => this.disposeSector(s));
    this.sectors = [];
    this.template.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.signs.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
    this.signGeometry.dispose();
    this.mountainGeometry.dispose();
    this.mountainMaterial.dispose();
    this.glowMaterial.map?.dispose();
    this.glowMaterial.dispose();
  }
}
