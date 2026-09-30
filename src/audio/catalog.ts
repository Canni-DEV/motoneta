import type { AudioBus } from '../core/types';
import type { Material } from '../presentation-material';
export { materialFor, landingLevel } from '../presentation-material';
export type { Material } from '../presentation-material';
export type AudioScene = 'menu' | 'editor' | 'countdown' | 'race' | 'cinematic' | 'pause' | 'results';
export type UiCue =
  | 'select'
  | 'confirm'
  | 'back'
  | 'error'
  | 'open'
  | 'close'
  | 'place'
  | 'move'
  | 'remove'
  | 'duplicate'
  | 'undo'
  | 'redo'
  | 'saved'
  | 'imported';
export type AudioCueId =
  | `ui-${UiCue}`
  | `land-${0 | 1 | 2}-${0 | 1 | 2}`
  | `crash-${0 | 1 | 2}`
  | `scrape-${0 | 1}`
  | `roll-${Material}`
  | `touch-${Material}`
  | `engine-${'idle' | 'mid' | 'high'}`
  | `cheer-${0 | 1 | 2}`
  | 'bump'
  | 'jump'
  | 'wind'
  | 'air'
  | 'crowd'
  | 'rain'
  | 'countdown'
  | 'start'
  | 'overheat'
  | 'cool'
  | 'recovered'
  | 'recovery'
  | 'turbo'
  | 'lap'
  | 'last-lap'
  | 'finish'
  | 'dnf'
  | 'record'
  | 'victory'
  | 'podium';
export interface SoundRequest {
  id: AudioCueId;
  gain?: number;
  pan?: number;
  delay?: number;
  priority?: number;
}
export const BUS_LABELS: Record<AudioBus, string> = {
  engines: 'Motores',
  effects: 'Efectos de carrera',
  ambience: 'Ambiente',
  ui: 'Interfaz',
  music: 'Música',
};
export const busFor = (id: AudioCueId): AudioBus =>
  id.startsWith('ui-')
    ? 'ui'
    : id.startsWith('engine-')
      ? 'engines'
      : ['crowd', 'rain', 'wind', 'air'].includes(id) || id.startsWith('cheer-')
        ? 'ambience'
        : 'effects';
export function relativeSound(x: number, playerX: number, length: number) {
  const dx = ((((x - playerX + length / 2) % length) + length) % length) - length / 2;
  return {
    pan: Math.max(-0.75, Math.min(0.75, dx / 240)),
    gain: Math.max(0, 1 - Math.abs(dx) / 440) ** 2 * 0.32,
  };
}
export const variation = (frame: number, rider: number, count: number) =>
  ((Math.imul(frame + 1, 1103515245) ^ Math.imul(rider + 1, 2654435761)) >>> 0) % count;
