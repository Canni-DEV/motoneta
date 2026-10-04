import type { SaveState } from '../persistence';
import { motonetaCourses } from '../core/motoneta-tournament';
import { tanqueCourses, tanqueDay } from '../core/tanque-tournament';
import { TIME_LABELS } from '../core/time-of-day';
import { WEATHER_LABELS } from '../core/weather';
import { button as b, esc } from './widgets';
import { pageTitle } from './screens';

export function tournamentMenu(unlockedMotoneta = false) {
  return `<main class="page tournament-menu">${pageTitle('Torneo', 'ELEGÍ TU CAMPEONATO')}<div class="tournament-choices">
    <section class="panel"><span class="eyebrow">DESAFÍO Y RECOMPENSA</span><h2>Torneo Motoneta</h2><p>Cinco pistas · 3 bots en Difícil · 2 vueltas por carrera.</p><p>Ganá el campeonato y desbloqueá tu Motoneta.</p>${b('navigate', 'Torneo Motoneta', 'motoneta-tournament', 'class="primary"')}</section>
    <section class="panel"><span class="eyebrow">DESAFÍO DIARIO</span><h2>Torneo Tanque</h2><p>Cinco pistas largas del día · 3 bots en Difícil · 2 vueltas por carrera.</p><p>${unlockedMotoneta ? 'Ganá el campeonato y desbloqueá el Tanque.' : 'Desbloqueá la Motoneta para participar.'}</p>${b('navigate', 'Torneo Tanque', 'tanque-tournament')}</section>
    <section class="panel"><span class="eyebrow">A TU MEDIDA</span><h2>Torneo personalizado</h2><p>Elegí pistas, rivales, dificultad, horarios y climas.</p>${b('navigate', 'Torneo personalizado', 'tournament-custom')}</section></div></main>`;
}
export function tanqueTournamentView(state: SaveState, ready: boolean, day = tanqueDay()) {
  const owner = state.profiles.find((p) => p.id === state.activeProfile)!;
  const pending = state.tanqueSessions[owner.id];
  const ongoing = pending && pending.phase !== 'complete';
  const allowed = ready && owner.unlockedMotoneta;
  const calendar = (courses: ReturnType<typeof tanqueCourses>) => `<ol class="preset-calendar">${courses.map((c) => `<li><strong>${esc(c.track.name)}</strong><span>6144 unidades · 2 vueltas · ${TIME_LABELS[c.timeOfDay]} · ${WEATHER_LABELS[c.weather]}</span></li>`).join('')}</ol>`;
  return `<main class="page tanque-tournament">${pageTitle('Torneo Tanque', 'CAMPEONATO DIARIO')}
    <div class="session-layout"><section class="panel scroll-region"><h2>Calendario del ${esc(day)}</h2><p class="muted">Cambia a medianoche de Argentina. Los reintentos del día usan las mismas cinco pistas.</p>${calendar(tanqueCourses(day))}
    ${ongoing && pending.calendarDate !== day ? `<h3>Calendario de tu intento: ${esc(pending.calendarDate ?? '')}</h3>${calendar(pending.courses)}` : ''}</section>
    <section class="panel scroll-region"><h2>El desafío de ${esc(owner.name)}</h2><p>Bot 1, Bot 2 y Bot 3 · Difícil</p>
    ${!owner.unlockedMotoneta ? '<p class="vehicle-lock" role="status">Desbloqueá la Motoneta para participar.</p>' : ''}
    <p>Terminá primero en la clasificación general para desbloquear el Tanque. Un empate exacto en el primer puesto también cuenta.</p><p>10–8–6–4 puntos. Desempate por victorias y tiempo. Abandonar: 0 puntos.</p>
    <p>${owner.unlockedTanque ? 'Tanque ya desbloqueado' : 'Recompensa: Tanque, scooter personalizable con dos colores.'}</p>
    <p class="muted">El progreso se guarda después de cada carrera. Tu intento conserva sus pistas aunque cambie el día.</p>
    ${ongoing ? `<p>Intento pendiente del ${esc(pending.calendarDate ?? '')}: carrera ${pending.courseIndex + 1} de 5.</p>${b('resume-session', 'Continuar Torneo Tanque', 'tanque', allowed ? 'class="primary"' : 'disabled')}` : ''}
    ${pending?.phase === 'complete' ? b('resume-session', 'Ver último resultado', 'tanque', allowed ? '' : 'disabled') : ''}
    ${b('start-tanque', ongoing ? 'Empezar nuevo' : 'Comenzar torneo', '', allowed ? 'class="primary"' : 'disabled')}
    </section></div></main>`;
}
export function motonetaTournamentView(state: SaveState, ready: boolean) {
  const owner = state.profiles.find((p) => p.id === state.activeProfile)!;
  const pending = state.motonetaSessions[owner.id];
  const ongoing = pending && pending.phase !== 'complete';
  return `<main class="page motoneta-tournament">${pageTitle('Torneo Motoneta', 'CAMPEONATO PREARMADO')}
    <div class="session-layout"><section class="panel scroll-region"><h2>Calendario</h2><ol class="preset-calendar">${motonetaCourses().map((c) => `<li><strong>${esc(c.track.name)}</strong><span>2 vueltas · ${TIME_LABELS[c.timeOfDay]} · ${WEATHER_LABELS[c.weather]}</span></li>`).join('')}</ol></section>
    <section class="panel scroll-region"><h2>El desafío de ${esc(owner.name)}</h2><p>Bot 1, Bot 2 y Bot 3 · Difícil</p><p>Terminá primero en la clasificación general para desbloquear la Motoneta. Un empate exacto en el primer puesto también cuenta.</p><p>10–8–6–4 puntos. Desempate por victorias y tiempo. Abandonar: 0 puntos.</p><p>${owner.unlockedMotoneta ? 'Motoneta ya desbloqueada' : 'Recompensa: Motoneta clásica, personalizable en el garaje.'}</p><p class="muted">El progreso se guarda después de cada carrera.</p>
    ${ongoing ? `<p>Intento pendiente: carrera ${pending.courseIndex + 1} de 5.</p>${b('resume-session', 'Continuar Torneo Motoneta', 'motoneta', ready ? 'class="primary"' : 'disabled')}` : ''}
    ${b('start-motoneta', ongoing ? 'Empezar nuevo' : 'Comenzar torneo', '', ready ? 'class="primary"' : 'disabled')}
    </section></div></main>`;
}
