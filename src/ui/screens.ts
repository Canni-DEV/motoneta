import {
  button as b,
  esc,
  select,
  difficultyField,
  environmentFields,
  modeNames,
  icon,
  modeScene,
} from './widgets';
import { trackSvg } from '../core/tracks';
import { formatTime } from '../core/simulation';
import {
  DIFFICULTIES,
  ticksToTime,
  type Difficulty,
  type RaceCourse,
  type PlayerProfile,
  type PersonalRecord,
} from '../core/game';
import { placements } from '../core/competition';
import { TIME_LABELS } from '../core/time-of-day';
import { WEATHER_LABELS } from '../core/weather';
import type { SaveState } from '../persistence';
import { mapCourse, type GeneratorOptions, type MapDesign } from '../core/maps';
import { maximumLoops } from '../core/loop-geometry';
import type { SetupPresentation } from './navigation';

export interface Setup {
  mode: 'quick' | 'tournament' | 'versus';
  selected: string;
  courses: RaceCourse[];
  bots: number;
  difficulty: Difficulty;
  players: string[];
  filter: 'all' | 'builtin' | 'custom';
}
export interface QuickRecordPresentation {
  record?: PersonalRecord;
  enabled: boolean;
  available: boolean;
  busy: boolean;
}
const lapOptions: [number, string][] = Array.from({ length: 9 }, (_, i) => [i + 1, String(i + 1)]);
export const sceneHost = (id = 'preview-host') =>
  `<div id="${id}" class="scene-viewport" data-scene-host aria-label="Vista previa 3D"></div>`;
const empty = (title: string, text: string) =>
  `<div class="empty-state"><span class="eyebrow">SIN RESULTADOS</span><h3>${title}</h3><p>${text}</p></div>`;
