import { BUS_LABELS } from '../audio/catalog';
import { DIFFICULTIES, type Difficulty, type PlayerProfile } from '../core/game';
import { TIME_LABELS, TIMES_OF_DAY } from '../core/time-of-day';
import type { Settings, TimeOfDay, Weather } from '../core/types';
import { WEATHER_LABELS, WEATHERS } from '../core/weather';
import { GAME_LOGO } from '../identity';
import { keyLabel } from '../input';
import { escapeHtml as esc } from '../storage';
export { esc };
export const button = (action: string, label: string, value = '', attrs = '') =>
  `<button type="button" data-action="${action}" data-value="${esc(value)}" data-focus-key="${action}:${esc(value)}" ${attrs}>${label}</button>`;
export function select(
  id: string,
  label: string,
  value: string | number,
  options: [string | number, string][],
  attrs = '',
) {
  return `<label>${label}<select id="${id}" ${attrs}>${options.map(([v, l]) => `<option value="${esc(String(v))}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
}
export const difficultyField = (value: Difficulty) =>
  select('difficulty', 'Dificultad', value, Object.entries(DIFFICULTIES));
export function environmentFields(time: TimeOfDay, weather: Weather) {
  return `<fieldset class="time-field"><legend>Hora</legend><div class="time-select">${TIMES_OF_DAY.map((t) => button('time-of-day', TIME_LABELS[t], t, `aria-pressed="${t === time}"`)).join('')}</div></fieldset><fieldset class="weather-field"><legend>Clima</legend><div class="time-select">${WEATHERS.map((w) => button('weather', WEATHER_LABELS[w], w, `aria-pressed="${w === weather}"`)).join('')}</div></fieldset>`;
}
export const modeNames = {
  quick: 'Carrera rápida',
  tournament: 'Torneo',
  versus: 'Versus',
  records: 'Tus marcas',
  editor: 'Editor',
};
export function modeScene(name: string) {
  const image = new URL(`${import.meta.env.BASE_URL}branding/mode-${name}.svg`, document.baseURI);
  return `<img class="mode-scene" src="${image.href}" alt="" aria-hidden="true" draggable="false">`;
}
export function header(active: string, profiles: PlayerProfile[], selected: string) {
  const profile = profiles.find((p) => p.id === selected);
  return `<header class="topbar" data-key="topbar"><div class="brand-group">${active === 'home' ? '' : button('back', icon('back'), '', 'class="icon-button" aria-label="Volver"')}${button('home', GAME_LOGO, '', 'class="brand" aria-label="Inicio"')}</div><div class="utilities">${button('profiles', `<i class="color-dot" style="background:${profile?.color ?? '#ff8a3d'}"></i><span>${esc(profile?.name ?? 'Jugador')}</span>`, '', 'class="profile-chip" aria-label="Perfiles"')}${button('help', icon('help'), '', 'class="icon-button" aria-label="Controles"')}${button('settings', icon('settings'), '', 'class="icon-button" aria-label="Ajustes"')}${button('fullscreen', icon('expand'), '', 'class="icon-button" aria-label="Pantalla completa"')}</div></header>`;
}
export type SettingsTab = 'audio' | 'image' | 'interface' | 'controls';
export function settingsView(s: Settings, tab: SettingsTab = 'audio') {
  const panels = {
    audio: `<h3>Sonido</h3><label>Volumen general<input id="volume" aria-label="Volumen general" type="range" min="0" max="100" value="${s.volume * 100}"></label>${Object.entries(
      BUS_LABELS,
    )
      .map(
        ([id, label]) =>
          `<label>${label}<input data-audio-bus="${id}" aria-label="${label}" type="range" min="0" max="100" value="${s.audioLevels[id as keyof typeof s.audioLevels] * 100}"></label>`,
      )
      .join(
        '',
      )}<p class="muted">La música acompaña menús, editor y resultados. Durante la carrera se oyen las motos y el estadio.</p><div class="actions">${button('audio-preview', 'Probar mezcla')}${button('audio-stop', 'Detener prueba')}${button('audio-credits', 'Créditos de audio')}</div><a href="?audio-review" target="_blank" rel="noopener">Escuchar muestras por separado</a>`,
    image: `<h3>Imagen</h3><div class="form-grid">${select('quality', 'Calidad visual', s.quality, [
      ['high', 'Alta'],
      ['low', 'Rendimiento'],
    ])}${select('surface-detail', 'Detalle del suelo', s.surfaceDetail, [
      ['detailed', 'Detallado'],
      ['light', 'Ligero'],
    ])}${(['bloom', 'cameraShake'] as const).map((key, i) => `<label class="check"><input type="checkbox" id="${key}" ${s[key] ? 'checked' : ''}>${['Resplandor', 'Movimiento de cámara'][i]}</label>`).join('')}
    ${(['race', 'tracks', 'ambient'] as const).map((key, i) => `<label class="check"><input type="checkbox" id="${key === 'race' ? 'vfx-race' : 'vfx-' + key}" data-vfx="${key}" ${s.vfx[key] ? 'checked' : ''}>${['Efectos de carrera', 'Huellas', 'Ambiente dinámico'][i]}</label>`).join('')}
    ${select('vfx-intensity', 'Intensidad de efectos', s.vfx.intensity, [
      ['subtle', 'Discreta'],
      ['balanced', 'Equilibrada'],
      ['strong', 'Intensa'],
    ])}</div><p class="muted">El suelo detallado muestra humedad y nieve compactada. Ligero reduce sus variaciones sin cambiar huellas ni partículas.</p><p class="muted">El ambiente incluye lluvia, nieve, banderas y público. Reducir movimiento mantiene las huellas y detiene las animaciones.</p>`,
    interface: `<h3>Interfaz</h3><label class="check"><input id="reducedMotion" type="checkbox" ${s.reducedMotion ? 'checked' : ''}>Reducir movimiento</label><p class="muted">También respetamos la preferencia de movimiento reducido del dispositivo.</p>${button('fullscreen', 'Pantalla completa')}<p class="muted">La pantalla completa es opcional. Podés salir con Escape.</p>`,
    controls: `<h3>Teclado</h3><div class="bindings">${Object.entries({
      A: 'Acelerar',
      B: 'Turbo',
      UP: 'Carril arriba',
      DOWN: 'Carril abajo',
      LEFT: 'Levantar rueda',
      RIGHT: 'Bajar rueda',
      START: 'Inicio / pausa',
    })
      .map(([k, l]) => button('rebind', `${l} <kbd>${keyLabel(s.bindings[k])}</kbd>`, k))
      .join(
        '',
      )}</div><p class="muted">Gamepad en carrera: A para acelerar, B para turbo, cruceta para maniobrar y Start para pausar.</p><p class="muted">Editor: Ctrl/⌘ + S guarda, Ctrl/⌘ + Z deshace y Suprimir elimina. Los atajos no se activan al escribir.</p>`,
  };
  return `<h2>Ajustes</h2><div class="tabs" role="tablist" aria-label="Ajustes">${(['audio', 'image', 'interface', 'controls'] as const).map((id, i) => button('settings-tab', ['Audio', 'Imagen', 'Interfaz', 'Controles'][i], id, `role="tab" aria-selected="${tab === id}"`)).join('')}</div><section class="settings-panel" role="tabpanel">${panels[tab]}</section><div class="actions">${button('reset-settings', 'Restablecer')}${button('close-modal', 'Listo', '', 'class="primary"')}</div>`;
}

export function icon(name: string) {
  const paths: Record<string, string> = {
    back: '<path d="m14 5-7 7 7 7M7 12h14"/>',
    settings:
      '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .6-1.5 1-1.5 2M12 16v.1"/>',
    expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
    flag: '<path d="M5 21V3h14v10H5m0-5h14M10 3v10m5-10v10"/>',
    trophy:
      '<path d="M8 3h8v7a4 4 0 0 1-8 0ZM8 5H4v3c0 3 2 4 4 4m8-7h4v3c0 3-2 4-4 4m-4 2v6m-5 1h10"/>',
    versus: '<path d="m4 4 7 7m2 2 7 7M16 4h4v4M4 16v4h4M4 20 20 4"/>',
    clock: '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M9 2h6"/>',
    editor: '<path d="m4 17 12-12 4 4L8 21H4ZM13 8l4 4M3 6h5M5.5 3.5v5"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
  };
  return `<svg class="icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.flag}</svg>`;
}
