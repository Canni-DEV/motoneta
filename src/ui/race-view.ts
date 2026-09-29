import type { PlayerProfile } from '../core/game';
import { clockTime } from '../core/racing';
import { currentLap, formatTime } from '../core/simulation';
import type { Race, Settings } from '../core/types';
import { keyLabel } from '../input';
import { button as b, esc } from './widgets';
export function raceView(r: Race, ghosts: PlayerProfile[], playback: boolean) {
  return `<div class="race-ui"><header class="race-top"><div class="race-identity">${b('pause', 'Pausa', '', 'aria-label="Pausar"')}<div><h2>${esc(r.track.name)}</h2><span>${playback ? 'Repetición' : esc(r.config.player.name)}</span></div></div><div class="race-clock"><small>Tiempo</small><strong id="race-time">00:00.00</strong></div><div class="lap-display"><small>Vuelta</small><strong><span id="lap">1</span> / ${r.track.laps}</strong></div><div id="position-box"><small>Posición</small><strong id="position">1</strong></div></header><div class="countdown" id="countdown" aria-live="polite"></div><div id="race-message" role="status"></div><div class="ghost-legend">${ghosts.length ? `<small>${ghosts.length} fantasma${ghosts.length === 1 ? '' : 's'}</small>` : ''}${ghosts.map((g) => `<span><i style="background:${g.color}"></i><span class="ghost-name">${esc(g.name)}</span></span>`).join('')}</div><div class="race-bottom"><div class="temperature"><span>Temperatura <b id="heat-label">Óptima</b></span><div class="heat-track"><div id="heat-fill"></div></div></div><div class="speed"><strong id="speed">0</strong><span> km/h</span><small id="turbo-state" aria-hidden="true">Turbo</small></div></div><div class="touch-controls"><div class="touch-dpad"><button data-input="UP" aria-label="Carril superior">↑</button><button data-input="LEFT" aria-label="Levantar rueda">←</button><button data-input="RIGHT" aria-label="Bajar rueda">→</button><button data-input="DOWN" aria-label="Carril inferior">↓</button></div><div class="touch-throttle"><button data-input="A">A<small>Acelerar</small></button><button data-input="B">B<small>Turbo</small></button></div></div></div>`;
}
export function updateHud(r: Race, settings: Settings) {
  const text = (id: string, value: string) => {
    const e = document.getElementById(id);
    if (!e || e.textContent === value) return;
    if (id === 'countdown' && value) {
      // A fresh beat animates once per number, never once per simulation frame.
      const beat = document.createElement('span');
      beat.textContent = value;
      e.replaceChildren(beat);
    } else e.textContent = value;
  };
  const p = r.riders[0];
  text('race-time', formatTime(clockTime(r)));
  text('lap', String(currentLap(r)));
  text('speed', String(Math.round(p.speed * 26)));
  text('position', `${r.rank || 1} / ${r.riders.length}`);
  text('heat-label', p.overheated ? 'Enfriando' : p.heat > 75 ? 'Alta' : 'Óptima');
  const heat = document.getElementById('heat-fill');
  if (heat) {
    heat.style.width = p.heat + '%';
    heat.classList.toggle('hot', p.heat > 75);
    heat.closest('.temperature')?.classList.toggle('overheated', p.overheated);
  }
  const turbo = document.getElementById('turbo-state');
  turbo?.classList.toggle('active', p.turbo);
  turbo?.setAttribute('aria-hidden', String(!p.turbo));
  text(
    'countdown',
    r.countdown ? String(Math.ceil(r.countdown / 60)) : r.elapsed < 40 ? 'Salida' : '',
  );
  text(
    'race-message',
    p.crashPhase === 'rolling'
      ? 'Caída: la moto sigue rodando'
      : p.crashPhase === 'down'
        ? `Pulsá ${keyLabel(settings.bindings.A)} repetidamente para levantarte`
        : p.crashPhase === 'mounting'
          ? 'Volviendo a la moto'
          : p.overheated
            ? 'Motor caliente: esperá a que enfríe'
            : p.wheelie > 0.9
              ? `${keyLabel(settings.bindings.RIGHT)} para bajar la rueda`
              : '',
  );
}
