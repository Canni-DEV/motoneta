import type { Editor } from './editor';
import { isFlatTerrain, isTerrainSurface, TERRAIN_INFO } from '../core/terrain';

import { PIECES } from '../core/tracks';
import { placedPiece, validateMap } from '../core/maps';
import { isLoop, LOOP_SAMPLES, LOOP_LENGTH, LOOP_HEIGHT, LOOP_WIDTH, sampleLane, loopWarnings } from '../core/loop-geometry';
import { button as b, esc, select, environmentFields, icon } from './widgets';
import { sceneHost } from './screens';
import { contourSvg } from './terrain-preview';

export function editorView(e: Editor) {
  const d = e.design,
    p = d.items.find((item) => item.id === e.chosenItem);
  const width = Math.max(1, d.length * e.scale);
  const proposed = placedPiece(e.chosenPiece, e.cursor);
  const samples = LOOP_SAMPLES.filter((_, i) => i % 4 === 0);
  const roadEdge = (side: number) => samples.map(s =>
    `${(s.position[0] + side * s.lateral[0] * s.width / 2) / LOOP_LENGTH * 100},${(sampleLane(s) + 0.5 + side * s.lateral[2] * s.width / LOOP_WIDTH / 2) * 25}`);
  const outline = [...roadEdge(-1), ...roadEdge(1).reverse()].join(' ');
  const routes = d.items.filter(isLoop).map(p => `<svg class="loop-route" viewBox="0 0 100 100" preserveAspectRatio="none" style="left:${p.x/d.length*100}%;width:${p.length/d.length*100}%" aria-hidden="true"><polygon points="${outline}"/><polyline points="${samples.map(s=>`${s.position[0]/LOOP_LENGTH*100},${(sampleLane(s)+0.5)*25}`).join(' ')}"/></svg>`).join('');

  let placementError = '';
  if (e.armed || e.tab === 'pieces') {
    try {
      validateMap({ ...d, items: [...d.items, proposed] });
    } catch (error) {
      placementError = (error as Error).message;
    }
  }
  const insertion =
    e.armed || e.tab === 'pieces'
      ? `<div class="insertion-preview ${placementError ? 'invalid' : ''}" style="left:${(e.cursor / d.length) * 100}%;width:max(5px,${(proposed.length / d.length) * 100}%)" aria-label="${esc(placementError || 'Posición válida')}" >${isFlatTerrain(proposed) ? contourSvg(proposed) : [0, 1, 2, 3].map((lane) => `<i class="${proposed.lanes & (1 << lane) ? 'on' : ''}"></i>`).join('')}</div>`
      : '';

  const palette = ['dirt', 'terrain']
    .map(
      (group) =>
        `<h3>${group === 'dirt' ? 'Rampas' : 'Terreno'}</h3><div class="piece-palette">${PIECES.filter(
          (piece) => (group === 'dirt' ? piece.surface === 'dirt' : piece.surface !== 'dirt'),
        )
          .map((piece) =>
            b(
              'piece',
              `<strong>${piece.id}</strong><span>${esc(piece.name)}</span>${isTerrainSurface(piece.surface) ? `<small class="terrain-effect">${esc(TERRAIN_INFO[piece.surface].effect)}</small>` : ''}${isFlatTerrain(piece) ? contourSvg(placedPiece(piece.id, 0)) : `<svg viewBox="0 0 100 36" aria-hidden="true"><polyline points="${(piece.id==='T' ? LOOP_SAMPLES.filter((_,i)=>i%8===0).map(s=>`${s.position[0]/LOOP_LENGTH*96+2},${32-s.position[1]/LOOP_HEIGHT*30}`) : piece.profile.map(([x, y]) => `${x * 96 + 2},${32 - (y / 128) * 30}`)).join(' ')}"/></svg>`}<small>${[0, 1, 2, 3].map((lane) => `<i class="lane-dot ${piece.lanes & (1 << lane) ? 'on' : ''}"></i>`).join('')}</small>`,
              piece.id,
              `class="piece ${piece.surface}" aria-label="${piece.id}: ${esc(piece.name)}" aria-pressed="${piece.id === e.chosenPiece}"`,
            ),
          )
          .join('')}</div>`,
    )
    .join('');
  const properties = p
    ? `<span class="eyebrow">PIEZA ${esc(p.piece)}</span><h2>${isLoop(p)?'Loop · entrada 4 → salida 1 y 2':isTerrainSurface(p.surface) ? TERRAIN_INFO[p.surface].name : 'Detalle del salto'}</h2>${isLoop(p)?'<p class="muted">Dimensiones fijas · ↑ hacia el carril 1 · Reducí antes si llegás con impulso.</p>':''}${isTerrainSurface(p.surface) ? `<p class="muted">${esc(TERRAIN_INFO[p.surface].effect)}</p>${contourSvg(p)}${isFlatTerrain(p) ? b('terrain-variant','Cambiar variante') : ''}` : ''}<div class="piece-inspector form-grid"><label>Posición<input id="piece-x" data-piece-field="x" type="number" min="0" max="${d.length - p.length}" step="8" value="${p.x}"></label><label>Largo<input id="piece-length" data-piece-field="length" type="number" min="8" max="640" step="8" value="${p.length}" ${isLoop(p)?'disabled':''}></label><label>${isLoop(p)?'Altura total':'Altura'}<input id="piece-height" data-piece-field="height" type="number" min="0" max="128" step="1" value="${isLoop(p)?Math.round(LOOP_HEIGHT):Math.max(...p.profile.map((v) => v[1]))}" ${p.profile.every((v) => v[1] === 0) ? 'disabled' : ''}></label><fieldset><legend>Carriles</legend><div class="lane-options">${[0, 1, 2, 3].map((lane) => `<label class="check"><input type="checkbox" data-piece-lane="${lane}" ${isLoop(p)?'disabled':''} ${p.lanes & (1 << lane) ? 'checked' : ''}>${lane + 1}</label>`).join('')}</div></fieldset></div><div class="actions">${b('move-left', '← 8')}${b('move-right', '8 →')}${b('duplicate-piece', 'Duplicar')}${b('replace-piece', 'Reemplazar por ' + e.chosenPiece)}${b('remove-piece', 'Quitar pieza', '', 'class="danger"')}</div>`
    : `<div class="empty-state">${icon('editor')}<h2>Elegí una pieza</h2><p>Seleccioná una pieza en los carriles para ajustar sus propiedades.</p>${b('editor-tab', 'Ver piezas', 'pieces')}</div>`;
  const track = `<h2>Tu circuito</h2><div class="form-grid"><label class="wide-field">Nombre<input id="design-name" aria-label="Nombre del circuito" maxlength="40" value="${esc(d.name)}" data-editor="name"></label><label>Longitud<input id="design-length" type="number" min="640" max="30000" step="8" value="${d.length}" data-editor="length"></label>${select(
    'design-laps',
    'Vueltas',
    d.laps,
    Array.from({ length: 9 }, (_, i) => [i + 1, String(i + 1)]),
    'data-editor="laps"',
  )}</div>${environmentFields(d.timeOfDay, d.weather)}<p class="muted">El borrador se guarda solo. Usá Guardar para publicar los cambios en tu biblioteca.</p>${b('clear-design', 'Vaciar circuito', '', 'class="danger"')}`;
  return `<main class="editor-page page" data-key="editor"><header class="editor-heading">${b('back', icon('back'), '', 'class="editor-compact icon-button" aria-label="Volver"')}<div class="editor-title"><h1 tabindex="-1">Taller de pistas</h1><span class="editor-name">${esc(d.name)}</span><span id="draft-status" class="save-status ${e.saveState === 'error' ? 'error' : ''}" role="status">${e.statusText}</span></div><div class="actions">${b('fullscreen', icon('expand'), '', 'class="editor-compact icon-button" aria-label="Pantalla completa"')}${b('editor-file', 'Archivo')}${b('save-design', 'Guardar', '', 'class="primary"')}${b('toggle-editor-panel', icon('panel'), '', `class="icon-button" aria-label="${e.collapsed ? 'Abrir herramientas' : 'Plegar herramientas'}" aria-expanded="${!e.collapsed}"`)}</div></header><div class="editor-layout ${e.collapsed ? 'panel-collapsed' : ''}"><section class="editor-workspace"><div class="editor-preview">${sceneHost('editor-viewport')}</div><div class="preview-tools"><span class="viewport-label">VISTA 3D</span>${b('camera-out', '−', '', 'aria-label="Alejar cámara"')}${b('camera-in', '+', '', 'aria-label="Acercar cámara"')}<label class="preview-range"><span class="sr-only">Recorrer pista</span><input id="preview-range" type="range" min="0" max="100" step="0.1" value="${(e.cursor / d.length) * 100}" aria-label="Posición de vista previa"></label>${b('camera-center', 'Centrar', '', !p ? 'disabled' : '')}${b('camera-reset', '1×', '', 'aria-label="Restablecer cámara"')}</div><section class="editor-timeline"><div class="timeline-tools"><span class="eyebrow">4 CARRILES</span><div class="actions">${b('undo', '↶', '', `aria-label="Deshacer" ${!e.undo.length ? 'disabled' : ''}`)}${b('redo', '↷', '', `aria-label="Rehacer" ${!e.redo.length ? 'disabled' : ''}`)}${b('timeline-out', '−', '', 'aria-label="Alejar carriles"')}${b('timeline-in', '+', '', 'aria-label="Ampliar carriles"')}${b('timeline-fit', 'Ajustar')}${b('arm-piece', '+ Pieza', '', `aria-pressed="${e.armed}"`)}</div></div><div class="lane-scroll" data-key="lane-scroll" tabindex="0" aria-label="Línea de cuatro carriles"><div class="lane-canvas" style="width:max(100%,${width}px)" data-length="${d.length}">${Array.from(
    { length: 4 },
    (_, lane) =>
      `<div class="lane" data-lane="${lane}" data-key="lane-${lane}"><span class="lane-label">${lane + 1}</span>${d.items
        .filter((p) => p.lanes & (1 << lane))
        .map((p) =>
          b(
            'select-item',
            isLoop(p) ? (lane===3?'T →':lane<=1?'T ↗':'T') : isFlatTerrain(p) ? `${contourSvg(p, lane)}<span>${esc(p.piece)}</span>` : esc(p.piece),
            p.id,
            `data-key="${esc(p.id)}-${lane}" data-drag="${esc(p.id)}" class="placed ${e.chosenItem === p.id ? 'selected' : ''} surface-${p.surface} ${isFlatTerrain(p)?'terrain-placement':''} ${isLoop(p)?'placed-loop':''}" style="left:${(p.x / d.length) * 100}%;width:max(5px,${(p.length / d.length) * 100}%)" title="${isLoop(p)?(lane===3?'Entrada por el carril 4':lane<=1?'Salida elevada sobre los carriles 1 y 2 · paso libre por debajo':'Paso libre por debajo'):esc((isTerrainSurface(p.surface) ? TERRAIN_INFO[p.surface].name + ': ' + TERRAIN_INFO[p.surface].effect : p.piece))}" aria-label="${esc(p.piece)}, carril ${lane + 1}, posición ${p.x}"`,
          ),
        )
        .join('')}</div>`,
  ).join(
    '',
  )}${routes}${insertion}<div class="timeline-cursor" style="left:${(e.cursor / d.length) * 100}%"></div><div class="placement-ghost" hidden></div></div></div></section></section><aside class="panel editor-sidebar" ${e.collapsed ? 'hidden' : ''}><div class="tabs editor-tabs" role="tablist" aria-label="Herramientas del editor">${(['pieces', 'properties', 'track'] as const).map((tab, i) => b('editor-tab', ['Piezas', 'Propiedades', 'Pista'][i], tab, `role="tab" aria-selected="${e.tab === tab}"`)).join('')}</div><div class="editor-panel-content scroll-region" data-key="panel-${e.tab}" role="tabpanel">${e.tab === 'pieces' ? palette : e.tab === 'properties' ? properties : track}</div>${e.tab === 'pieces' ? `<footer class="palette-footer"><label>Insertar en<input id="insert-position" type="number" min="0" max="${d.length}" step="8" value="${e.cursor}"></label>${b('add-piece', 'Colocar ' + e.chosenPiece, '', 'class="primary" aria-label="Añadir pieza"')}</footer>` : ''}</aside></div><footer class="editor-footer"><span id="editor-hint" class="muted" role="status">${e.hint || loopWarnings(d.items)[0] || (e.armed ? placementError || `Posición ${e.cursor} válida · Colocá ${e.chosenPiece}` : '') || `${d.items.length} piezas · ${d.laps} vueltas · Arrastrá una pieza a los carriles`}</span><div class="actions">${b('play-design-bots', 'Con bots')}${b('play-design-solo', 'Probar pista →', '', 'class="primary" aria-label="Probar pista"')}</div></footer></main>`;
}
