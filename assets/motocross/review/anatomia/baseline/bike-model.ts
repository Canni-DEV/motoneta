import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { BIKE, bikePose, crashPose, type GroundHeight } from './bike-pose';
import rigDefinition from './bike-rig.json';
import { appearanceKey, defaultAppearance, SLOTS, VARIANTS, type Appearance, type SlotId } from './appearance';

export type BikeQuality = 'high' | 'low';
export type BikeAssets = Record<BikeQuality, THREE.Group>;
export interface BikeVisualState {
  readonly time: number;
  readonly paused: boolean;
  readonly speed: number;
  readonly tilt: number;
  readonly grounded: boolean;
  readonly recovery: boolean;
  readonly ground: GroundHeight;
  readonly reducedMotion?: boolean;
  readonly laneMotion?: number;
  readonly lane?: number;
  readonly crashPhase?: 'none' | 'rolling' | 'down' | 'mounting';
  readonly crashPhaseAge?: number;
  readonly crashRollDuration?: number;
  readonly crashKind?: 'impact' | 'backflip';
  readonly crashStartTilt?: number;
}

const requiredNodes = [
  'Chassis',
  'HeadlightAnchor',
  'HeadlightTarget',
  'TaillightAnchor',
  'RearWheel',
  'FrontWheel',
  'Handlebar',
  'FrontFender',
  'Swingarm',
  'RiderRig',
  'Rider',
  'ForkLowerL',
  'ForkUpperL',
  'ForkGuardL',
  'ForkLowerR',
  'ForkUpperR',
  'ForkGuardR',
  'Shock',
  'Spring',
  ...Object.keys(rigDefinition),
];
const CHASSIS_ATTACHMENTS = VARIANTS.flatMap((variant) => [
  ...['seat', 'fairing', 'exhaust', 'plate'].map((slot) => `Slot_${slot}_${variant}`),
  `Slot_fender_${variant}_Rear`,
]);
const RIDER_SUPPORTS = [
  ['Head', 0.17],
  ['Spine', 0.12],
  ['Pelvis', 0.11],
  ['UpperArmL', 0.09],
  ['UpperArmR', 0.09],
  ['ForearmL', 0.06],
  ['ForearmR', 0.06],
  ['HandL', 0.055],
  ['HandR', 0.055],
  ['ThighL', 0.085],
  ['ThighR', 0.085],
  ['ShinL', 0.07],
  ['ShinR', 0.07],
  ['FootL', 0.06],
  ['FootR', 0.06],
] as const;

export function validateBikeAsset(scene: THREE.Group): THREE.Group {
  for (const name of requiredNodes) {
    if (!scene.getObjectByName(name)) throw new Error(`Modelo incompleto: ${name}`);
  }
  for (const slot of SLOTS) for (const variant of VARIANTS)
    if (!scene.getObjectByName(`Slot_${slot}_${variant}`) &&
        !scene.getObjectByName(`Slot_${slot}_${variant}_Front`) &&
        !scene.getObjectByName(`Slot_${slot}_${variant}_FrontWheel`))
      throw new Error(`Modelo incompleto: ${slot}/${variant}`);
  return scene;
}

/** A rejected load can be retried; already loaded assets are retained. */
export function createBikeAssetLoader(fetchAsset: (quality: BikeQuality) => Promise<THREE.Group>) {
  const cache = new Map<BikeQuality, Promise<THREE.Group>>();
  const get = (quality: BikeQuality) => {
    let promise = cache.get(quality);
    if (!promise) {
      promise = fetchAsset(quality)
        .then(validateBikeAsset)
        .catch((error) => {
          cache.delete(quality);
          throw error;
        });
      cache.set(quality, promise);
    }
    return promise;
  };
  return async (): Promise<BikeAssets> => {
    const [high, low] = await Promise.all([get('high'), get('low')]);
    return { high, low };
  };
}

export const loadBikeAssets = createBikeAssetLoader(async (quality) => {
  const gltf = await new GLTFLoader().loadAsync(
    `${import.meta.env.BASE_URL}models/motocross-${quality}.glb`,
  );
  return gltf.scene;
});

