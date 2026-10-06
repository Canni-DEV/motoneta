import type { Editor } from './editor';
import { placedPiece, validateMap } from '../core/maps';
import type { PieceId } from '../core/types';
import { loopWarnings } from '../core/loop-geometry';
import { isFlatTerrain, terrainSeed } from '../core/terrain';
import { contourSvg } from './terrain-preview';

/** Delegated Pointer Events support mouse and touch; listeners live exactly as long as the view. */
export function bindEditor(root: HTMLElement, editor: Editor, signal: AbortSignal) {
  let suppressClick = false;
  root.addEventListener(
    'click',
    (event) => {
      if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const target = event.target as HTMLElement;
      const lane = target.closest<HTMLElement>('.lane');
      if (!lane || target.closest('button')) return;
      const canvas = lane.parentElement!,
        rect = canvas.getBoundingClientRect();
      const x =
        Math.round((((event.clientX - rect.left) / rect.width) * editor.design.length) / 8) * 8;
      if (editor.armed) editor.insert(x);
      else editor.setCursor(x);
    },
    { signal, capture: true },
  );
  root.addEventListener(
    'keydown',
    (event) => {
      if (!(event.target as Element).closest('.lane-scroll')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        editor.setCursor(editor.cursor + (event.key === 'ArrowLeft' ? -8 : 8));
      }
      if (event.key === 'Enter' && editor.armed) {
        event.preventDefault();
        editor.insert();
      }
    },
    { signal },
  );
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return;
      const source = (event.target as HTMLElement).closest<HTMLElement>('.piece,[data-drag]');
      const canvas = root.querySelector<HTMLElement>('.lane-canvas');
      if (!source || !canvas) return;
      const palette = source.classList.contains('piece');
      const original = palette
        ? placedPiece(source.dataset.value!, 0)
        : editor.design.items.find((p) => p.id === source.dataset.drag)!;
      const rect = canvas.getBoundingClientRect(),
        laneHeight = canvas.querySelector('.lane')!.getBoundingClientRect().height;
      const firstLane = Number(source.closest<HTMLElement>('.lane')?.dataset.lane ?? 0);
      const startX = event.clientX,
        startY = event.clientY;
      let moved = false,
        candidate = structuredClone(original),
        valid = false;
      let message = '';
      const gesture = new AbortController();
      const ghost = canvas.querySelector<HTMLElement>('.placement-ghost')!;
      const hint = root.querySelector<HTMLElement>('#editor-hint')!;
      const move = (e: PointerEvent) => {
        if (!moved && Math.hypot(e.clientX - startX, e.clientY - startY) < 8) return;
        moved = true;
        const current = canvas.getBoundingClientRect();
        candidate = structuredClone(original);
        candidate.x =
          Math.round(
            (palette
              ? ((e.clientX - current.left) / current.width) * editor.design.length
              : original.x +
                ((e.clientX - startX + (rect.left - current.left)) / current.width) *
                  editor.design.length) / 8,
          ) * 8;
        if (!palette && (original.lanes & (original.lanes - 1)) === 0)
          candidate.lanes =
            1 <<
            Math.max(0, Math.min(3, firstLane + Math.round((e.clientY - startY) / laneHeight)));
        if (palette && isFlatTerrain(candidate)) candidate.terrainShape = {version:1,variant:terrainSeed(candidate)};
        try {
          if (palette && (e.clientY < current.top || e.clientY > current.bottom))
            throw new Error('Soltá sobre los carriles.');
          validateMap({
            ...editor.design,
            items: [
              ...editor.design.items.filter((p) => palette || p.id !== original.id),
              candidate,
            ],
          });
          valid = true;
          message = loopWarnings([...editor.design.items.filter(p=>p.id!==candidate.id),candidate])[0] || `${candidate.piece} · posición ${candidate.x} · Soltá para colocar`;
        } catch (error) {
          valid = false;
          message = (error as Error).message;
        }
        ghost.hidden = false;
        ghost.classList.toggle('invalid', !valid);
        ghost.style.left = `${(candidate.x / editor.design.length) * 100}%`;
        ghost.style.width = `${Math.max(8, (candidate.length / editor.design.length) * current.width)}px`;
        const terrain = isFlatTerrain(candidate);
        ghost.classList.toggle('terrain-ghost',terrain);
        ghost.innerHTML = terrain ? contourSvg(candidate) : '';
        ghost.style.backgroundImage = terrain ? 'none' : `linear-gradient(to bottom, ${[0, 1, 2, 3].map((lane) => `${candidate.lanes & (1 << lane) ? 'currentColor' : 'transparent'} ${lane * 25}% ${(lane + 1) * 25}%`).join(',')})`;
        hint.textContent = message;
      };
      const cleanup = () => {
        gesture.abort();
        ghost.hidden = true;
        editor.cancelGesture = null;
      };
      signal.addEventListener('abort', cleanup, { once: true, signal: gesture.signal });
      editor.cancelGesture = () => {
        cleanup();
        suppressClick = true;
        root.addEventListener(
          'pointerup',
          () =>
            setTimeout(() => {
              suppressClick = false;
            }, 0),
          { once: true, signal },
        );
        hint.textContent = 'Movimiento cancelado';
      };
      source.setPointerCapture(event.pointerId);
      root.addEventListener('pointermove', move, { signal: gesture.signal });
      root.addEventListener(
        'pointercancel',
        () => {
          cleanup();
          hint.textContent = 'Movimiento cancelado';
        },
        { signal: gesture.signal },
      );
      root.addEventListener(
        'pointerup',
        () => {
          cleanup();
          if (!moved) return;
          suppressClick = true;
          // The click generated by pointerup is consumed before delegated application actions.
          setTimeout(() => {
            suppressClick = false;
          }, 0);
          if (!valid) {
            editor.reject(message);
            hint.textContent = message;
            return;
          }
          if (palette) {
            editor.chosenPiece = candidate.piece as PieceId;
            editor.insert(candidate.x);
          } else {
            editor.chosenItem = original.id;
            editor.tab = 'properties';
            editor.cursor = candidate.x;
            editor.edit((d) => {
              d.items = d.items.map((p) => (p.id === candidate.id ? candidate : p));
            });
          }
        },
        { signal: gesture.signal },
      );
    },
    { signal },
  );
}
