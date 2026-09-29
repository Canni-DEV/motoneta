import type { World } from '../renderer';

/** One renderer, attached to the actual visible region instead of hidden beneath panels. */
export class SceneViewport {
  private host: HTMLElement | null = null;
  private observer = new ResizeObserver(() => this.resize());
  constructor(
    private canvas: HTMLCanvasElement,
    private world: () => World | null,
  ) {}
  attach(host: HTMLElement, mode: 'menu' | 'editor' | 'race') {
    if (this.host !== host) {
      this.observer.disconnect();
      this.host = host;
      host.append(this.canvas);
      this.observer.observe(host);
    }
    const world = this.world();
    if (world) world.mode = mode;
    this.resize();
  }
  resize() {
    if (this.host?.isConnected && this.host.clientWidth && this.host.clientHeight)
      this.world()?.resize();
  }
  detach() {
    this.observer.disconnect();
    this.host = null;
    this.canvas.remove();
  }
}