const Y = new THREE.Vector3(0, 1, 0);
const unit = new THREE.Vector3(1, 1, 1);
const V = (xyz: readonly number[]) => new THREE.Vector3(xyz[0], xyz[1], xyz[2]);
const rest = Object.fromEntries(
  Object.entries(rigDefinition).map(([name, def]) => [
    name,
    {
      head: V(def.head),
      tail: V(def.tail),
      parent: def.parent,
    },
  ]),
) as Record<string, { head: THREE.Vector3; tail: THREE.Vector3; parent: string | null }>;

/** Analytic two-bone IK with a stable pole and clamped reach. No simulation writes. */
export function solveTwoBone(
  start: THREE.Vector3,
  end: THREE.Vector3,
  upper: number,
  lower: number,
  pole: THREE.Vector3,
): THREE.Vector3 {
  const direction = end.clone().sub(start);
  const actual = direction.length();
  if (actual < 1e-8) direction.copy(Y);
  else direction.divideScalar(actual);
  const distance = THREE.MathUtils.clamp(
    actual,
    Math.abs(upper - lower) + 1e-6,
    upper + lower - 1e-6,
  );
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const bend = pole
    .clone()
    .sub(start)
    .addScaledVector(direction, -pole.clone().sub(start).dot(direction));
  if (bend.lengthSq() < 1e-10) {
    bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
    if (bend.lengthSq() < 1e-10) bend.set(1, 0, 0);
  }
  return start.clone().addScaledVector(direction, along).addScaledVector(bend.normalize(), height);
}

interface BoneBinding {
  node: THREE.Object3D;
  quaternion: THREE.Quaternion;
  parentMatrix: THREE.Matrix4;
  desired: THREE.Matrix4;
}

/** Both quality variants keep their own skeleton; only one is drawn and animated. */
export class Bike {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly riderLayer = new THREE.Group();
  readonly headlight = new THREE.SpotLight('#f5f1df', 0, 10, 0.48, 0.7, 2);
  private readonly lightMount = new THREE.Group();
  readonly variants: Record<BikeQuality, THREE.Group>;
  private bindings!: Record<string, BoneBinding>;
  private nodes!: Record<string, THREE.Object3D>;
  private readonly variantBindings: Record<BikeQuality, Record<string, BoneBinding>>;
  private readonly variantNodes: Record<BikeQuality, Record<string, THREE.Object3D>>;
  private readonly variantRiders: Record<BikeQuality, THREE.Object3D>;
  private readonly ownedMaterials: THREE.Material[] = [];
  private readonly ownedGeometries: THREE.BufferGeometry[] = [];
  private readonly painted: { slot: SlotId; attribute: THREE.BufferAttribute; base: Float32Array }[] = [];
  private readonly contactPoint = new THREE.Vector3();
  private readonly inverseRoot = new THREE.Matrix4();
  quality: BikeQuality;
  wheels: THREE.Object3D[] = [];
  rider!: THREE.Object3D;
  wheelAngle = 0;
  compression = 0;
  private springVelocity = 0;
  private lastTime: number | null = null;
  private elapsed = 0;
  private previousSpeed = 0;
  private previousGrounded: boolean | null = null;
  private acceleration = 0;
  private steering = 0;
  private lastState: BikeVisualState | null = null;
  private appearance = '';
  private ghost = false;
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private ghostMaterials = new Map<THREE.Material, THREE.Material>();

