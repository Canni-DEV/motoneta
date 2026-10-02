import { isTimeOfDay } from './core/time-of-day';
import {
  defaultAudioLevels,
  defaultSettings,
  defaultVfxSettings,
  type AudioBus,
  type Settings,
} from './core/types';
import { isWeather } from './core/weather';
import { GAME_ID, SETTINGS_KEY } from './identity';
const read = (): unknown => {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null');
  } catch {
    return null;
  }
};
export function writeSettings(value: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function settings(): Settings {
  // Old preferences belong to the ruleset that was intentionally reset.
  try {
    localStorage.removeItem(`${GAME_ID}.settings`);
    localStorage.removeItem(`${GAME_ID}.settings.v2`);
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  const s = read() as Partial<Settings> | null;
  const out = {
    ...defaultSettings,
    audioLevels: { ...defaultAudioLevels },
    vfx: { ...defaultVfxSettings },
    bindings: { ...defaultSettings.bindings },
  };
  if (!s) return out;
  if (isTimeOfDay(s.timeOfDay)) out.timeOfDay = s.timeOfDay;
  if (isWeather(s.weather)) out.weather = s.weather;
  if (typeof s.volume === 'number' && Number.isFinite(s.volume))
    out.volume = Math.min(1, Math.max(0, s.volume));
  if (s.quality === 'low' || s.quality === 'high') out.quality = s.quality;
  if (s.surfaceDetail === 'light' || s.surfaceDetail === 'detailed')
    out.surfaceDetail = s.surfaceDetail;
  for (const key of ['race', 'tracks', 'ambient'] as const)
    if (typeof s.vfx?.[key] === 'boolean') out.vfx[key] = s.vfx[key];
  if (s.vfx && ['subtle', 'balanced', 'strong'].includes(s.vfx.intensity))
    out.vfx.intensity = s.vfx.intensity;
  for (const key of ['bloom', 'cameraShake', 'reducedMotion', 'attractReplays'] as const)
    if (typeof s[key] === 'boolean') out[key] = s[key];
  for (const key of Object.keys(defaultAudioLevels) as AudioBus[]) {
    const value = s.audioLevels?.[key];
    if (typeof value === 'number' && Number.isFinite(value))
      out.audioLevels[key] = Math.min(1, Math.max(0, value));
  }
  if (s.bindings && typeof s.bindings === 'object')
    for (const key of Object.keys(out.bindings))
      if (typeof s.bindings[key] === 'string' && s.bindings[key].length < 32)
        out.bindings[key] = s.bindings[key];
  return out;
}
export function download(name: string, value: unknown) {
  const u = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
    ),
    a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
