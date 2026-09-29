import { DIFFICULTIES, ticksToTime } from '../core/game';
import { formatTime } from '../core/simulation';
import { trackSvg } from '../core/tracks';
import type { SaveState } from '../persistence';
import { pageTitle } from './screens';
import { button as b, esc } from './widgets';

export function recordsView(s: SaveState, selected: string) {
  const records = s.records.filter((r) => r.profileId === s.activeProfile),
    current = records.find((r) => r.key === selected) ?? records[0];
  return `<main class="page records-page" data-key="records">${pageTitle('Tus marcas', '', b('import-replay', 'Abrir repetición'))}<div class="records-layout"><section class="panel record-list scroll-region">${records.map((r) => b('record-select', `<strong>${esc(s.maps.find((m) => m.id === r.ref.id)?.name ?? r.ref.name)}</strong><span>${formatTime(ticksToTime(r.ticks))}</span><small>${r.config.track.laps} vueltas · ${r.config.bots.length} rivales</small>`, r.key, `class="record-row" aria-pressed="${current?.key === r.key}"`)).join('') || '<div class="empty-state"><h2>Sin marcas guardadas</h2><p>Completá una carrera para guardar un tiempo.</p></div>'}</section><section class="panel record-detail scroll-region">${current ? `<span class="eyebrow">MEJOR CARRERA</span><div class="result-time">${formatTime(ticksToTime(current.ticks))}</div><h2>${esc(current.ref.name)}</h2>${trackSvg(current.config.track)}<div class="stat-pair"><span>Mejor vuelta<strong>${formatTime(ticksToTime(current.bestLap))}</strong></span><span>Fecha<strong>${new Date(current.date).toLocaleDateString('es-AR')}</strong></span></div><p>${current.config.track.laps} vueltas · ${current.config.bots.length} rivales${current.config.bots.length ? ' · ' + DIFFICULTIES[current.config.difficulty] : ''}</p>` : '<span class="record-empty-art">00:00<span>.00</span></span>'}</section></div><footer class="screen-footer"><span class="muted" ${current ? 'hidden' : ''}>Datos guardados en este navegador.</span><div class="actions">${b('backup', 'Exportar datos')}${current ? b('record-watch', 'Ver repetición', current.replayId) + b('record-race', 'Correr contra marca', current.replayId, 'class="primary"') : ''}</div></footer></main>`;
}
