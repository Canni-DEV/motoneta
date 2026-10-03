import type { Settings } from '../core/types';

/** Apply the existing image/effect form fields; the caller owns rendering and saving. */
export function applyImageSetting(el: HTMLInputElement, settings: Settings): boolean {
  if (el.id === 'quality') settings.quality = el.value as 'high' | 'low';
  if (el.id === 'surface-detail')
    settings.surfaceDetail = el.value as Settings['surfaceDetail'];
  if (el.dataset.vfx && ['race', 'tracks', 'ambient'].includes(el.dataset.vfx)) {
    settings.vfx[el.dataset.vfx as 'race' | 'tracks' | 'ambient'] = el.checked;
  }
  if (el.id === 'vfx-intensity')
    settings.vfx.intensity = el.value as Settings['vfx']['intensity'];
  if (['bloom', 'cameraShake', 'reducedMotion', 'attractReplays'].includes(el.id))
    (settings as unknown as Record<string, unknown>)[el.id] = el.checked;
  return [
    'quality', 'surface-detail', 'bloom', 'vfx-race', 'vfx-tracks', 'vfx-ambient',
    'vfx-intensity', 'cameraShake', 'reducedMotion', 'attractReplays',
  ].includes(el.id);
}
