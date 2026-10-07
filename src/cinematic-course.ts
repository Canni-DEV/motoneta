import * as THREE from 'three';
import type { CoursePiece } from './rendering/course';
import { disposeTerrainInstances, setTerrainQuality } from './rendering/terrain';
import type { Settings } from './core/types';

/** Bounded lap copies share track geometry/materials and own only their instance buffers. */
export class CinematicCourse {
  private readonly copies = new Map<CoursePiece, THREE.Group[]>();
  private readonly box = new THREE.Box3();
  private readonly frustum = new THREE.Frustum();
  private readonly matrix = new THREE.Matrix4();
  private readonly batched = new Map<CoursePiece, boolean>();
  private readonly parents = new Map<CoursePiece, THREE.Object3D>();
  private readonly templates = new Map<CoursePiece, THREE.Group>();
  private readonly ownedGeometry = new Set<THREE.BufferGeometry>();
  private readonly vertex = new THREE.Vector3();
  private sameGeometry(a: THREE.BufferGeometry, b: THREE.BufferGeometry) {
    if (a === b) return true;
    if (a.drawRange.start !== b.drawRange.start || a.drawRange.count !== b.drawRange.count ||
      JSON.stringify(a.groups) !== JSON.stringify(b.groups)) return false;
    const names = Object.keys(a.attributes);
    if (names.length !== Object.keys(b.attributes).length) return false;
    const sameAttribute = (x: THREE.BufferAttribute | null, y: THREE.BufferAttribute | null) => {
      if (!x || !y) return x === y;
      if (!(x instanceof THREE.BufferAttribute) || !(y instanceof THREE.BufferAttribute) ||
        x.itemSize !== y.itemSize || x.normalized !== y.normalized || x.array.length !== y.array.length) return false;
      for (let i = 0; i < x.array.length; i++) if (x.array[i] !== y.array[i]) return false;
      return true;
    };
    return sameAttribute(a.index, b.index) && names.every(name =>
      sameAttribute(a.attributes[name] as THREE.BufferAttribute, b.attributes[name] as THREE.BufferAttribute));
  }
  private batches(group: THREE.Group) {
    const geometries: THREE.BufferGeometry[] = [];
    const batches = new Map<string, THREE.Mesh[]>();
    for (const child of group.children) {
      if (!(child instanceof THREE.Mesh) || child.type !== 'Mesh' || Array.isArray(child.material) ||
        Object.keys(child.geometry.morphAttributes).length || child.scale.x * child.scale.y * child.scale.z < 0) continue;
      // Ramp lanes have equal exported buffers even when their geometry objects differ.
      const geometry = geometries.find(geometry => this.sameGeometry(geometry, child.geometry)) ?? child.geometry;
      if (!geometries.includes(geometry)) geometries.push(geometry);
      const key = `${geometry.uuid}:${child.material.uuid}:${child.castShadow}:${child.receiveShadow}:${child.renderOrder}:${child.visible}:${child.layers.mask}`;
      const batch = batches.get(key) ?? [];
      batch.push(child);
      batches.set(key, batch);
    }
    return batches;
  }
  private clone(piece: CoursePiece) {
    const cached = this.templates.get(piece);
    if (cached) return cached.clone(true);
    const group = piece.group.clone(true);
    for (const meshes of this.batches(group).values()) {
      if (meshes.length < 3) continue;
      const source = meshes[0];
      const instance = new THREE.InstancedMesh(source.geometry, source.material, meshes.length);
      instance.castShadow = source.castShadow;
      instance.receiveShadow = source.receiveShadow;
      instance.renderOrder = source.renderOrder;
      instance.visible = source.visible;
      instance.layers.mask = source.layers.mask;
      meshes.forEach((mesh, i) => {
        mesh.updateMatrix();
        instance.setMatrixAt(i, mesh.matrix);
        mesh.removeFromParent();
      });
      instance.computeBoundingBox();
      instance.computeBoundingSphere();
      group.add(instance);
    }
    // The four lane borders differ only in placement and have equal line styles.
    // A shared segment buffer preserves their contours without four separate draws.
    const lines = new Map<string, THREE.Line[]>();
    for (const child of group.children) {
      if (!(child instanceof THREE.Line) || child.type !== 'Line' ||
        !(child.material instanceof THREE.LineBasicMaterial) || child.geometry.index || child.geometry.groups.length ||
        Object.keys(child.geometry.attributes).some(name => name !== 'position')) continue;
      const m = child.material;
      const key = `${m.color.getHex()}:${m.opacity}:${m.transparent}:${m.linewidth}:${m.blending}:${m.depthTest}:${m.depthWrite}:${m.vertexColors}:${child.visible}:${child.layers.mask}:${child.renderOrder}`;
      const batch = lines.get(key) ?? [];
      batch.push(child); lines.set(key, batch);
    }
    for (const batch of lines.values()) {
      if (batch.length < 2) continue;
      const count = batch.reduce((sum, line) => sum + (line.geometry.getAttribute('position').count - 1) * 2, 0);
      const positions = new Float32Array(count * 3);
      let offset = 0;
      for (const line of batch) {
        line.updateMatrix();
        const points = line.geometry.getAttribute('position');
        for (let i = 1; i < points.count; i++) for (const end of [i - 1, i]) {
          this.vertex.fromBufferAttribute(points, end).applyMatrix4(line.matrix).toArray(positions, offset);
          offset += 3;
        }
        line.removeFromParent();
      }
      const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(positions, 3));
      this.ownedGeometry.add(geometry);
      const border = new THREE.LineSegments(geometry, batch[0].material);
      border.visible = batch[0].visible;
      border.layers.mask = batch[0].layers.mask;
      border.renderOrder = batch[0].renderOrder;
      group.add(border);
    }
    this.templates.set(piece, group);
    return group;
  }
  update(pieces: CoursePiece[], camera: THREE.PerspectiveCamera, focus: number, loop: number, shadows: THREE.Box3) {
    camera.updateMatrixWorld();
    this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    // Never populate beyond the camera's finite clipping range (plus relevant shadows).
    const min = Math.min(camera.position.x - camera.far, shadows.min.x);
    const max = Math.max(camera.position.x + camera.far, shadows.max.x);
    for (const piece of pieces) {
      if (!this.batched.has(piece)) this.batched.set(piece, [...this.batches(piece.group).values()].some(meshes => meshes.length >= 3));
      const parent = piece.group.parent ?? this.parents.get(piece)!;
      if (this.batched.get(piece) && piece.group.parent) {
        this.parents.set(piece, parent);
        piece.group.removeFromParent();
      }
      const center = piece.base + (piece.bounds.min.x + piece.bounds.max.x) / 2;
      const nearest = Math.round((focus - center) / loop);
      const first = Math.ceil((min - piece.base - piece.bounds.max.x) / loop);
      const last = Math.floor((max - piece.base - piece.bounds.min.x) / loop);
      let used = 0;
      piece.group.visible = false;
      const copies = this.copies.get(piece) ?? [];
      for (let lap = first; lap <= last; lap++) {
        const x = piece.base + lap * loop;
        this.box.copy(piece.bounds);
        this.box.min.x += x;
        this.box.max.x += x;
        if (!this.frustum.intersectsBox(this.box) && !shadows.intersectsBox(this.box)) continue;
        let group = piece.group;
        if (lap !== nearest || this.batched.get(piece)) {
          group = copies[used] ??= this.clone(piece);
          if (!group.parent) parent.add(group);
          used++;
        }
        group.position.x = x;
        group.visible = true;
      }
      for (let i = used; i < copies.length; i++) {
        copies[i].visible = false;
        copies[i].removeFromParent();
      }
      if (copies.length) this.copies.set(piece, copies);
    }
  }
  hide() {
    for (const copies of this.copies.values()) for (const copy of copies) {
      copy.visible = false;
      copy.removeFromParent();
    }
    for (const [piece, parent] of this.parents) if (!piece.group.parent) parent.add(piece.group);
  }
  setQuality(quality: Settings['quality']) {
    for (const copies of this.copies.values()) for (const copy of copies) setTerrainQuality(copy, quality);
  }
  clear() {
    this.hide();
    for (const copies of this.copies.values()) for (const copy of copies) {
      copy.removeFromParent();
      disposeTerrainInstances(copy);
    }
    this.copies.clear();
    this.batched.clear();
    this.parents.clear();
    this.templates.clear();
    for (const geometry of this.ownedGeometry) geometry.dispose();
    this.ownedGeometry.clear();
  }
}
