import type { CompetitionSession } from '../core/game';
import { DIFFICULTIES, ticksToTime } from '../core/game';
import { standings, turnPlayer } from '../core/competition';
import { formatTime } from '../core/simulation';
import { trackSvg } from '../core/tracks';
import { TIME_LABELS } from '../core/time-of-day';
import { WEATHER_LABELS } from '../core/weather';
import { button as b, esc, modeNames } from './widgets';
import { pageTitle, finishTable } from './screens';

export function sessionView(s: CompetitionSession) {
  const rows = standings(s),
    done = s.phase === 'complete',
    current = s.courses[Math.min(s.courseIndex, s.courses.length - 1)];
  const results = s.results.filter(
    (r) => r.course === Math.min(s.courseIndex, s.courses.length - 1),
  );
  return `<main class="page session-page" data-key="session">${pageTitle(s.presetId === 'motoneta' ? 'Torneo Motoneta' : modeNames[s.mode], done ? 'COMPETICIÓN COMPLETA' : `CARRERA ${s.courseIndex + 1} DE ${s.courses.length}`)}<div class="session-layout"><section class="panel ready-panel scroll-region">${
    done
      ? `<h2>Podio</h2>${s.reward ? `<p class="tournament-reward" role="status">${s.reward === 'unlocked' ? '¡Desbloqueaste la Motoneta!' : s.reward === 'already-unlocked' ? 'Motoneta ya desbloqueada' : 'Completaste el torneo. Volvé a intentarlo para ganar el campeonato.'}</p>${s.reward !== 'not-earned' ? b('reward-garage', 'Ir al garaje', s.players[0].id, 'class="primary"') : ''}` : ''}<div class="podium">${rows
          .filter((r) => r.rank <= 3)
          .map(
            (r) =>
              `<div class="podium-place rank-${r.rank}"><b>${r.rank}º</b><strong>${esc(r.name)}</strong><span>${r.points} puntos</span></div>`,
          )
          .join('')}</div>`
      : `<span class="eyebrow">${s.phase === 'ready' ? 'PRÓXIMA SALIDA' : 'BANDERA A CUADROS'}</span><h2>${esc(current.track.name)}</h2>${trackSvg(current.track)}<p>${current.track.laps} vueltas · ${TIME_LABELS[current.timeOfDay]} · ${WEATHER_LABELS[current.weather]}</p>${
          s.phase === 'ready'
            ? `<h3>Turno de ${esc(turnPlayer(s).name)}</h3><p class="muted">${s.mode === 'versus' ? `Jugador ${s.turnIndex + 1} de ${s.players.length} · ${results.length} fantasmas disponibles` : `${s.bots.length} bots · ${DIFFICULTIES[s.difficulty]}`}</p>`
            : `<h3>Resultado de la carrera</h3>${finishTable(
                results.flatMap((r) => r.result.finishes),
                [...s.players, ...s.bots],
              )}`
        }`
  }</section><section class="panel standings-panel"><h2>Clasificación general</h2><div class="table-wrap scroll-region"><table><thead><tr><th>Puesto</th><th>Corredor</th><th>Puntos</th><th>Victorias</th><th>Tiempo</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${r.completed ? r.rank + 'º' : '—'}</td><td>${esc(r.name)}</td><td>${r.points}</td><td>${r.wins}</td><td>${r.completed ? formatTime(ticksToTime(r.ticks)) : '—'}</td></tr>`).join('')}</tbody></table></div><p class="muted">${s.presetId === 'motoneta' ? '10–8–6–4' : '10–8–6–4–2–1'} puntos. Desempate por victorias y tiempo. No terminar: 0 puntos.</p></section></div><footer class="screen-footer"><span class="muted">${done ? '' : 'Tu progreso se guarda entre turnos.'}</span>${done ? (s.presetId === 'motoneta' ? b('navigate', 'Volver al torneo', 'motoneta-tournament') : '') + b('home', 'Inicio', '', 'class="primary"') : b(s.phase === 'ready' ? 'begin-turn' : 'advance', s.phase === 'ready' ? 'Comenzar turno' : 'Continuar', '', 'class="primary"')}</footer></main>`;
}
