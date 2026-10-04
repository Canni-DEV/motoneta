export type Screen =
  | 'home'
  | 'quick'
  | 'tournament'
  | 'tournament-custom'
  | 'motoneta-tournament'
  | 'tanque-tournament'
  | 'versus'
  | 'records'
  | 'editor'
  | 'session'
  | 'race'
  | 'library'
  | 'generator'
  | 'garage';
export type SetupStep = 'players' | 'courses' | 'review';
export interface SetupPresentation {
  step: SetupStep;
  tab: 'maps' | 'options';
  search: string;
  course: number;
}
export const setupPresentation = (): SetupPresentation => ({
  step: 'players',
  tab: 'maps',
  search: '',
  course: 0,
});

export class Navigation {
  current: Screen = 'home';
  private history: { screen: Screen; focus: string | null }[] = [];
  private nextFocus: string | null = null;
  private scroll = new Map<Screen, { left: number; top: number }[]>();
  rememberView() {
    this.scroll.set(
      this.current,
      Array.from(document.querySelectorAll<HTMLElement>('#ui .scroll-region')).map((panel) => ({
        left: panel.scrollLeft,
        top: panel.scrollTop,
      })),
    );
  }
  enter(screen: Screen) {
    if (screen === this.current) return;
    this.rememberView();
    const active = document.activeElement as HTMLElement | null;
    this.history.push({
      screen: this.current,
      focus: active?.id || active?.dataset.focusKey || null,
    });
    this.current = screen;
    this.nextFocus = null;
  }
  back(): Screen {
    this.rememberView();
    const previous = this.history.pop();
    this.current = previous?.screen ?? 'home';
    this.nextFocus = previous?.focus ?? null;
    return this.current;
  }
  restoreFocus(root: HTMLElement) {
    const positions = this.scroll.get(this.current);
    root.querySelectorAll<HTMLElement>('.scroll-region').forEach((panel, index) => {
      if (positions?.[index]) {
        panel.scrollLeft = positions[index].left;
        panel.scrollTop = positions[index].top;
      }
    });
    const id = this.nextFocus;
    this.nextFocus = null;
    const target = id
      ? (document.getElementById(id) ??
        root.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(id)}"]`))
      : null;
    (target ?? root.querySelector<HTMLElement>('h1'))?.focus({ preventScroll: true });
  }
}
