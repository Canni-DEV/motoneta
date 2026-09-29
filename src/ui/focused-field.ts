/** Only appears when the software keyboard makes the editor's normal layout unusable. */
export class FocusedField {
  private source: HTMLInputElement | null = null;
  private input: HTMLInputElement | null = null;
  private original = '';
  private baseline = innerHeight;
  private cooldown = 0;
  private dialog = document.createElement('dialog');
  get active() {
    return this.dialog.open;
  }
  owns(el: Element) {
    return el === this.input || (this.active && el === this.source);
  }
  cancel() {
    this.close(false);
  }
  constructor() {
    this.dialog.id = 'focused-field';
    this.dialog.setAttribute('aria-label', 'Edición de campo');
    document.getElementById('app')!.append(this.dialog);
    document.addEventListener('focusin', (event) => {
      const target = event.target;
      if (
        !this.active &&
        target instanceof HTMLInputElement &&
        target.closest('.editor-page') &&
        ['text', 'number', 'search'].includes(target.type)
      ) {
        this.source = target;
        this.original = target.value;
        this.baseline = Math.max(innerHeight, window.visualViewport?.height ?? 0);
      }
    });
    window.visualViewport?.addEventListener('resize', () => this.resize());
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close(false);
    });
    this.dialog.addEventListener('click', (event) => {
      const action = (event.target as HTMLElement).closest<HTMLElement>('[data-field-action]')
        ?.dataset.fieldAction;
      if (action) this.close(action === 'done');
    });
  }
  private resize() {
    const viewport = window.visualViewport;
    if (!viewport) return;
    if (this.active) {
      this.dialog.style.maxHeight = `${Math.max(100, viewport.height - 12)}px`;
      this.dialog.style.top = `${viewport.offsetTop + 6}px`;
      return;
    }
    if (
      performance.now() < this.cooldown ||
      !matchMedia('(pointer:coarse)').matches ||
      !this.source?.isConnected ||
      document.activeElement !== this.source
    )
      return;
    if (viewport.height >= 300 || this.baseline - viewport.height < 80) return;
    this.dialog.innerHTML =
      '<header class="dialog-heading"><h2>Editar valor</h2></header><div class="dialog-body"></div><footer class="dialog-actions"><button type="button" data-field-action="cancel">Cancelar</button><button type="button" class="primary" data-field-action="done">Listo</button></footer>';
    const label = document.createElement('label');
    label.textContent =
      this.source.getAttribute('aria-label') ??
      this.source.closest('label')?.textContent ??
      'Valor';
    this.input = this.source.cloneNode(true) as HTMLInputElement;
    this.input.removeAttribute('id');
    for (const key of Object.keys(this.input.dataset)) delete this.input.dataset[key];
    this.input.value = this.source.value;
    label.append(this.input);
    this.dialog.querySelector('.dialog-body')!.append(label);
    this.dialog.showModal();
    this.input.focus();
    this.resize();
  }
  private close(commit: boolean) {
    if (commit && !this.input?.reportValidity()) return;
    const source = this.source,
      value = commit ? this.input!.value : this.original;
    this.cooldown = performance.now() + 600;
    this.dialog.close();
    if (source?.isConnected) {
      source.value = value;
      source.blur();
      if (commit) {
        source.dispatchEvent(new Event('input', { bubbles: true }));
        source.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    this.source = this.input = null;
  }
}
