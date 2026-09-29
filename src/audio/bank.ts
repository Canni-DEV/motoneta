import catalogue from './generated-bank.json';
import type { AudioCueId } from './catalog';
export class AudioBank {
  buffers = new Map<AudioCueId, AudioBuffer>();
  failed: string[] = [];
  private pending: Promise<void> | null = null;
  private controller = new AbortController();
  constructor(
    private ctx: BaseAudioContext,
    private base = import.meta.env.BASE_URL + 'audio/',
  ) {}
  load() {
    return (this.pending ??= this.loadAll());
  }
  private async loadAll() {
    const queue = [...catalogue];
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let item = queue.shift(); item; item = queue.shift()) {
          try {
            const response = await fetch(this.base + item.file, { signal: this.controller.signal });
            if (!response.ok) throw new Error(String(response.status));
            const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
            if (!this.controller.signal.aborted) this.buffers.set(item.id as AudioCueId, buffer);
          } catch {
            if (!this.controller.signal.aborted) this.failed.push(item.id);
          }
        }
      }),
    );
  }
  dispose() {
    this.controller.abort();
    this.buffers.clear();
  }
}