  setAppearance(value: Appearance | number, ghost = false) {
    const appearance = typeof value === 'number'
      ? defaultAppearance(`#${value.toString(16).padStart(6, '0')}`)
      : value;
    const key = `${appearanceKey(appearance)}:${ghost}`;
    if (key === this.appearance) return;
    this.appearance = key;
    this.ghost = ghost;
    for (const part of this.painted) {
      const colors = part.attribute.array as Float32Array;
      const primary = new THREE.Color(appearance.paints[part.slot].primary);
      const accent = new THREE.Color(appearance.paints[part.slot].accent);
      for (let i = 0; i < part.base.length; i += 4) {
        const role = part.base[i + 3];
        const source = role < 0.25 ? primary : role < 0.75 ? accent : null;
        colors[i] = source ? source.r : part.base[i];
        colors[i + 1] = source ? source.g : part.base[i + 1];
        colors[i + 2] = source ? source.b : part.base[i + 2];
        colors[i + 3] = 1;
      }
      part.attribute.needsUpdate = true;
    }
    const faded = (material: THREE.Material) => {
      let copy = this.ghostMaterials.get(material);
      if (!copy) {
        copy = material.clone();
        copy.transparent = true;
        copy.opacity = 0.35;
        copy.depthWrite = false;
        this.ghostMaterials.set(material, copy);
        this.ownedMaterials.push(copy);
      }
      return copy;
    };
    for (const variant of [...Object.values(this.variants), ...Object.values(this.variantRiders)])
      variant.traverse((object) => {
        const match = /^Slot_([^_]+)_(core|sprint|trail)(?:_(?:Front|Rear|FrontWheel|RearWheel))?$/.exec(object.name);
        if (match) object.visible = appearance.parts[match[1] as SlotId] === match[2];
        if (!(object instanceof THREE.Mesh)) return;
        if (!this.originals.has(object)) this.originals.set(object, object.material);
        const original = this.originals.get(object)!;
        object.material = ghost
          ? Array.isArray(original)
            ? original.map(faded)
            : faded(original)
          : original;
        object.castShadow = !ghost;
      });
    for (const material of this.ownedMaterials) {
      const paint = material.userData.paint as { slot: SlotId | 'frame'; role: 'primary' | 'accent' } | undefined;
      if (!paint) continue;
      const color = paint.slot === 'frame'
        ? appearance.paints.fairing.primary
        : appearance.paints[paint.slot][paint.role];
      (material as THREE.MeshStandardMaterial).color.set(color);
    }
  }

