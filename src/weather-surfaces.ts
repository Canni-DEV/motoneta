import * as THREE from 'three';
import type { Settings } from './core/types';
import { WORLD_SCALE } from './world-space';

export type SurfaceProfile = 'track' | 'dirt' | 'field' | 'mud' | 'grass' | 'cool' | 'bump' | 'sand' | 'gravel';

// Darkening, wet soil roughness, locally wetter roughness; snow coverage,
// existing wheel compaction, transverse texture scale. Appearance only.
const profiles: Record<
  SurfaceProfile,
  { wet: [number, number, number]; snow: [number, number, number] }
> = {
  track: { wet: [0.22, 0.88, 0.64], snow: [0.97, 0.3, 1] },
  dirt: { wet: [0.24, 0.86, 0.66], snow: [0.94, 0.22, 1] },
  field: { wet: [0.15, 0.94, 0.8], snow: [0.99, 0, 0.23] },
  mud: { wet: [0.18, 0.82, 0.62], snow: [0.28, 0.08, 1] },
  grass: { wet: [0.14, 0.94, 0.82], snow: [0.48, 0.1, 1] },
  cool: { wet: [0.08, 0.64, 0.52], snow: [0.1, 0, 1] },
  bump: { wet: [0.22, 0.88, 0.68], snow: [0.85, 0.2, 1] },
  sand: { wet: [0.21, 0.91, 0.81], snow: [0.40, 0.15, 1] },
  gravel: { wet: [0.13, 0.80, 0.63], snow: [0.38, 0.1, 1] },
};

