import * as THREE from 'three';
import type { Settings } from '../core/types';
import { TRACK_LIFE, VFX_LIMITS, vfxSettings } from './config';
import { VfxModel } from './model';

/** Original 3x3 atlas, regenerated identically on load; no network resources. */
export function particleAtlas() {
  const cell = 64,
    width = cell * 3,
    bytes = new Uint8Array(width * width * 4);
  for (let kind = 0; kind < 9; kind++)
    for (let y = 0; y < cell; y++)
      for (let x = 0; x < cell; x++) {
        const u = ((x + 0.5) / cell) * 2 - 1,
          v = ((y + 0.5) / cell) * 2 - 1;
        const noise =
          0.84 + 0.09 * Math.sin(u * 17 + Math.sin(v * 13)) + 0.07 * Math.cos(v * 21 + u * 9);
        const d = Math.hypot(u, v);
        let a = 0;
        if (kind === 0 || kind === 5 || kind === 6) a = Math.max(0, 1 - d * noise) ** 2 * noise;
        else if (kind === 1)
          a = Number(Math.abs(u) * 0.8 + Math.abs(v) < 0.75 + Math.sin(u * 9) * 0.08);
        else if (kind === 2) a = Math.max(0, 1 - Math.hypot(u * 3, v * 1.1)) ** 1.5;
        else if (kind === 3) a = Math.max(0, 1 - d) * noise;
        else if (kind === 4) a = Number(Math.abs(u + v * 0.3) < 0.2 && Math.abs(v) < 0.8);
        else if (kind === 7)
          a = Math.max(0, 1 - Math.abs(u)) ** 1.5 * Math.max(0, 1 - Math.abs(v) * 14);
        else a = Math.max(0, 1 - Math.abs(d - 0.65) * 15);
        const i = ((Math.floor(kind / 3) * cell + y) * width + (kind % 3) * cell + x) * 4;
        bytes[i] = bytes[i + 1] = bytes[i + 2] = 255;
        bytes[i + 3] = Math.round(Math.min(1, a) * 255);
      }
  const texture = new THREE.DataTexture(bytes, width, width);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export class VfxRenderer {
  readonly particles: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  readonly tracks: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly atlas = particleAtlas();
  private particleRevision = -1;
  private particleTime = -1;
  private trackRevision = -1;
  private readonly births = new Float32Array(512 * 6);
  private readonly centers = new Float32Array(512 * 6);
  private readonly tints = new Float32Array(512 * 18);
  private readonly uniforms = {
    time: { value: 0 },
    focus: { value: 0 },
    loop: { value: 1 },
    light: { value: new THREE.Color(1, 1, 1) },
    protection: { value: new THREE.Vector4(2, 2, 3, 3) },
    fogColor: { value: new THREE.Color() },
    fogRange: { value: new THREE.Vector2(43, 120) },
  };
  constructor(
    scene: THREE.Scene,
    private model: VfxModel,
  ) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3),
    );
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    for (const [name, data, size] of [
      ['originTime', model.origins, 4],
      ['velocityLife', model.velocities, 4],
      ['style', model.styles, 4],
      ['forces', model.forces, 4],
      ['tint', model.colors, 3],
    ] as const)
      g.setAttribute(
        name,
        new THREE.InstancedBufferAttribute(new Float32Array(data.length), size).setUsage(
          THREE.StreamDrawUsage,
        ),
      );
    const material = new THREE.ShaderMaterial({
      uniforms: { ...this.uniforms, atlas: { value: this.atlas } },
      vertexShader: `
        attribute vec4 originTime, velocityLife, style, forces;
        attribute vec3 tint;
        uniform float time, focus, loop;
        uniform vec4 protection;
        varying vec2 atlasUv;
        varying vec3 particleColor;
        varying float opacity, depth;
        void main() {
          float age = time-originTime.w, life = velocityLife.w;
          if (style.x <= 0.0 || age < 0.0 || age >= life) { gl_Position=vec4(2.,2.,2.,1.); opacity=0.; return; }
          float progress=age/life;
          vec3 p=originTime.xyz+velocityLife.xyz*age;
          p.xz += forces.xy*age*age*.5;
          p.y=max(forces.w+.016,p.y-forces.z*age*age*.5);
          p.x += floor((focus-p.x)/loop+.5)*loop;
          vec4 center=modelViewMatrix*vec4(p,1.);
          float cloud=1.0-step(.5,style.y);
          cloud=max(cloud,step(4.5,style.y)*(1.-step(6.5,style.y)));
          float scale=style.x*(1.+cloud*progress*1.9);
          float angle=style.z+age*(1.-cloud)*.6;
          vec2 corner=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*position.xy*scale;
          if(style.y>6.5 && style.y<7.5) corner=position.xy*scale;
          if(style.y>7.5) center=modelViewMatrix*vec4(p+vec3(corner.x,0.,corner.y)*(1.+progress),1.);
          else center.xy+=corner;
          gl_Position=projectionMatrix*center;
          vec2 screen=gl_Position.xy/gl_Position.w;
          float coverage=step(protection.x,screen.x)*step(screen.x,protection.z)*step(protection.y,screen.y)*step(screen.y,protection.w);
          opacity=style.w*smoothstep(0.,.08,progress)*(1.-smoothstep(.45,1.,progress))*(1.-coverage*cloud*.68);
          atlasUv=(vec2(mod(style.y,3.),floor(style.y/3.))+.015+uv*.97)/3.;
          particleColor=tint; depth=-center.z;
        }`,
      fragmentShader: `
        uniform sampler2D atlas;
        uniform vec3 light, fogColor;
        uniform vec2 fogRange;
        varying vec2 atlasUv;
        varying vec3 particleColor;
        varying float opacity, depth;
        void main() {
          float a=texture2D(atlas,atlasUv).a*opacity;
          if(a<.005) discard;
          vec3 c=mix(particleColor*light,fogColor,smoothstep(fogRange.x,fogRange.y,depth));
          gl_FragColor=vec4(c,a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.particles = new THREE.Mesh(g, material);
    this.particles.name = 'Race and ambient particles';
    this.particles.frustumCulled = false;
    this.particles.renderOrder = 2;
    const tg = new THREE.BufferGeometry();
    tg.setAttribute(
      'position',
      new THREE.BufferAttribute(model.trackPositions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    tg.setAttribute(
      'birth',
      new THREE.BufferAttribute(this.births, 1).setUsage(THREE.DynamicDrawUsage),
    );
    tg.setAttribute(
      'center',
      new THREE.BufferAttribute(this.centers, 1).setUsage(THREE.DynamicDrawUsage),
    );
    tg.setAttribute(
      'tint',
      new THREE.BufferAttribute(this.tints, 3).setUsage(THREE.DynamicDrawUsage),
    );
    const uv = new Float32Array(512 * 12),
      one = [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1];
    for (let i = 0; i < 512; i++) uv.set(one, i * 12);
    tg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    this.tracks = new THREE.Mesh(
      tg,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: `attribute float birth, center; attribute vec3 tint; uniform float time,focus,loop; varying float opacity; varying vec3 markColor; varying vec2 markUv;
        void main(){ vec3 p=position; p.x+=floor((focus-center)/loop+.5)*loop; float age=time-birth;
        opacity=step(0.,age)*(1.-smoothstep(5.,${TRACK_LIFE.toFixed(1)},age))*.45;
        markColor=tint; markUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.); }`,
        fragmentShader: `uniform vec3 light; varying float opacity; varying vec3 markColor; varying vec2 markUv;
        void main(){ float edge=smoothstep(0.,.15,markUv.x)*(1.-smoothstep(.85,1.,markUv.x));
        float tread=.7+.3*step(.4,fract(markUv.y*5.+markUv.x*.8));
        float a=opacity*edge*tread; if(a<.005)discard; gl_FragColor=vec4(markColor*light,a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      }),
    );
    this.tracks.name = 'Temporary tire marks';
    this.tracks.frustumCulled = false;
    this.tracks.renderOrder = 1;
    scene.add(this.particles, this.tracks);
  }
  update(
    time: number,
    focus: number,
    settings: Settings,
    reduced: boolean,
    light: THREE.Color,
    fog: THREE.Fog,
    protection: THREE.Vector4,
  ) {
    const u = this.uniforms,
      limit = VFX_LIMITS[settings.quality],
      groups = vfxSettings(settings);
    u.time.value = time;
    u.focus.value = focus;
    u.loop.value = this.model.track.length * 0.052;
    u.light.value.copy(light);
    u.fogColor.value.copy(fog.color);
    u.fogRange.value.set(fog.near, fog.far);
    u.protection.value.copy(protection);
    this.particles.visible = !reduced && (groups.race || groups.ambient);
    this.tracks.visible = groups.tracks;
    this.tracks.geometry.setDrawRange(0, limit.tracks * 6);
    if (this.particleRevision !== this.model.particleRevision || this.particleTime !== time) {
      // Compact live instances into fixed staging buffers. Inactive slots never reach the GPU;
      // the simulation pool and deterministic slot identities remain independent of rendering.
      const sources = [
        this.model.origins,
        this.model.velocities,
        this.model.styles,
        this.model.forces,
        this.model.colors,
      ];
      const attributes = ['originTime', 'velocityLife', 'style', 'forces', 'tint'].map(
        (name) => this.particles.geometry.getAttribute(name) as THREE.InstancedBufferAttribute,
      );
      let count = 0;
      for (let i = 0; i < limit.particles; i++) {
        const o = i * 4;
        if (
          !this.model.styles[o] ||
          time < this.model.origins[o + 3] ||
          time >= this.model.origins[o + 3] + this.model.velocities[o + 3]
        )
          continue;
        for (let a = 0; a < attributes.length; a++) {
          const { array, itemSize } = attributes[a];
          for (let c = 0; c < itemSize; c++)
            array[count * itemSize + c] = sources[a][i * itemSize + c];
        }
        count++;
      }
      this.particles.geometry.instanceCount = count;
      for (const attribute of attributes) {
        attribute.clearUpdateRanges();
        if (count) attribute.addUpdateRange(0, count * attribute.itemSize);
        attribute.needsUpdate = true;
      }
      this.particleRevision = this.model.particleRevision;
      this.particleTime = time;
    }
    if (this.trackRevision !== this.model.trackRevision) {
      for (let i = 0; i < limit.tracks; i++)
        for (let j = 0; j < 6; j++) {
          this.births[i * 6 + j] = this.model.trackBirth[i];
          this.centers[i * 6 + j] =
            (this.model.trackPositions[i * 18] + this.model.trackPositions[i * 18 + 15]) * 0.5;
          this.tints.set(this.model.trackColors.subarray(i * 3, i * 3 + 3), i * 18 + j * 3);
        }
      for (const name of ['position', 'birth', 'center', 'tint'])
        this.tracks.geometry.getAttribute(name).needsUpdate = true;
      this.trackRevision = this.model.trackRevision;
    }
  }
  dispose() {
    for (const mesh of [this.particles, this.tracks]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    this.atlas.dispose();
  }
}
