import { BIKE_SLOTS, RIDER_SLOTS, SLOT_LABELS, VARIANTS, VARIANT_LABELS, type Appearance, type SlotId } from '../appearance';
import { button, esc } from './widgets';

export function garageView(name: string, draft: Appearance, selected: SlotId) {
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
      <p>Combiná las piezas y elegí dos colores para cada una.</p>
      <h2>Moto</h2><div class="garage-slots">${BIKE_SLOTS.map(slotButton).join('')}</div>
      <h2>Piloto</h2><div class="garage-slots">${RIDER_SLOTS.map(slotButton).join('')}</div>
      <fieldset><legend>${SLOT_LABELS[selected]}</legend>
        <div class="garage-variants">${VARIANTS.map((variant) => button('garage-variant', VARIANT_LABELS[variant], variant,
          `aria-pressed="${draft.parts[selected] === variant}"`)).join('')}</div>
        <div class="garage-paints">
          <label>Principal<input type="color" data-garage-color="primary" value="${paint.primary}" aria-label="Color principal de ${SLOT_LABELS[selected]}"></label>
          <label>Acento<input type="color" data-garage-color="accent" value="${paint.accent}" aria-label="Color de acento de ${SLOT_LABELS[selected]}"></label>
        </div>
        ${button('garage-reset-slot', 'Restaurar esta pieza')}
      </fieldset>
      <div class="garage-actions">${button('garage-reset-all', 'Restaurar todo')}${button('garage-cancel', 'Cancelar')}${button('garage-save', 'Guardar', '', 'class="primary"')}</div>
    </aside>
  </main>`;
}
