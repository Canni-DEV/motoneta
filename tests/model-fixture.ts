import { readFile } from 'node:fs/promises';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateBikeAsset, type BikeAssets } from '../src/bike-model';
import type { VehicleId } from '../src/appearance';

const pending: Partial<Record<VehicleId, Promise<BikeAssets>>> = {};
export function modelAssets(vehicle: VehicleId = 'motocross') {
  return (pending[vehicle] ??= Promise.all(
    (['high', 'low'] as const).map(async (quality) => {
      const buffer = await readFile(
        new URL(`../public/models/${vehicle}-${quality}.glb`, import.meta.url),
      );
      const data = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ) as ArrayBuffer;
      return validateBikeAsset((await new GLTFLoader().parseAsync(data, '')).scene);
    }),
  ).then(([high, low]) => ({ high, low })));
}
