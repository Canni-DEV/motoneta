import * as THREE from 'three';

export type CrowdQuality = 'high' | 'low';
interface CharacterData {
  position: number[];
  normal: number[];
  joint: number[];
  region: number[];
  ao: number[];
  index: number[];
}
export interface CrowdAssets {
  geometry: Record<CrowdQuality, THREE.BufferGeometry[]>;
  animation: THREE.DataTexture;
}

export function crowdGeometry(data: CharacterData): THREE.BufferGeometry {
  const count = data.position?.length / 3;
  if (
    !Number.isInteger(count) ||
    count <= 0 ||
    data.normal?.length !== count * 3 ||
    data.joint?.length !== count ||
    data.region?.length !== count ||
    data.ao?.length !== count ||
    !data.index?.length ||
    data.index.length % 3 !== 0 ||
    Object.values(data).some((a) => !Array.isArray(a) || a.some((n) => !Number.isFinite(n))) ||
    data.index.some((i) => !Number.isInteger(i) || i < 0 || i >= count) ||
    data.joint.some((i) => !Number.isInteger(i) || i < 0 || i >= 10) ||
    data.region.some((i) => !Number.isInteger(i) || i < 0 || i > 4)
  ) {
    throw new Error('Geometría del público inválida');
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
  geometry.setAttribute('crowdJoint', new THREE.Float32BufferAttribute(data.joint, 1));
  geometry.setAttribute('crowdRegion', new THREE.Float32BufferAttribute(data.region, 1));
  geometry.setAttribute('crowdAO', new THREE.Float32BufferAttribute(data.ao, 1));
  geometry.setIndex(data.index);
  geometry.computeBoundingSphere();
  return geometry;
}

export function createCrowdAssetLoader(read: (name: string) => Promise<ArrayBuffer>) {
  const cache = new Map<string, Promise<ArrayBuffer>>();
  let ready: Promise<CrowdAssets> | undefined;
  function get(name: string) {
    let pending = cache.get(name);
    if (!pending) {
      pending = read(name).catch((error) => {
        cache.delete(name);
        throw error;
      });
      cache.set(name, pending);
    }
    return pending;
  }
  return (): Promise<CrowdAssets> =>
    (ready ??= Promise.all(['high.json', 'low.json', 'animation.bin'].map(get))
      .then(([high, low, binary]) => {
        const geometry: Record<CrowdQuality, THREE.BufferGeometry[]> = { high: [], low: [] };
        try {
          for (const [i, quality] of (['high', 'low'] as const).entries()) {
            try {
              const data = JSON.parse(new TextDecoder().decode([high, low][i]));
              if (data.version !== 1 || data.characters?.length !== 2)
                throw new Error('Formato del público inválido');
              for (const character of data.characters)
                geometry[quality].push(crowdGeometry(character));
            } catch (error) {
              cache.delete(`${quality}.json`);
              throw error;
            }
          }
          if (
            binary.byteLength !== 40 * 192 * 4 * 4 ||
            new Float32Array(binary).some((n) => !Number.isFinite(n))
          ) {
            cache.delete('animation.bin');
            throw new Error('Animación del público inválida');
          }
          const animation = new THREE.DataTexture(
            new Float32Array(binary),
            40,
            192,
            THREE.RGBAFormat,
            THREE.FloatType,
          );
          // Torso and legs keep their posture in every clip. Bake those transforms
          // once instead of spending vertex texture fetches on stationary joints.
          const bones = new Float32Array(binary),
            matrix = new THREE.Matrix4();
          const point = new THREE.Vector3(),
            normal = new THREE.Vector3();
          for (const g of Object.values(geometry).flat()) {
            const positions = g.getAttribute('position'),
              normals = g.getAttribute('normal'),
              joints = g.getAttribute('crowdJoint');
            const seated = new Float32Array(positions.count * 3),
              seatedNormals = new Float32Array(positions.count * 3);
            for (let i = 0; i < positions.count; i++) {
              matrix.fromArray(bones, joints.getX(i) * 16);
              point
                .fromBufferAttribute(positions, i)
                .applyMatrix4(matrix)
                .toArray(seated, i * 3);
              normal
                .fromBufferAttribute(normals, i)
                .transformDirection(matrix)
                .toArray(seatedNormals, i * 3);
            }
            g.setAttribute('crowdSeatedPosition', new THREE.BufferAttribute(seated, 3));
            g.setAttribute('crowdSeatedNormal', new THREE.BufferAttribute(seatedNormals, 3));
          }
          animation.minFilter = animation.magFilter = THREE.NearestFilter;
          animation.needsUpdate = true;
          return { geometry, animation };
        } catch (error) {
          Object.values(geometry)
            .flat()
            .forEach((g) => g.dispose());
          throw error;
        }
      })
      .catch((error) => {
        ready = undefined;
        throw error;
      }));
}

export const loadCrowdAssets = createCrowdAssetLoader(async (name) => {
  const response = await fetch(`${import.meta.env.BASE_URL}models/crowd/${name}`);
  if (!response.ok) throw new Error(`No se pudo cargar el público (${response.status})`);
  return response.arrayBuffer();
});

/** Owns no skeletons. Bone matrices are sampled from a single immutable animation texture. */
export function crowdMaterial(
  assets: CrowdAssets,
  clock: { value: number },
  reaction: { value: THREE.Vector2 },
  reduced: { value: number },
) {
  const material = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.92 });
  material.customProgramCacheKey = () => 'stadium-baked-bones-v6-perspective';
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      crowdAnimation: { value: assets.animation },
      crowdTime: clock,
      crowdReaction: reaction,
      crowdReduced: reduced,
    });
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `
      #include <common>
      uniform sampler2D crowdAnimation;
      uniform float crowdTime;
      uniform vec2 crowdReaction;
      uniform float crowdReduced;
      attribute float crowdJoint;
      attribute float crowdRegion;
      attribute float crowdAO;
      attribute vec4 crowdStyle;
      attribute vec3 crowdSkin;
      attribute vec3 crowdHair;
      attribute vec3 crowdSeatedPosition;
      attribute vec3 crowdSeatedNormal;
      varying vec3 crowdTint;
      mat4 crowdFrame(float frame, float clip) {
        int row = int(crowdStyle.z * 96.0 + clip * 32.0 + mod(frame, 32.0));
        int col = int(crowdJoint) * 4;
        return mat4(texelFetch(crowdAnimation, ivec2(col,row),0),
          texelFetch(crowdAnimation,ivec2(col+1,row),0),
          texelFetch(crowdAnimation,ivec2(col+2,row),0),
          texelFetch(crowdAnimation,ivec2(col+3,row),0));
      }
      mat4 crowdClip(float clip, float cycle) {
        float f = fract(cycle) * 32.0;
        return crowdFrame(floor(f),clip)*(1.0-fract(f)) + crowdFrame(floor(f)+1.0,clip)*fract(f);
      }
    `,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <beginnormal_vertex>',
      `
      float cycle = crowdStyle.x + crowdTime * crowdStyle.y;
      float cheer=0., startle=0.;
      if (crowdReaction.y != 0. && crowdReduced < .5) {
        float age = crowdTime - crowdReaction.x - crowdStyle.x*.18;
        if (crowdReaction.y > 0.) cheer = smoothstep(0.0,.22,age) * (1.0-smoothstep(1.35,2.0,age)) * crowdReaction.y;
        else startle = smoothstep(0.0,.12,age)*(1.0-smoothstep(.35,1.0,age))*(-crowdReaction.y);
      }
      float baseClip = crowdStyle.w > .5 && startle < .01 ? 1.0 : 0.0;
      bool fixedJoint = crowdJoint < .5 || crowdJoint > 5.5;
      mat4 pose = mat4(1.0);
      vec3 objectNormal;
      if (fixedJoint) objectNormal = mix(crowdSeatedNormal,normal,crowdStyle.z);
      else {
        pose = crowdClip(baseClip,cycle);
        if (cheer > .001) pose = pose*(1.0-cheer) + crowdClip(2.0,cycle)*cheer;
        objectNormal = normalize(mat3(pose)*normal);
      }
      bool recoiling = !fixedJoint && startle > .001;
      vec2 recoilSC=vec2(0.,1.);
      if (recoiling) {
        float recoilAngle=startle*(crowdJoint>1.5&&crowdJoint<5.5 ? -.65 : .2);
        float c=cos(recoilAngle), s=sin(recoilAngle);
        recoilSC=vec2(s,c);
        objectNormal.yz=vec2(objectNormal.y*c-objectNormal.z*s,objectNormal.y*s+objectNormal.z*c);
      }
    `,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
      vec3 transformed = fixedJoint ? mix(crowdSeatedPosition,position,crowdStyle.z) : (pose * vec4(position,1.0)).xyz;
      if (recoiling) {
        vec2 pivot=vec2(mix(.68,.9,crowdStyle.z),0.);
        vec2 yz=transformed.yz-pivot;
        transformed.yz=vec2(yz.x*recoilSC.y-yz.y*recoilSC.x,yz.x*recoilSC.x+yz.y*recoilSC.y)+pivot;
      }
      vec3 shirt = instanceColor;
      crowdTint = crowdRegion < .5 ? crowdSkin : crowdRegion < 1.5 ? shirt :
        crowdRegion < 2.5 ? mix(vec3(.024,.032,.045),shirt*.3,.25) :
        crowdRegion < 3.5 ? crowdHair : vec3(.40,.42,.43);
      crowdTint *= crowdAO;
    `,
    );
    // instanceColor is a clothing palette, not a tint applied to skin as well.
    shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '');
    // A sector can straddle the screen edge. Skip bone texture reads for its offscreen people.
    shader.vertexShader = shader.vertexShader.replace(
      'void main() {',
      `void main() {
      vec4 anchor = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(0.0,.8,0.0,1.0);
      // Homogeneous clip space: the visible edge is +/-w for a perspective camera.
      // Two world units include the full standing/animated silhouette at screen edges.
      vec2 padding = abs(vec2(projectionMatrix[0][0],projectionMatrix[1][1]))*2.0;
      if (anchor.w > 0.0 && (abs(anchor.x) > anchor.w+padding.x || abs(anchor.y) > anchor.w+padding.y)) {
        gl_Position = vec4(2.0,2.0,2.0,1.0); return;
      }
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 crowdTint;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      'diffuseColor.rgb *= crowdTint;',
    );
  };
  return material;
}