/** One seamless, deterministic data texture: moisture, snow, compaction, grain. */
export function weatherControlTexture() {
  const width = 512,
    height = 256;
  const data = new Uint8Array(width * height * 4);
  const tau = Math.PI * 2;
  let seed = 421;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    const lane = Math.floor(v * 4),
      across = (v * 4) % 1;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const grain = seed / 4294967296;
      const broad =
        0.5 +
        0.24 * Math.sin(tau * (u + v * 2)) +
        0.16 * Math.cos(tau * (u * 3 - v)) +
        0.1 * Math.sin(tau * (u * 7 + v * 5));
      const moisture = THREE.MathUtils.smoothstep(broad, 0.62, 0.91);
      const drift = 0.025 * Math.sin(tau * (u * 2 + lane / 4));
      let compact = 0;
      for (let groove = 0; groove < 3; groove++) {
        const center = 0.3 + groove * 0.19;
        const distance = (across - center - drift) / 0.075;
        compact = Math.max(
          compact,
          Math.exp(-distance * distance) * (0.62 + 0.3 * Math.sin(tau * (u * 3 + lane / 4)) ** 2),
        );
      }
      const i = (y * width + x) * 4;
      data[i] = Math.round(moisture * 255);
      data[i + 1] = Math.round((0.82 + broad * 0.18) * 255);
      data[i + 2] = Math.round(compact * 255);
      data[i + 3] = Math.round(grain * 255);
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.name = 'Shared weather surface controls';
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

interface SurfaceMaterial {
  material: THREE.MeshStandardMaterial;
  temporary: boolean;
}

/** Appearance only. Weather changes only uniforms; clear uses the original material. */
export class WeatherSurfaces {
  private materials: SurfaceMaterial[] = [];
  private trackTextures: THREE.Texture[] = [];
  private detail: Settings['surfaceDetail'] = 'detailed';
  readonly control = weatherControlTexture();
  readonly rain = { value: 0 };
  readonly snow = { value: 0 };
  readonly coordinates = { value: new THREE.Vector2(1 / 15, 1 / 4.88) };
  private readonly snowColor = { value: new THREE.Color('#dce5e8') };

  /** Cache one program per detail level; weather changes never compile a variant. */
  setDetail(detail: Settings['surfaceDetail']) {
    if (detail === this.detail) return;
    this.detail = detail;
    for (const entry of this.materials) entry.material.needsUpdate = true;
  }

  /** An integer number of repeats makes both sides of every lap meet exactly. */
  setTrack(length: number) {
    const worldLength = Math.max(WORLD_SCALE, length * WORLD_SCALE);
    this.coordinates.value.x = Math.max(1, Math.round(worldLength / 15)) / worldLength;
  }

  register(
    material: THREE.MeshStandardMaterial,
    { profile, temporary = false }: { profile: SurfaceProfile; temporary?: boolean },
  ) {
    const settings = profiles[profile];
    this.materials.push({ material, temporary });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.weatherRain = this.rain;
      shader.uniforms.weatherSnow = this.snow;
      shader.uniforms.weatherCoordinates = this.coordinates;
      shader.uniforms.weatherControl = { value: this.control };
      shader.uniforms.weatherSnowColor = this.snowColor;
      shader.uniforms.weatherWet = { value: new THREE.Vector3(...settings.wet) };
      shader.uniforms.weatherSnowProfile = { value: new THREE.Vector3(...settings.snow) };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec2 weatherCoordinates;
          uniform vec3 weatherSnowProfile;
          varying vec2 vWeatherUv;
          varying float vWeatherUp;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec3 weatherPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
          #ifdef USE_INSTANCING
          weatherPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          #endif
          vWeatherUv = vec2(weatherPosition.x * weatherCoordinates.x,
            0.5 - weatherPosition.z * weatherCoordinates.y * weatherSnowProfile.z);
          vec3 weatherNormal = inverseTransformDirection(transformedNormal, viewMatrix);
          vWeatherUp = smoothstep(0.25, 0.85, weatherNormal.y);`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vWeatherUv;
          varying float vWeatherUp;
          uniform float weatherRain, weatherSnow;
          uniform sampler2D weatherControl;
          uniform vec3 weatherWet, weatherSnowProfile, weatherSnowColor;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float weatherPatch = 0.0;
          float weatherCover = 0.0;
          if (weatherRain + weatherSnow > 0.0) {
            vec4 controls = ${this.detail === 'detailed' ? 'texture2D(weatherControl, vWeatherUv)' : 'vec4(0.18, 0.90, 0.0, 0.5)'};
            if (weatherRain > 0.0) {
              weatherPatch = controls.r * vWeatherUp;
              diffuseColor.rgb *= 1.0 - weatherRain * (weatherWet.x + weatherPatch * 0.10);
            }
            if (weatherSnow > 0.0) {
              float compact = controls.b * weatherSnowProfile.y;
              weatherCover = vWeatherUp * weatherSnow * weatherSnowProfile.x *
                max(0.0, controls.g - compact);
            ${
              profile === 'track'
                ? `// Reuse the already sampled albedo to preserve the actual lane dashes.
            float laneMark = smoothstep(0.42, 0.60, sampledDiffuseColor.r);
            weatherCover *= 1.0 - laneMark * 0.78;`
                : ''
            }
            vec3 snowTint = weatherSnowColor * (0.88 + controls.a * 0.12 - compact * 0.42);
            diffuseColor.rgb = mix(diffuseColor.rgb, snowTint, weatherCover);
            }
          }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          if (weatherRain > 0.0) roughnessFactor = mix(roughnessFactor, mix(weatherWet.y, weatherWet.z, weatherPatch), weatherRain);
          if (weatherSnow > 0.0) roughnessFactor = mix(roughnessFactor, 0.96, weatherCover);`,
        );
    };
    material.customProgramCacheKey = () =>
      `weather-surface-v2-${profile === 'track' ? 'road' : 'solid'}-${this.detail}`;
    return material;
  }
  ownTrackTexture<T extends THREE.Texture>(texture: T): T {
    this.trackTextures.push(texture);
    return texture;
  }

  clearTrack() {
    this.trackTextures.forEach((texture) => texture.dispose());
    this.trackTextures = [];
    this.materials = this.materials.filter((entry) => {
      if (!entry.temporary) return true;
      entry.material.onBeforeCompile = () => {};
      entry.material.customProgramCacheKey = THREE.Material.prototype.customProgramCacheKey;
      return false;
    });
  }

  update(rain: number, snow: number) {
    this.rain.value = rain;
    this.snow.value = snow;
  }

  dispose() {
    this.trackTextures.forEach((texture) => texture.dispose());
    this.trackTextures = [];
    for (const entry of this.materials) {
      entry.material.onBeforeCompile = () => {};
      entry.material.customProgramCacheKey = THREE.Material.prototype.customProgramCacheKey;
    }
    this.materials = [];
    this.control.dispose();
  }
}
