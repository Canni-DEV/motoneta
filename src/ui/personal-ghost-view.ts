import { ticksToTime } from '../core/game';
import { ghostLapComparison, type PersonalGhostReference } from '../core/personal-ghost';
import { formatTime } from '../core/simulation';
import type { Race } from '../core/types';
import { patch } from './dom';

export function formatGhostDelta(ticks: number) {
  const sign = ticks < 0 ? '−' : ticks > 0 ? '+' : '±';
  const label = ticks < 0 ? 'Ventaja' : ticks > 0 ? 'Desventaja' : 'Igual';
  return `${sign}${formatTime(ticksToTime(Math.abs(ticks)))} · ${label}`;
}

const delta = (ticks: number) =>
  `<strong class="ghost-delta" data-trend="${ticks < 0 ? 'ahead' : ticks > 0 ? 'behind' : 'equal'}">${formatGhostDelta(ticks)}</strong>`;

function splitContent(laps: readonly number[], reference: PersonalGhostReference) {
  const split = ghostLapComparison(laps, reference, laps.length - 1);
  return split
    ? `<h3>Vuelta ${split.lap}</h3><dl><div><dt>Esta vuelta</dt><dd>${delta(split.lapDeltaTicks)}</dd></div><div><dt>Acumulado</dt><dd>${delta(split.totalDeltaTicks)}</dd></div></dl>`
    : '<p>Sin parciales todavía</p>';
}

export function personalGhostHud(reference: PersonalGhostReference) {
  return `<section id="ghost-comparison" class="ghost-comparison" aria-label="Comparación con mi fantasma" aria-live="polite" aria-atomic="true" data-lap="0">${splitContent([], reference)}</section>`;
}

export function updatePersonalGhostHud(race: Race, reference: PersonalGhostReference) {
  const element = document.getElementById('ghost-comparison');
  const laps = race.riderLaps[0];
  if (!element || element.dataset.lap === String(laps.length)) return;
  patch(element, splitContent(laps, reference));
  element.dataset.lap = String(laps.length);
}

export function personalGhostResults(race: Race, reference: PersonalGhostReference) {
  const own = race.finishes.find((finish) => finish.id === race.config.player.id);
  const rows = (own?.laps ?? race.riderLaps[0]).map((_, index, laps) => {
    const split = ghostLapComparison(laps, reference, index)!;
    return `<tr><th scope="row">${split.lap}</th><td>${formatTime(ticksToTime(split.ownTicks))}</td><td>${formatTime(ticksToTime(split.ghostTicks))}</td><td>${delta(split.lapDeltaTicks)}</td><td>${delta(split.totalDeltaTicks)}</td></tr>`;
  }).join('');
  return `<section class="ghost-results"><h3>Comparación con tu fantasma</h3><div class="ghost-total"><p>Tiempo del fantasma <b>${formatTime(ticksToTime(reference.ticks))}</b></p>${own?.ticks != null ? `<p>Diferencia total ${delta(own.ticks - reference.ticks)}</p>` : ''}</div>${rows ? `<div class="table-wrap"><table aria-label="Comparación por vuelta"><thead><tr><th>Vuelta</th><th>Tu tiempo</th><th>Fantasma</th><th>Esta vuelta</th><th>Acumulado</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p>Sin vueltas completadas.</p>'}</section>`;
}
