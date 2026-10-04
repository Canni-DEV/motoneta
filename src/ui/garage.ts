import { BIKE_SLOTS, RIDER_SLOTS, SLOT_LABELS, VARIANTS, VARIANT_LABELS, VEHICLES, VEHICLE_LABELS, type Appearance, type SlotId } from '../appearance';
import { button, esc } from './widgets';

export function garageView(name: string, draft: Appearance, selected: SlotId, unlockedMotoneta = false, unlockedTanque = false) {
  const locked = draft.vehicle === 'motoneta' && !unlockedMotoneta || draft.vehicle === 'tanque' && !unlockedTanque;
  const tanque = draft.vehicle === 'tanque';
  const bikeSelected = (BIKE_SLOTS as readonly SlotId[]).includes(selected);
  if (tanque && bikeSelected) selected = 'fairing';
  const fixedBike = tanque && bikeSelected;
  const label = fixedBike ? 'Tanque' : SLOT_LABELS[selected];
  const slotButton = (slot: SlotId) => button('garage-slot', SLOT_LABELS[slot], slot,
    `class="garage-slot" aria-pressed="${slot === selected}"`);
  const paint = draft.paints[selected];
  return `<main class="garage-shell">
    <section class="garage-stage" id="garage-stage" aria-label="Vista previa 3D de moto y piloto">
      <div class="scene-viewport" data-scene-host></div>
      <div class="garage-camera">
        ${button('garage-left', '↶', '', 'aria-label="Girar a la izquierda"')}
        <span>Arrastrá para girar · Rueda para acercar</span>
        ${button('garage-right', '↷', '', 'aria-label="Girar a la derecha"')}
        ${button('garage-zoom-in', '+', '', 'aria-label="Acercar"')}
        ${button('garage-zoom-out', '−', '', 'aria-label="Alejar"')}
      </div>
    </section>
    <aside class="garage-panel scroll-region">
      <p class="eyebrow">Personalización</p><h1 tabindex="-1">Garaje de ${esc(name)}</h1>
      <p>${tanque ? 'Elegí el color principal y secundario del Tanque y personalizá tu piloto.' : 'Combiná las piezas y elegí dos colores para cada una.'}</p>
      <div class="garage-vehicles" aria-label="Vehículo">${VEHICLES.map((vehicle) => button('garage-vehicle', VEHICLE_LABELS[vehicle] + (vehicle === 'motoneta' && !unlockedMotoneta ? ' · Bloqueada' : vehicle === 'tanque' && !unlockedTanque ? ' · Bloqueado' : ''), vehicle, `aria-pressed="${draft.vehicle === vehicle}"`)).join('')}</div>
      ${locked ? `<p class="vehicle-lock" role="status">${tanque ? 'Ganá el Torneo Tanque para equiparlo y personalizarlo.' : 'Ganá el Torneo Motoneta para equiparla y personalizarla.'}</p>` : ''}
      <h2>${tanque ? 'Tanque' : 'Moto'}</h2><div class="garage-slots">${tanque ? button('garage-slot', 'Colores del Tanque', 'fairing', `class="garage-slot" aria-pressed="${bikeSelected}"`) : BIKE_SLOTS.map(slotButton).join('')}</div>
      <h2>Piloto</h2><div class="garage-slots">${RIDER_SLOTS.map(slotButton).join('')}</div>
      <fieldset ${locked ? 'disabled' : ''}><legend>${label}</legend>
        ${fixedBike ? '' : `<div class="garage-variants">${VARIANTS.map((variant) => button('garage-variant', VARIANT_LABELS[variant], variant,
          `aria-pressed="${draft.parts[selected] === variant}"`)).join('')}</div>`}
        <div class="garage-paints">
          <label>Principal<input type="color" data-garage-color="primary" value="${paint.primary}" aria-label="Color principal de ${label}"></label>
          <label>${fixedBike ? 'Secundario' : 'Acento'}<input type="color" data-garage-color="accent" value="${paint.accent}" aria-label="${fixedBike ? 'Color secundario' : 'Color de acento'} de ${label}"></label>
        </div>
        ${button('garage-reset-slot', fixedBike ? 'Restaurar colores' : 'Restaurar esta pieza')}
      </fieldset>
      <div class="garage-actions">${button('garage-reset-all', 'Restaurar todo', '', locked ? 'disabled' : '')}${button('garage-cancel', 'Cancelar')}${button('garage-save', 'Guardar', '', `class="primary" ${locked ? 'disabled' : ''}`)}</div>
    </aside>
  </main>`;
}
