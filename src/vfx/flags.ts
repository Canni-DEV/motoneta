import * as THREE from 'three';
import type { Track } from '../core/types';
import { stadiumLayout, modulo, type StadiumLayout } from '../stadium-layout';
import { visibleSectorRange } from '../stadium';
import { windAt } from './config';

/** Two global instance batches, independent of how many stadium sectors are visible. */
export class StadiumFlags {
  readonly cloth: THREE.InstancedMesh;
  readonly poles: THREE.InstancedMesh;
  private layout!: StadiumLayout;
  private first = Infinity;
  private last = Infinity;
  private transform = new THREE.Object3D();
  private time = { value: 0 };
  private wind = { value: new THREE.Vector2() };
  private moving = { value: 1 };
  private argentina = new THREE.InstancedBufferAttribute(new Float32Array(128), 1);
  private readonly depth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
  constructor(scene: THREE.Scene) {
    const material = new THREE.MeshStandardMaterial({
      color: '#f2e3c4',
      roughness: 0.92,
      side: THREE.DoubleSide,
    });
    const deform: THREE.Material['onBeforeCompile'] = (shader) => {
      Object.assign(shader.uniforms, {
        flagTime: this.time,
        flagWind: this.wind,
        flagMoving: this.moving,
      });
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float flagTime,flagMoving; uniform vec2 flagWind;
        float flap(vec3 p){float phase=instanceMatrix[3].x*.41;
          return (sin(p.x*5.-flagTime*4.+phase)*.10*p.x+sin(p.x*9.-flagTime*6.+phase)*.035*p.x)*(.6+abs(flagWind.x));}`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        transformed.z+=flagMoving*(flap(position)+flagWind.y*position.x);
        transformed.y-=position.x*.045;`,
      );
    };
    // The shadow silhouette must use the same wind and droop as the visible cloth.
    this.depth.onBeforeCompile = deform;
    material.onBeforeCompile = (shader, renderer) => {
      deform(shader, renderer);
      Object.assign(shader.uniforms, {
        argentinaBlue: { value: new THREE.Color('#74acdf') },
        argentinaWhite: { value: new THREE.Color('#ffffff') },
        argentinaGold: { value: new THREE.Color('#f6b40e') },
      });
      shader.vertexShader = '#define USE_UV\n' + shader.vertexShader;
      shader.fragmentShader = '#define USE_UV\n' + shader.fragmentShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        attribute float flagArgentina; varying float vFlagArgentina;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
        vFlagArgentina=flagArgentina;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
        varying float vFlagArgentina;
        uniform vec3 argentinaBlue,argentinaWhite,argentinaGold;`,
      );
      shader.vertexShader = shader.vertexShader.replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
        float dz=(flap(position+vec3(.01,0.,0.))-flap(position-vec3(.01,0.,0.)))*50.+flagWind.y;
        objectNormal=normalize(vec3(-dz*flagMoving,.045,1.));`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float stripe=smoothstep(.46,.48,vUv.y)*(1.-smoothstep(.61,.63,vUv.y));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.92,.88,.73),stripe*.82);
        if(vFlagArgentina>.5){
          float aa=max(fwidth(vUv.y),.0001);
          float whiteBand=1.-smoothstep(1./6.-aa,1./6.+aa,abs(vUv.y-.5));
          // Tall flags measure 1.2 by .6, so compensate UVs for a round sun.
          vec2 sunUV=(vUv-.5)*vec2(2.,1.);
          float sunDistance=length(sunUV);
          float angle=atan(sunUV.y,sunUV.x+.00001);
          float sunRadius=.065+.045*pow(max(cos(angle*16.),0.),3.);
          float sunEdge=sunDistance-sunRadius;
          float sunAA=max(fwidth(sunEdge),.0001);
          float sunMask=1.-smoothstep(-sunAA,sunAA,sunEdge);
          // Keep the central disc solid where angular derivatives become large.
          float discAA=max(fwidth(sunDistance),.0001);
          sunMask=max(sunMask,1.-smoothstep(.065-discAA,.065+discAA,sunDistance));
          // Replace the base tint; these uniforms are already in linear color space.
          diffuseColor.rgb=mix(mix(argentinaBlue,argentinaWhite,whiteBand),argentinaGold,sunMask);
        }`,
      );
    };
    // USE_UV keeps the shader pattern independent of an external texture.
    const plane = new THREE.PlaneGeometry(1, 0.6, 12, 4);
    plane.translate(0.5, 0, 0);
    plane.setAttribute('flagArgentina', this.argentina);
    this.cloth = new THREE.InstancedMesh(plane, material, 128);
    this.cloth.customDepthMaterial = this.depth;
    this.cloth.name = 'Wind flags and banners';
    this.poles = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.027, 0.034, 1, 5),
      new THREE.MeshStandardMaterial({ color: '#c3c3b7', roughness: 0.65, metalness: 0.35 }),
      128,
    );
    this.poles.name = 'Flag supports';
    this.cloth.castShadow = this.poles.castShadow = true;
    this.cloth.receiveShadow = this.poles.receiveShadow = true;
    this.cloth.frustumCulled = this.poles.frustumCulled = false;
    this.cloth.count = this.poles.count = 0;
    scene.add(this.cloth, this.poles);
  }
  setTrack(track: Track) {
    this.layout = stadiumLayout(track);
    this.first = Infinity;
  }
  update(
    camera: THREE.Camera,
    time: number,
    seed: number,
    staticPose: boolean,
    shadowBounds?: THREE.Box3,
  ) {
    if (!this.layout) return;
    this.time.value = time;
    const wind = windAt(time, seed);
    this.wind.value.set(wind.x, wind.z);
    this.moving.value = staticPose ? 0 : 1;
    const range = visibleSectorRange(camera as THREE.OrthographicCamera, this.layout.width);
    if (shadowBounds) {
      range.first = Math.min(range.first, Math.floor(shadowBounds.min.x / this.layout.width));
      range.last = Math.max(range.last, Math.floor(shadowBounds.max.x / this.layout.width));
    }
    if (range.first === this.first && range.last === this.last) return;
    this.first = range.first;
    this.last = range.last;
    let n = 0;
    const color = new THREE.Color();
    for (let sector = range.first; sector <= range.last && n < 128; sector++)
      for (let side = 0; side < 2 && n < 128; side++) {
        const logical = modulo(sector, this.layout.count),
          banner = side === 1;
        const x = (sector + (banner ? 0.67 : 0.15)) * this.layout.width,
          y = banner ? 1.15 : 3.05,
          z = banner ? -5.95 : -6.2;
        this.transform.position.set(x, y, z);
        this.transform.scale.set(banner ? 2.1 : 1.2, banner ? 0.75 : 1, 1);
        this.transform.updateMatrix();
        this.cloth.setMatrixAt(n, this.transform.matrix);
        color.set((logical + side) % 2 ? '#375b70' : '#b3363c');
        this.cloth.setColorAt(n, color);
        this.argentina.setX(n, !banner && logical % 2 === 0 ? 1 : 0);
        this.transform.position.set(x, y / 2, z);
        this.transform.scale.set(1, y + 0.32, 1);
        this.transform.updateMatrix();
        this.poles.setMatrixAt(n, this.transform.matrix);
        n++;
      }
    this.cloth.count = this.poles.count = n;
    this.cloth.instanceMatrix.needsUpdate = this.poles.instanceMatrix.needsUpdate = true;
    this.argentina.needsUpdate = true;
    if (this.cloth.instanceColor) this.cloth.instanceColor.needsUpdate = true;
  }
  dispose() {
    this.depth.dispose();
    for (const mesh of [this.cloth, this.poles]) {
      mesh.removeFromParent();
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    }
  }
}