export function pageTitle(title: string, caption = '', actions = '') {
  return `<div class="page-heading"><div>${caption ? `<span class="eyebrow">${caption}</span>` : ''}<h1 tabindex="-1">${title}</h1></div><div class="actions">${actions}</div></div>`;
}
export function homeView(s: SaveState) {
  const pending = [...Object.values(s.sessions), s.motonetaSessions[s.activeProfile], s.tanqueSessions[s.activeProfile]].filter((v) => v && v.phase !== 'complete');
  const descriptions = [
    'Una carrera, con o sin rivales.',
    'Puntos acumulados en varias pistas.',
    '2 a 6 jugadores · una carrera por turno.',
    'Tiempos, repeticiones y fantasmas.',
    'Creá y editá tus propias pistas.',
  ];
  return `<main class="page home-page" data-key="home"><h1 class="sr-only" tabindex="-1">Inicio</h1><nav class="home-modes" aria-label="Modos de juego">${Object.entries(
    modeNames,
  )
    .map(([id, name], i) =>
      b(
        'navigate',
        `<span class="mode-art">${modeScene(id)}</span><span class="mode-number">0${i + 1}</span>${id === 'versus' ? '<span class="mode-tag">POR TURNOS</span>' : ''}<span class="mode-copy"><strong>${name}</strong><span>${descriptions[i]}</span></span>${icon('arrow')}`,
        id,
        `class="mode-card mode-${id}" aria-label="${esc(name)}: ${esc(descriptions[i])}"`,
      ),
    )
    .join(
      '',
    )}</nav><footer class="home-footer" ${pending.length ? '' : 'hidden'}><div class="resume-list">${pending
    .filter((v) => v?.phase !== 'complete')
    .map((v) =>
      b(
        'resume-session',
        `<span class="status-dot"></span>Continuar ${v!.presetId ? v!.presetId === 'tanque' ? 'Torneo Tanque' : 'Torneo Motoneta' : modeNames[v!.mode]}<small>${v!.courseIndex + 1}/${v!.courses.length}</small>`,
        v!.presetId ?? v!.mode,
        'class="resume-card"',
      ),
    )
    .join('')}</div></footer></main>`;
}
export function trackCards(catalog: RaceCourse[], selected: string[], action = 'track') {
  return (
    catalog
      .map((c, i) =>
        b(
          action,
          `<span class="track-number">${String(i + 1).padStart(2, '0')}</span>${trackSvg(c.track)}<strong>${esc(c.track.name)}</strong><small>${c.track.custom ? 'Personal' : 'Original'} <span>· ${c.track.length} u.</span></small>`,
          c.ref.id,
          `data-key="track-${esc(c.ref.id)}" class="track-card" aria-pressed="${selected.includes(c.ref.id)}"`,
        ),
      )
      .join('') ||
    empty('No hay pistas coincidentes', 'Probá otra búsqueda o creá tu propio circuito.')
  );
}
function gallery(setup: Setup, catalog: RaceCourse[], view: SetupPresentation) {
  const options = catalog.filter(
    (c) =>
      (setup.filter === 'all' || !!c.track.custom === (setup.filter === 'custom')) &&
      c.track.name.toLocaleLowerCase().includes(view.search.toLocaleLowerCase()),
  );
  return `<section class="panel map-gallery" data-key="map-gallery"><div class="gallery-heading"><h2>Elegí la pista</h2><div class="gallery-filters"><label class="search-field"><span class="sr-only">Buscar pistas</span><input id="map-search" type="search" placeholder="Buscar pista…" value="${esc(view.search)}"></label>${select(
    'map-filter',
    'Mostrar',
    setup.filter,
    [
      ['all', 'Todos'],
      ['builtin', 'Predeterminados'],
      ['custom', 'Personales'],
    ],
  )}</div></div><div class="track-grid scroll-region" data-key="track-grid">${trackCards(options, setup.mode === 'quick' ? [setup.selected] : setup.courses.map((c) => c.ref.id))}</div><div class="panel-footer actions">${b('random', 'Al azar')}${b('generator', 'Generar mapa')}${b('copy-map', 'Editar una copia', setup.selected)}</div></section>`;
}
function participants(setup: Setup, profiles: PlayerProfile[], quick?: QuickRecordPresentation) {
  return setup.mode === 'versus'
    ? `<h2>¿Quién corre?</h2><p class="muted">Elegí de 2 a 6 jugadores. Un turno para cada uno.</p><div class="player-options">${profiles.map((p) => `<label class="check player-choice" data-key="player-${esc(p.id)}"><input type="checkbox" data-player="${esc(p.id)}" ${setup.players.includes(p.id) ? 'checked' : ''}><i class="color-dot" style="background:${p.color}"></i>${esc(p.name)}</label>`).join('')}</div>${b('profiles', 'Administrar perfiles')}`
    : `<h2>Configuración de carrera</h2>${setup.mode === 'quick' ? `<div class="quick-record-options"><label class="check quick-ghost-choice"><input id="quick-ghost" type="checkbox" aria-describedby="quick-record" ${quick?.enabled && quick.available ? 'checked' : ''} ${quick?.available ? '' : 'disabled'}>Correr contra mi fantasma</label><p id="quick-record" role="status" aria-live="polite">${quick?.record ? `Tu récord: <strong>${formatTime(ticksToTime(quick.record.ticks))}</strong>` : 'Sin récord para esta configuración'}</p></div>` : '<p class="muted">Sumá puntos en al menos tres pistas diferentes.</p>'}<div class="form-grid">${select(
        'bots',
        'Rivales',
        setup.bots,
        Array.from({ length: setup.mode === 'tournament' ? 4 : 6 }, (_, i) => [
          i + (setup.mode === 'tournament' ? 2 : 0),
          String(i + (setup.mode === 'tournament' ? 2 : 0)),
        ]),
      )}${difficultyField(setup.difficulty)}</div>`;
}
function courseDetails(c: RaceCourse, index: number) {
  return `<h2>${esc(c.track.name)}</h2><div class="form-grid">${select(`course-laps-${index}`, 'Vueltas', c.track.laps, lapOptions, `data-course="${index}" data-field="laps"`)}${select(`course-time-${index}`, 'Hora', c.timeOfDay, Object.entries(TIME_LABELS), `data-course="${index}" data-field="timeOfDay"`)}${select(`course-weather-${index}`, 'Clima', c.weather, Object.entries(WEATHER_LABELS), `data-course="${index}" data-field="weather"`)}</div>`;
}
export function setupView(
  setup: Setup,
  catalog: RaceCourse[],
  profiles: PlayerProfile[],
  ready: boolean,
  view: SetupPresentation,
  quick?: QuickRecordPresentation,
) {
  const current = setup.courses[0] ?? catalog[0],
    multi = setup.mode !== 'quick';
  const steps = `<div class="steps" aria-label="Preparación">${(['players', 'courses', 'review'] as const).map((step, i) => b('setup-step', `<span>0${i + 1}</span>${['Participantes', 'Pistas', 'Resumen'][i]}`, step, `aria-current="${view.step === step ? 'step' : 'false'}"`)).join('')}</div>`;
  let content: string;
  if (!multi) {
    content = `<div class="compact-tabs tabs">${b('setup-tab', 'Pistas', 'maps', `aria-pressed="${view.tab === 'maps'}"`)}${b('setup-tab', 'Configuración', 'options', `aria-pressed="${view.tab === 'options'}"`)}</div><div class="setup-grid" data-tab="${view.tab}">${gallery(setup, catalog, view)}<section class="panel setup-options" data-key="setup-options"><div class="mini-preview">${sceneHost()}</div><div class="scroll-region options-body" data-key="options-body"><h2>${esc(current.track.name)}</h2>${participants(setup, profiles, quick)}${select('laps', 'Vueltas', current.track.laps, lapOptions)}${environmentFields(current.timeOfDay, current.weather)}</div></section></div>`;
  } else if (view.step === 'players') {
    content = `<div class="participants-layout"><section class="panel scroll-region">${participants(setup, profiles)}</section><div class="competition-preview">${sceneHost()}</div></div>`;
  } else if (view.step === 'courses') {
    const selected = Math.min(view.course, Math.max(0, setup.courses.length - 1));
    content = `<div class="calendar-layout">${gallery(setup, catalog, view)}<section class="panel calendar-panel"><div class="section-heading"><h2>Calendario <span class="badge">${setup.courses.length}</span></h2>${b('apply-all', 'Aplicar a todas', '', `${!setup.courses.length ? 'disabled' : ''}`)}</div><div class="course-list scroll-region" data-key="course-list">${setup.courses.map((c, i) => `<div class="course-row" data-key="course-${esc(c.ref.id)}">${b('course-select', `<span>${i + 1}</span><strong>${esc(c.track.name)}</strong>`, String(i), `aria-pressed="${selected === i}"`)}<div class="actions">${b('course-up', '↑', String(i), `aria-label="Subir carrera ${i + 1}" ${i === 0 ? 'disabled' : ''}`)}${b('course-down', '↓', String(i), `aria-label="Bajar carrera ${i + 1}" ${i === setup.courses.length - 1 ? 'disabled' : ''}`)}${b('course-remove', '×', String(i), `aria-label="Quitar carrera ${i + 1}"`)}</div></div>`).join('') || empty('Armá tu calendario', setup.mode === 'tournament' ? 'Seleccioná al menos tres pistas.' : 'Seleccioná una o más pistas.')}</div><div class="course-detail scroll-region">${setup.courses[selected] ? courseDetails(setup.courses[selected], selected) : ''}</div></section></div>`;
  } else {
    content = `<div class="review-layout"><div class="panel scroll-region"><h2>Resumen de la competición</h2><p>${setup.mode === 'versus' ? setup.players.map((id) => esc(profiles.find((p) => p.id === id)?.name ?? '')).join(' · ') : `${setup.bots} rivales · ${DIFFICULTIES[setup.difficulty]}`}</p><ol class="review-courses">${setup.courses.map((c) => `<li><strong>${esc(c.track.name)}</strong><span>${c.track.laps} vueltas · ${TIME_LABELS[c.timeOfDay]} · ${WEATHER_LABELS[c.weather]}</span></li>`).join('')}</ol>${!setup.courses.length ? '<p>Agregá pistas para comenzar.</p>' : ''}</div><div class="competition-preview">${sceneHost()}<div class="preview-caption"><strong>${setup.courses.length} pistas</strong></div></div></div>`;
  }
  const canNext =
    view.step === 'players'
      ? setup.mode !== 'versus' || (setup.players.length >= 2 && setup.players.length <= 6)
      : setup.courses.length >= (setup.mode === 'tournament' ? 3 : 1);
  const startLabel = multi ? 'Crear competición' : quick?.busy ? 'Cargando fantasma…' : 'Comenzar';
  return `<main class="page setup-page" data-key="setup-${setup.mode}">${pageTitle(modeNames[setup.mode])}${multi ? steps : ''}${content}<footer class="screen-footer"><span class="selection-summary">${multi ? `${setup.courses.length} pistas seleccionadas` : esc(current.track.name)}</span><div class="actions">${multi && view.step !== 'players' ? b('setup-previous', 'Anterior') : ''}${multi && view.step !== 'review' ? b('setup-next', 'Continuar →', '', `class="primary" ${!canNext ? 'disabled' : ''}`) : b('start', startLabel, '', `class="primary start-button" ${!ready || (multi && !canNext) ? 'disabled' : ''}`)}</div></footer></main>`;
}
export function generatorView(g: GeneratorOptions, generated: MapDesign | null = null) {
  const maxLoops=maximumLoops({short:2048,medium:4096,long:6144}[g.size]);
  return `<main class="page generator-page" data-key="generator">${pageTitle('Generar pista')}<div class="generator-layout"><section class="panel scroll-region"><h2>Parámetros</h2><div class="form-grid">${select(
    'gen-size',
    'Longitud',
    g.size,
    [
      ['short', 'Corta'],
      ['medium', 'Media'],
      ['long', 'Larga'],
    ],
    'data-generator="size"',
  )}${select('gen-difficulty', 'Dificultad', g.difficulty, Object.entries(DIFFICULTIES), 'data-generator="difficulty"')}<label class="wide-field">Semilla<input id="gen-seed" maxlength="80" value="${esc(g.seed)}" data-generator="seed"></label>${(['ramps', 'mud', 'cool'] as const).map((k, i) => `<label>${['Rampas', 'Barro', 'Enfriamiento'][i]} (0–100)<input type="number" min="0" max="100" value="${g[k]}" data-generator="${k}"></label>`).join('')}<label>Loops (0–${maxLoops})<input id="gen-loops" type="number" min="0" max="${maxLoops}" step="1" value="${g.loops}" data-generator="loops"></label></div><p class="muted">La misma semilla produce la misma pista. Máximo ${maxLoops} loops para esta longitud; se reserva una salida normal despejada.</p></section><section class="generator-result">${sceneHost()}<div class="panel generated-detail">${generated ? `<h2>${esc(generated.name)}</h2>${trackSvg(mapCourse(generated).track)}<p>${generated.length} unidades · ${generated.items.length} piezas</p>` : '<h2>Sin pista generada</h2><p>Elegí los parámetros y previsualizá el resultado.</p>'}</div></section></div><footer class="screen-footer"><div class="actions">${b('generate', 'Previsualizar', '', generated ? '' : 'class="primary"')}${b('regenerate', 'Regenerar')}</div><div class="actions">${b('edit-generated', 'Editar', '', generated ? '' : 'disabled')}${b('save-generated', 'Guardar', '', generated ? '' : 'disabled')}${b('use-generated', 'Usar mapa', '', `class="primary" ${generated ? '' : 'disabled'}`)}</div></footer></main>`;
}
export interface LibraryPresentation {
  search: string;
  filter: 'all' | 'builtin' | 'custom';
  selected: string;
}
export function libraryView(catalog: RaceCourse[], view: LibraryPresentation) {
  const options = catalog.filter(
    (c) =>
      (view.filter === 'all' || !!c.track.custom === (view.filter === 'custom')) &&
      c.track.name.toLocaleLowerCase().includes(view.search.toLocaleLowerCase()),
  );
  const selected = catalog.find((c) => c.ref.id === view.selected) ?? options[0];
  return `<main class="page library-page" data-key="library">${pageTitle('Biblioteca')}<div class="library-layout"><section class="panel map-gallery"><div class="gallery-filters"><label><span class="sr-only">Buscar mapas</span><input id="library-search" type="search" placeholder="Buscar pista…" value="${esc(view.search)}"></label>${select(
    'library-filter',
    'Mostrar',
    view.filter,
    [
      ['all', 'Todos'],
      ['builtin', 'Predeterminados'],
      ['custom', 'Personales'],
    ],
  )}</div><div class="track-grid scroll-region">${trackCards(options, selected ? [selected.ref.id] : [], 'library-select')}</div></section><section class="library-detail">${sceneHost()}<div class="panel scroll-region">${selected ? `<span class="eyebrow">${selected.track.custom ? 'MAPA PERSONAL' : 'PISTA ORIGINAL'}</span><h2>${esc(selected.track.name)}</h2><p>${selected.track.length} unidades · ${selected.track.laps} vueltas</p>${trackSvg(selected.track)}` : '<p>No hay pistas disponibles.</p>'}</div></section></div><footer class="screen-footer"><span class="muted">Abrí un mapa o empezá desde una copia.</span><div class="actions">${selected?.track.custom ? b('delete-design', 'Eliminar', selected.ref.id, 'class="danger"') : ''}${selected ? b(selected.track.custom ? 'load-design' : 'copy-map', selected.track.custom ? 'Abrir' : 'Editar una copia', selected.ref.id, 'class="primary"') : ''}</div></footer></main>`;
}
export { sessionView } from './session-view';
export function finishTable(finishes: Parameters<typeof placements>[0], players: PlayerProfile[]) {
  return `<div class="table-wrap"><table><thead><tr><th>Puesto</th><th>Corredor</th><th>Tiempo</th></tr></thead><tbody>${placements(
    finishes,
  )
    .map(
      (f) =>
        `<tr><td>${f.rank ? f.rank + 'º' : '—'}</td><td>${esc(players.find((p) => p.id === f.id)?.name ?? f.id)}</td><td>${f.ticks === null ? 'No terminó' : formatTime(ticksToTime(f.ticks))}</td></tr>`,
    )
    .join('')}</tbody></table></div>`;
}
export { recordsView } from './records-view';