  constructor(color: number, assets: BikeAssets, quality: BikeQuality = 'high') {
    // Keep the light outside the blinking model so the renderer's light count stays fixed.
    this.lightMount.matrixAutoUpdate = false;
    this.lightMount.add(this.headlight, this.headlight.target);
    this.root.add(this.body, this.riderLayer, this.lightMount);
    this.quality = quality;
    this.variants = {} as Record<BikeQuality, THREE.Group>;
    this.variantBindings = {} as Record<BikeQuality, Record<string, BoneBinding>>;
    this.variantNodes = {} as Record<BikeQuality, Record<string, THREE.Object3D>>;
    this.variantRiders = {} as Record<BikeQuality, THREE.Object3D>;
    for (const q of ['high', 'low'] as const) {
      const scene = clone(assets[q]) as THREE.Group;
      const colored = new Map<string, THREE.Material>();
      const nodes: Record<string, THREE.Object3D> = {};
      scene.traverse((object) => {
        nodes[object.name] = object;
        if (!(object instanceof THREE.Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
        // Rig motion can exceed the static bind-pose bounding sphere.
        if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false;
        const slot = /^Slot_([^_]+)_/.exec(object.name)?.[1] as SlotId | undefined;
        if (slot) {
          object.geometry = object.geometry.clone();
          this.ownedGeometries.push(object.geometry);
          const exported = object.geometry.getAttribute('color');
          if (!exported || exported.itemSize !== 4)
            throw new Error(`La pieza ${object.name} no tiene paleta RGBA.`);
          const base = new Float32Array(exported.count * 4);
          for (let i = 0; i < exported.count; i++) {
            base[i * 4] = exported.getX(i);
            base[i * 4 + 1] = exported.getY(i);
            base[i * 4 + 2] = exported.getZ(i);
            base[i * 4 + 3] = exported.getW(i);
          }
          const attribute = new THREE.Float32BufferAttribute(base.slice(), 4);
          object.geometry.setAttribute('color', attribute);
          this.painted.push({ slot, attribute, base });
        }
        const tint = (material: THREE.Material) => {
          const primary = /^(TeamPaint|TeamCloth)$/.test(material.name) ||
            (slot === 'seat' && material.name === 'Seat') ||
            (slot === 'exhaust' && material.name === 'Exhaust') ||
            (slot === 'boots' && material.name === 'Boot');
          const accent = material.name === 'TeamAccent' ||
            (slot === 'torso' && material.name === 'Ceramic');
          if (!primary && !accent && !/^Lamp(Front|Rear)$/.test(material.name)) return material;
          const key = `${material.uuid}:${slot ?? 'frame'}:${primary ? 'primary' : accent ? 'accent' : 'lamp'}`;
          if (!colored.has(key)) {
            const instance = material.clone() as THREE.MeshStandardMaterial;
            if (primary || accent) {
              instance.userData.paint = { slot: slot ?? 'frame', role: primary ? 'primary' : 'accent' };
              instance.color.setHex(color);
            } else instance.emissive.set(material.name === 'LampFront' ? '#fff4d8' : '#ff1935');
            colored.set(key, instance);
            this.ownedMaterials.push(instance);
          }
          return colored.get(key)!;
        };
        object.material = Array.isArray(object.material)
          ? object.material.map(tint)
          : tint(object.material);
      });
      scene.updateMatrixWorld(true);
      const bindings: Record<string, BoneBinding> = {};
      for (const name of Object.keys(rest)) {
        const node = nodes[name];
        bindings[name] = {
          node,
          quaternion: node.getWorldQuaternion(new THREE.Quaternion()),
          parentMatrix: node.parent!.matrixWorld.clone(),
          desired: new THREE.Matrix4(),
        };
      }
      this.variants[q] = scene;
      this.variantBindings[q] = bindings;
      this.variantNodes[q] = nodes;
      this.variantRiders[q] = nodes.RiderRig;
      this.riderLayer.add(nodes.RiderRig);
      this.body.add(scene);
    }
    this.setQuality(quality);
    this.reset();
    this.setAppearance(color);
  }

  setQuality(quality: BikeQuality) {
    this.quality = quality;
    this.variants.high.visible = quality === 'high';
    this.variants.low.visible = quality === 'low';
    this.variantRiders.high.visible = quality === 'high';
    this.variantRiders.low.visible = quality === 'low';
    this.nodes = this.variantNodes[quality];
    this.bindings = this.variantBindings[quality];
    this.wheels = [this.nodes.RearWheel, this.nodes.FrontWheel];
    this.rider = this.nodes.RiderRig;
    this.headlight.position.copy(this.nodes.HeadlightAnchor.position);
    this.headlight.target.position.copy(this.nodes.HeadlightTarget.position);
    if (this.lastState) this.applyPose(this.lastState);
  }

  reset() {
    this.body.visible = true;
    this.riderLayer.visible = true;
    this.wheelAngle =
      this.compression =
      this.springVelocity =
      this.elapsed =
      this.acceleration =
      this.steering =
        0;
    this.previousSpeed = 0;
    this.previousGrounded = null;
    this.lastTime = null;
    this.lastState = null;
    this.applyPose({
      time: 0,
      paused: false,
      speed: 0,
      tilt: 0,
      grounded: true,
      recovery: false,
      ground: () => 0,
    });
  }

  setLighting(level: number) {
    const lit = this.root.visible && level > 0 && !this.ghost;
    this.headlight.visible = lit;
    this.headlight.intensity = lit ? level * 28 * this.root.scale.x ** 2 : 0;
    this.headlight.distance = 10 * this.root.scale.x;
    for (const material of this.ownedMaterials) {
      if (material.name === 'LampFront' || material.name === 'LampRear')
        (material as THREE.MeshStandardMaterial).emissiveIntensity =
          level * (material.name === 'LampFront' ? 6 : 3);
    }
  }

  update(state: BikeVisualState) {
    const dt =
      this.lastTime === null ? 0 : THREE.MathUtils.clamp(state.time - this.lastTime, 0, 0.04);
    this.lastTime = state.time;
    if (state.paused && this.lastState) return;
    this.elapsed += dt;
    if (dt > 0) {
      const accel = THREE.MathUtils.clamp((state.speed - this.previousSpeed) / dt, -4, 4);
      this.acceleration = THREE.MathUtils.damp(this.acceleration, accel, 9, dt);
      if (this.previousGrounded === false && state.grounded && !state.recovery)
        this.springVelocity += 0.42;
      const road =
        state.grounded && !state.recovery && !state.reducedMotion
          ? Math.sin(this.elapsed * 27) * Math.min(state.speed, 3.5) * 0.0015
          : 0;
      const target = (state.grounded ? 0.012 : -0.018) + road;
      this.springVelocity += ((target - this.compression) * 140 - this.springVelocity * 17) * dt;
      this.compression = THREE.MathUtils.clamp(
        this.compression + this.springVelocity * dt,
        -0.025,
        0.055,
      );
      if (!state.recovery || state.crashPhase === 'rolling')
        this.wheelAngle -= dt * state.speed * 10.5;
      this.steering = THREE.MathUtils.damp(
        this.steering,
        state.recovery ? 0 : THREE.MathUtils.clamp(state.laneMotion ?? 0, -1, 1),
        13,
        dt,
      );
    }
    this.previousGrounded = state.grounded;
    this.previousSpeed = state.speed;
    this.lastState = state;
    this.applyPose(state);
  }

  private bone(name: string, head: THREE.Vector3, tail: THREE.Vector3) {
    const binding = this.bindings[name];
    const definition = rest[name];
    const quaternion = new THREE.Quaternion()
      .setFromUnitVectors(
        definition.tail.clone().sub(definition.head).normalize(),
        tail.clone().sub(head).normalize(),
      )
      .multiply(binding.quaternion);
    binding.desired.compose(head, quaternion, unit);
    const parent = definition.parent
      ? this.bindings[definition.parent].desired
      : binding.parentMatrix;
    const local = parent.clone().invert().multiply(binding.desired);
    local.decompose(binding.node.position, binding.node.quaternion, binding.node.scale);
  }

  private segment(name: string, start: THREE.Vector3, end: THREE.Vector3) {
    const node = this.nodes[name];
    const direction = end.clone().sub(start);
    node.position.copy(start);
    node.scale.set(1, direction.length(), 1);
    node.quaternion.setFromUnitVectors(Y, direction.normalize());
  }

  /** Lift the posed rig until its helmet, body and limbs clear the local track profile. */
  private riderSupportY(ground: GroundHeight) {
    this.riderLayer.position.y = 0;
    this.riderLayer.updateWorldMatrix(true, true);
    const toRoot = this.inverseRoot.copy(this.root.matrixWorld).invert();
    const point = this.contactPoint;
    let floor = -Infinity;
    for (const [name, radius] of RIDER_SUPPORTS) {
      point.setFromMatrixPosition(this.nodes[name].matrixWorld).applyMatrix4(toRoot);
      floor = Math.max(floor, ground(point.x) + radius - point.y);
    }
    // Clearance for the garment/boot envelope beyond the bone support spheres.
    return floor + 0.052;
  }

  private applyPose(state: BikeVisualState) {
    const crashed = !!state.crashPhase && state.crashPhase !== 'none';
    const pose = crashed
      ? crashPose(
          {
            crashPhase: state.crashPhase!,
            crashPhaseAge: state.crashPhaseAge ?? 0,
            crashRollDuration: state.crashRollDuration ?? 40,
            crashKind: state.crashKind ?? 'impact',
            crashStartTilt: state.crashStartTilt ?? 0,
            lane: state.lane ?? 1.5,
          },
          state.ground,
          state.reducedMotion,
        )
      : null;
    const riding = crashed ? null : bikePose(state.tilt, state.grounded, state.ground);
    const lateralRoll = crashed ? 0 : this.steering * Math.min(1, state.speed / 2) * 0.14;
    this.body.position.set(pose?.x ?? riding!.x, pose?.y ?? riding!.y, pose?.z ?? 0);
    this.body.rotation.set(pose?.roll ?? lateralRoll, 0, pose?.pitch ?? state.tilt);
    if (pose) this.riderLayer.rotation.set(pose.riderRoll, 0, pose.riderPitch);
    else this.riderLayer.rotation.copy(this.body.rotation);
    this.wheels.forEach((wheel) => {
      wheel.rotation.set(0, 0, this.wheelAngle);
    });
    const suspension = crashed ? 0 : this.compression;
    const steer = crashed ? 0 : -this.steering * 0.21;
    const steerPivot = new THREE.Vector3(0.324, 0.89 - suspension, 0);
    const steered = (point: THREE.Vector3) =>
      point.sub(steerPivot).applyAxisAngle(Y, steer).add(steerPivot);
    this.nodes.Handlebar.position.copy(steerPivot);
    this.nodes.Handlebar.rotation.y = steer;
    this.nodes.FrontFender.position.copy(steerPivot);
    this.nodes.FrontFender.rotation.y = steer;
    this.nodes.FrontWheel.position.copy(steered(new THREE.Vector3(BIKE.frontX, BIKE.axleY, 0)));
    this.nodes.FrontWheel.rotation.y = steer;
    this.nodes.Chassis.position.y = -suspension;
    // These interchangeable meshes are exported at the scene root. Keep their
    // common mounting surface on the chassis through compression, for every option.
    for (const name of CHASSIS_ATTACHMENTS) this.nodes[name].position.y = -suspension;
    // Follow the posed chassis in root coordinates, including while the model is hidden.
    this.nodes.Chassis.updateWorldMatrix(true, false);
    this.lightMount.matrix
      .copy(this.root.matrixWorld)
      .invert()
      .multiply(this.nodes.Chassis.matrixWorld);
    this.lightMount.matrixWorldNeedsUpdate = true;
    for (const [side, suffix] of [
      [-1, 'R'],
      [1, 'L'],
    ] as const) {
      const axle = steered(new THREE.Vector3(BIKE.frontX, BIKE.axleY, side * 0.089));
      const top = steered(new THREE.Vector3(0.324, 0.89 - suspension, side * 0.089));
      const joint = axle.clone().lerp(top, 0.47);
      this.segment(`ForkLower${suffix}`, axle, joint);
      this.segment(`ForkUpper${suffix}`, joint, top);
      this.nodes[`ForkGuard${suffix}`].position.copy(
        steered(new THREE.Vector3(BIKE.frontX - 0.011, BIKE.axleY + 0.032, side * 0.089)),
      );
      this.nodes[`ForkGuard${suffix}`].rotation.y = steer;
    }
    const pivot = new THREE.Vector3(-0.1, 0.407 - suspension, 0);
    const rear = new THREE.Vector3(BIKE.rearX, BIKE.axleY, 0);
    const restSwing = new THREE.Vector3(BIKE.rearX + 0.1, BIKE.axleY - 0.407, 0);
    const swing = rear.clone().sub(pivot);
    this.nodes.Swingarm.position.copy(pivot);
    this.nodes.Swingarm.quaternion.setFromUnitVectors(
      restSwing.clone().normalize(),
      swing.clone().normalize(),
    );
    this.nodes.Swingarm.scale.setScalar(swing.length() / restSwing.length());
    this.segment(
      'Shock',
      new THREE.Vector3(-0.32, 0.342, 0),
      new THREE.Vector3(-0.245, 0.699 - suspension, 0),
    );
    this.segment(
      'Spring',
      new THREE.Vector3(-0.3, 0.432, 0),
      new THREE.Vector3(-0.256, 0.639 - suspension, 0),
    );

    const airborne = !state.grounded && !state.recovery;
    const riderAcceleration = pose ? 0 : this.acceleration;
    const lean =
      state.recovery && !pose?.riderSeat ? 0 : THREE.MathUtils.clamp(state.tilt, -0.7, 1.1);
    const rideWeight = pose ? Math.max(0, 1 - pose.riderCurl - pose.riderStand) : 1;
    const rideHip = rest.Pelvis.head
      .clone()
      .add(
        new THREE.Vector3(
          -0.025 * lean + riderAcceleration * 0.003,
          // The pelvis follows the suspended seat; compression must not push it through the foam.
          -suspension + (airborne ? 0.038 : 0),
          0,
        ),
      );
    const fallHip = new THREE.Vector3(-0.22, 0.8, 0);
    const standHip = rest.Pelvis.head.clone().add(new THREE.Vector3(0, (pose?.riderStep ?? 0) * 0.018, 0));
    const hip = rideHip
      .multiplyScalar(rideWeight)
      .addScaledVector(fallHip, pose?.riderCurl ?? 0)
      .addScaledVector(standHip, pose?.riderStand ?? 0);
    const rideTorso = rest.Spine.tail.clone().sub(rest.Spine.head);
    rideTorso.applyAxisAngle(
      new THREE.Vector3(0, 0, 1),
      -lean * 0.09 - (airborne ? 0.1 : 0) - riderAcceleration * 0.012,
    );
    const fallTorso = rest.Spine.tail
      .clone()
      .sub(rest.Spine.head)
      .applyAxisAngle(new THREE.Vector3(0, 0, 1), -0.48);
    const standTorso = rest.Spine.tail.clone().sub(rest.Spine.head);
    const torsoDirection = rideTorso
      .multiplyScalar(rideWeight)
      .addScaledVector(fallTorso, pose?.riderCurl ?? 0)
      .addScaledVector(standTorso, pose?.riderStand ?? 0);
    const chest = hip.clone().add(torsoDirection);
    const spineDelta = new THREE.Quaternion().setFromUnitVectors(
      rest.Spine.tail.clone().sub(rest.Spine.head).normalize(),
      torsoDirection.clone().normalize(),
    );
    const onTorso = (p: THREE.Vector3) =>
      p.clone().sub(rest.Pelvis.head).applyQuaternion(spineDelta).add(hip);
    this.bone('Pelvis', hip, hip.clone().add(rest.Pelvis.tail.clone().sub(rest.Pelvis.head)));
    this.bone('Spine', hip, chest);
    const head = onTorso(rest.Head.head);
    const headDirection = rest.Head.tail
      .clone()
      .sub(rest.Head.head)
      .applyAxisAngle(
        new THREE.Vector3(0, 0, 1),
        -lean * 0.18 * rideWeight - 0.32 * (pose?.riderCurl ?? 0),
      );
    this.bone('Head', head, head.clone().add(headDirection));
    for (const suffix of ['R', 'L']) {
      const upper = rest[`UpperArm${suffix}`],
        fore = rest[`Forearm${suffix}`];
      const shoulder = onTorso(upper.head);
      const side = suffix === 'L' ? 1 : -1;
      const hand = steered(fore.tail.clone().add(new THREE.Vector3(0, -suspension, 0)))
        .multiplyScalar(rideWeight)
        .addScaledVector(new THREE.Vector3(0.12, 0.65, side * 0.24), pose?.riderCurl ?? 0)
        .addScaledVector(new THREE.Vector3(-0.07, 0.67, side * 0.18), pose?.riderStand ?? 0);
      const elbow = solveTwoBone(
        shoulder,
        hand,
        upper.head.distanceTo(upper.tail),
        fore.head.distanceTo(fore.tail),
        onTorso(upper.tail),
      );
      this.bone(`UpperArm${suffix}`, shoulder, elbow);
      this.bone(`Forearm${suffix}`, elbow, hand);
      this.bone(
        `Hand${suffix}`,
        hand,
        hand.clone().add(rest[`Hand${suffix}`].tail.clone().sub(rest[`Hand${suffix}`].head)),
      );
      const thigh = rest[`Thigh${suffix}`],
        shin = rest[`Shin${suffix}`];
      const thighHead = thigh.head.clone().sub(rest.Pelvis.head).add(hip);
      const ankle = shin.tail
        .clone()
        .add(new THREE.Vector3(0, -suspension, 0))
        .multiplyScalar(rideWeight)
        .addScaledVector(new THREE.Vector3(-0.05, 0.42, side * 0.18), pose?.riderCurl ?? 0)
        .addScaledVector(
          new THREE.Vector3(-0.21 + side * (pose?.riderStep ?? 0) * 0.11, 0.4, side * 0.17),
          pose?.riderStand ?? 0,
        );
      const mounting = state.crashPhase === 'mounting' && pose;
      const mountArc = mounting ? Math.sin(Math.PI * pose.riderSeat) : 0;
      const mountingSide = (state.lane ?? 1.5) < 1.5 ? -1 : 1;
      // Swing the far boot over the saddle while the near leg supports the mount.
      if (mounting && side !== mountingSide) {
        ankle.y += 0.65 * mountArc;
        ankle.x -= 0.38 * mountArc;
      }
      const knee = solveTwoBone(
        thighHead,
        ankle,
        thigh.head.distanceTo(thigh.tail),
        shin.head.distanceTo(shin.tail),
        thigh.tail.clone().add(new THREE.Vector3(
          side !== mountingSide ? -0.45 * mountArc : 0,
          -suspension + (side !== mountingSide ? 0.15 * mountArc : 0), 0)),
      );
      this.bone(`Thigh${suffix}`, thighHead, knee);
      this.bone(`Shin${suffix}`, knee, ankle);
      this.bone(
        `Foot${suffix}`,
        ankle,
        ankle.clone().add(rest[`Foot${suffix}`].tail.clone().sub(rest[`Foot${suffix}`].head)),
      );
    }
    if (pose) {
      if (pose.riderSeat >= 1) this.riderLayer.position.copy(this.body.position);
      else {
        const orientedHip = hip.clone().applyEuler(this.riderLayer.rotation);
        const groundX = pose.riderHipX - orientedHip.x;
        const groundZ = pose.riderHipZ - orientedHip.z;
        this.riderLayer.position.set(
          THREE.MathUtils.lerp(groundX, this.body.position.x, pose.riderSeat),
          0,
          THREE.MathUtils.lerp(groundZ, this.body.position.z, pose.riderSeat),
        );
        const support = this.riderSupportY(state.ground);
        this.riderLayer.position.y = Math.max(
          support,
          THREE.MathUtils.lerp(support, this.body.position.y, pose.riderSeat),
        );
        if (state.crashPhase === 'mounting') {
          const side = (state.lane ?? 1.5) < 1.5 ? -1 : 1;
          const seated = pose.riderSeat;
          const across = THREE.MathUtils.smoothstep(seated, 0.25, 1);
          const beside = this.body.position.z + Math.sin(this.body.rotation.x) * 0.95 + side * 0.62 - orientedHip.z;
          this.riderLayer.position.z = THREE.MathUtils.lerp(groundZ, beside, 1 - pose.riderCurl) * (1 - across)
            + this.body.position.z * across;
          // Rise beside the bike before crossing the seat, then settle onto its surface.
          this.riderLayer.position.y = Math.max(support,
            THREE.MathUtils.lerp(support, this.body.position.y, THREE.MathUtils.smoothstep(seated, 0, 0.35))
            + 0.2 * Math.sin(Math.PI * seated));
        } else if (state.crashPhase === 'rolling') {
          const side = (state.lane ?? 1.5) < 1.5 ? -1 : 1;
          const separation = Math.sin(Math.PI * THREE.MathUtils.clamp((state.crashPhaseAge ?? 0) / 10, 0, 1));
          // Clear the saddle vertically before the separating legs cross its centerline.
          const lateral = THREE.MathUtils.smoothstep(state.crashPhaseAge ?? 0, 1, 2);
          this.riderLayer.position.z += side * 0.9 * separation * lateral;
          this.riderLayer.position.y += 0.5 * separation;
        }
      }
    } else this.riderLayer.position.copy(this.body.position);
  }

  dispose() {
    this.headlight.dispose();
    this.ownedMaterials.forEach((material) => material.dispose());
    this.ownedGeometries.forEach((geometry) => geometry.dispose());
    for (const variant of Object.values(this.variantRiders)) {
      const skeletons = new Set<THREE.Skeleton>();
      variant.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
      });
      skeletons.forEach((skeleton) => skeleton.dispose());
    }
    this.root.removeFromParent();
  }
}
