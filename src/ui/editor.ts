import { emptyDesign, placedPiece, validateMap, type MapDesign } from '../core/maps';
import type { PieceId } from '../core/types';
import { isFlatTerrain, terrainShape } from '../core/terrain';
import { isLoop } from '../core/loop-geometry';
import { editorView } from './editor-view';
import { bindEditor } from './editor-input';

export class Editor {
  design: MapDesign;
  chosenPiece: PieceId = 'A';
  chosenItem: string | null = null;
  undo: MapDesign[] = [];
  redo: MapDesign[] = [];
  tab: 'pieces' | 'properties' | 'track' = 'pieces';
  collapsed = false;
  cursor = 320;
  scale = 0.24;
  armed = false;
  hint = '';
  saveState: 'recovered' | 'saving' | 'draft' | 'saved' | 'error' = 'recovered';
  private published = '';
  private hasPublication = false;
  private persistenceSequence = 0;
  private binding: AbortController | null = null;
  private scroll = { left: 0, top: 0 };
  cameraZoom = 1;
  cancelGesture: (() => void) | null = null;
  constructor(
    draft: MapDesign,
    private persist: (d: MapDesign) => Promise<void>,
    private refresh: () => void,
    private error: (text: string) => void,
    private sound: (
      kind: 'place' | 'move' | 'remove' | 'duplicate' | 'undo' | 'redo',
    ) => void = () => {},
  ) {
    this.design = structuredClone(draft);
  }
  get dirty() {
    return this.signature(this.design) !== this.published;
  }
  private signature(d: MapDesign) {
    return JSON.stringify(validateMap(d));
  }
  markPublished(d: MapDesign | undefined) {
    this.hasPublication = !!d;
    this.published = d ? this.signature(d) : this.signature(emptyDesignWithId(this.design));
  }
  get statusText() {
    if (this.saveState === 'saving') return 'Guardando borrador…';
    if (this.saveState === 'error') return 'Error al guardar · reintentá Guardar o exportá';
    if (this.saveState === 'recovered')
      return this.dirty
        ? 'Borrador recuperado · sin publicar'
        : this.hasPublication
          ? 'Guardado'
          : 'Borrador nuevo';
    return this.dirty || !this.hasPublication ? 'Borrador guardado · sin publicar' : 'Guardado';
  }
  private async persistDraft() {
    const sequence = ++this.persistenceSequence;
    this.saveState = 'saving';
    this.updateStatus();
    try {
      await this.persist(structuredClone(this.design));
      if (sequence === this.persistenceSequence) this.saveState = 'draft';
    } catch (error) {
      if (sequence === this.persistenceSequence) this.saveState = 'error';
      this.error((error as Error).message);
    }
    this.updateStatus();
  }
  updateStatus() {
    const status = document.getElementById('draft-status');
    if (status) {
      status.textContent = this.statusText;
      status.classList.toggle('error', this.saveState === 'error');
    }
  }
  replace(d: MapDesign) {
    this.undo.push(structuredClone(this.design));
    this.redo = [];
    this.design = structuredClone(d);
    this.chosenItem = null;
    this.cursor = Math.min(320, d.length);
    void this.persistDraft();
    this.refresh();
  }
  edit(
    change: (d: MapDesign) => void,
    cue: 'place' | 'move' | 'remove' | 'duplicate' | null = 'move',
  ) {
    const next = structuredClone(this.design);
    const selected = this.chosenItem;
    try {
      change(next);
      const valid = validateMap(next);
      if (JSON.stringify(valid) === JSON.stringify(this.design)) return false;
      this.undo.push(structuredClone(this.design));
      if (this.undo.length > 100) this.undo.shift();
      this.redo = [];
      this.design = valid;
      const selection = valid.items.find((p) => p.id === this.chosenItem);
      if (selection) this.cursor = selection.x;
      void this.persistDraft();
      this.hint = '';
      this.refresh();
      if (cue) this.sound(cue);
      return true;
    } catch (error) {
      this.chosenItem = selected;
      this.hint = (error as Error).message;
      this.error((error as Error).message);
      this.refresh();
      return false;
    }
  }
  html() {
    return editorView(this);
  }
  action(action: string, value: string): boolean {
    const selected = this.design.items.find((p) => p.id === this.chosenItem);
    switch (action) {
      case 'terrain-variant':
        if (selected && isFlatTerrain(selected)) this.edit((d) => {
          const item = d.items.find((p) => p.id === selected.id)!;
          item.terrainShape = { version: 1, variant: (terrainShape(item).variant + 0x9e3779b9) >>> 0 };
        }, 'move');
        return true;
      case 'editor-tab':
        this.tab = value as typeof this.tab;
        this.collapsed = false;
        this.refresh();
        return true;
      case 'toggle-editor-panel':
        this.collapsed = !this.collapsed;
        this.refresh();
        return true;
      case 'arm-piece':
        this.armed = !this.armed;
        this.refresh();
        return true;
      case 'timeline-in':
      case 'timeline-out':
        this.scale = Math.max(
          0.01,
          Math.min(4, this.scale * (action === 'timeline-in' ? 1.5 : 1 / 1.5)),
        );
        this.refresh();
        return true;
      case 'timeline-fit':
        this.scale =
          (document.querySelector('.lane-scroll')?.clientWidth ?? 800) / this.design.length;
        this.refresh();
        return true;
      case 'piece':
        this.chosenPiece = value as PieceId;
        this.armed = true;
        this.refresh();
        return true;
      case 'select-item':
        this.chosenItem = value;
        this.tab = 'properties';
        this.collapsed = false;
        this.armed = false;
        this.cursor = this.design.items.find((p) => p.id === value)?.x ?? this.cursor;
        this.refresh();
        return true;
      case 'new-design':
        this.replace(emptyDesign());
        return true;
      case 'clear-design':
        this.edit((d) => {
          d.items = [];
        }, 'remove');
        return true;
      case 'add-piece':
        this.insert();
        return true;
      case 'remove-piece':
        this.edit((d) => {
          d.items = d.items.filter((p) => p.id !== this.chosenItem);
          this.chosenItem = null;
        }, 'remove');
        return true;
      case 'duplicate-piece':
        if (selected)
          this.edit((d) => {
            const p = {
              ...structuredClone(selected),
              id: crypto.randomUUID(),
              x: selected.x + selected.length + 8,
            };
            d.items.push(p);
            this.chosenItem = p.id;
          }, 'duplicate');
        return true;
      case 'move-left':
      case 'move-right':
        if (selected)
          this.edit((d) => {
            d.items.find((p) => p.id === selected.id)!.x += action === 'move-left' ? -8 : 8;
          });
        return true;
      case 'replace-piece':
        if (selected) {
          this.armed = false;
          const changed = this.edit((d) => {
            d.items = d.items.map((p) =>
              p.id === selected.id
                ? { ...placedPiece(this.chosenPiece, p.x, p.lanes), id: p.id }
                : p,
            );
          });
          if (!changed) this.refresh();
        }
        return true;
      case 'undo':
      case 'redo': {
        const from = action === 'undo' ? this.undo : this.redo,
          to = action === 'undo' ? this.redo : this.undo;
        const d = from.pop();
        if (d) {
          to.push(structuredClone(this.design));
          this.design = d;
          this.chosenItem = null;
          void this.persistDraft();
          this.refresh();
          this.sound(action);
        }
        return true;
      }
    }
    return false;
  }
  change(el: HTMLInputElement) {
    if (el.id === 'insert-position') {
      this.setCursor(Number(el.value));
      return true;
    }
    if (el.dataset.editor) {
      const k = el.dataset.editor;
      this.edit((d) => {
        if (k === 'name') d.name = el.value;
        else if (k === 'length') d.length = Number(el.value);
        else if (k === 'laps') d.laps = Number(el.value);
      }, null);
      return true;
    }
    if (el.dataset.pieceField || el.dataset.pieceLane !== undefined) {
      this.edit((d) => {
        const p = d.items.find((p) => p.id === this.chosenItem);
        if (!p) return;
        if(isLoop(p) && el.dataset.pieceField!=='x') throw new Error('El loop solo permite editar su posición.');
        if (el.dataset.pieceLane !== undefined) {
          const bit = 1 << Number(el.dataset.pieceLane);
          p.lanes = el.checked ? p.lanes | bit : p.lanes & ~bit;
        } else if (el.dataset.pieceField === 'x') p.x = Number(el.value);
        else if (el.dataset.pieceField === 'length') p.length = Number(el.value);
        else {
          const h = Math.max(...p.profile.map((v) => v[1]));
          p.profile = p.profile.map(([x, y]) => [x, h ? (y * Number(el.value)) / h : 0]);
        }
      });
      return true;
    }
    return false;
  }
  bind(root: HTMLElement) {
    if (this.binding) return;
    this.binding = new AbortController();
    bindEditor(root, this, this.binding.signal);
    const lane = root.querySelector<HTMLElement>('.lane-scroll');
    if (lane) lane.scrollLeft = this.scroll.left;
    const panel = root.querySelector<HTMLElement>('.editor-panel-content');
    if (panel) panel.scrollTop = this.scroll.top;
  }
  unbind(root: HTMLElement) {
    this.scroll.left = root.querySelector('.lane-scroll')?.scrollLeft ?? this.scroll.left;
    this.scroll.top = root.querySelector('.editor-panel-content')?.scrollTop ?? this.scroll.top;
    this.binding?.abort();
    this.binding = null;
  }
  invalidate() {
    this.refresh();
  }
  reject(message: string) {
    this.hint = message;
    this.error(message);
  }
  setCursor(x: number) {
    this.cursor = Math.max(0, Math.min(this.design.length, Math.round(x / 8) * 8));
    this.refresh();
    const lane = document.querySelector<HTMLElement>('.lane-scroll');
    if (lane) {
      const position = (this.cursor / this.design.length) * lane.scrollWidth;
      if (position < lane.scrollLeft || position > lane.scrollLeft + lane.clientWidth)
        lane.scrollLeft = position - lane.clientWidth / 2;
    }
  }
  insert(x = this.cursor) {
    const piece = placedPiece(this.chosenPiece, Math.round(x / 8) * 8);
    const success = this.edit((d) => {
      d.items.push(piece);
      this.chosenItem = piece.id;
    }, 'place');
    if (success) {
      this.tab = 'properties';
      this.armed = false;
      this.cursor = piece.x;
      this.refresh();
    }
  }
}
function emptyDesignWithId(d: MapDesign) {
  return { ...emptyDesign(), id: d.id };
}
