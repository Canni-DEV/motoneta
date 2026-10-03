import { Input, type Settings } from './core/types';
export class Controls {
  keys = new Set<string>();
  touch = 0;
  enabled = false;
  gamepadConnected = false;
  gamepadActive = false;
  onPause = () => {};
  onStart = () => {};
  onKey: ((code: string) => void) | null = null;
  private touchBinding: AbortController | null = null;
  constructor(public settings: Settings) {
    window.addEventListener('keydown', (e) => {
      if (this.onKey) {
        e.preventDefault();
        this.onKey(e.code);
        return;
      }
      if ((e.target as HTMLElement)?.closest('input,select,textarea,[contenteditable="true"]'))
        return;
      // Let the environment buttons use native Enter/Space activation instead of starting a race.
      if (
        (e.target as HTMLElement)?.closest('button, a') &&
        (e.code === 'Enter' || e.code === 'Space')
      )
        return;
      if (e.code === 'Escape') {
        e.preventDefault();
        if (!e.repeat) this.onPause();
        return;
      }
      if (e.code === settings.bindings.START) {
        e.preventDefault();
        if (!e.repeat) this.onStart();
      }
      if (this.enabled && Object.values(settings.bindings).includes(e.code)) e.preventDefault();
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }
  clear() {
    this.keys.clear();
    this.touch = 0;
  }
  padStart = false;
  sample() {
    let bits = this.touch;
    for (const name in this.settings.bindings)
      if (Object.hasOwn(this.settings.bindings, name) && this.keys.has(this.settings.bindings[name]))
        bits |= Input[name as keyof typeof Input] ?? 0;
    const pad = navigator.getGamepads?.().find((g) => g?.connected);
    this.gamepadConnected = !!pad;
    if (pad) {
      if (pad.buttons[0]?.pressed) bits |= Input.A;
      if (pad.buttons[1]?.pressed || pad.buttons[7]?.pressed) bits |= Input.B;
      if (pad.buttons[12]?.pressed || pad.axes[1] < -0.35) bits |= Input.UP;
      if (pad.buttons[13]?.pressed || pad.axes[1] > 0.35) bits |= Input.DOWN;
      if (pad.buttons[14]?.pressed || pad.axes[0] < -0.35) bits |= Input.LEFT;
      if (pad.buttons[15]?.pressed || pad.axes[0] > 0.35) bits |= Input.RIGHT;
      const start = !!pad.buttons[9]?.pressed;
      if (start && !this.padStart && this.gamepadActive) this.onStart();
      this.padStart = start;
    } else this.padStart = false;
    return bits;
  }
  bindTouch(root: HTMLElement) {
    this.touchBinding?.abort();
    this.touchBinding = new AbortController();
    const options = { signal: this.touchBinding.signal };
    root.querySelectorAll<HTMLElement>('[data-input]').forEach((el) => {
      const bit = Input[el.dataset.input as keyof typeof Input];
      el.addEventListener(
        'pointerdown',
        (e) => {
          e.preventDefault();
          el.setPointerCapture(e.pointerId);
          this.touch |= bit;
          el.classList.add('pressed');
        },
        options,
      );
      const end = () => {
        this.touch &= ~bit;
        el.classList.remove('pressed');
      };
      el.addEventListener('pointerup', end, options);
      el.addEventListener('pointercancel', end, options);
      el.addEventListener('lostpointercapture', end, options);
    });
  }
}
export const keyLabel = (key: string) =>
  ({
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Space: 'ESPACIO',
    Enter: 'ENTER',
    ShiftRight: 'SHIFT',
    ShiftLeft: 'SHIFT',
  })[key] ?? key.replace('Key', '').replace('Digit', '');
