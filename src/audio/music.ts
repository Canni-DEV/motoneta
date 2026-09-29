import type { AudioScene } from './catalog';
export interface MusicTrack {
  file: string;
  loopStart: number;
  loopEnd: number;
  gain: number;
  revision?: string;
}
export type MusicScene = 'menu' | 'editor' | 'results';
export type MusicManifest = Record<'menu' | 'editor' | 'results', MusicTrack | null>;
export class MusicAudio {
  private manifest: Promise<MusicManifest> | null = null;
  private requested = '';
  private generation = 0;
  private active: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  private retiring = new Set<AudioBufferSourceNode>();
  private fetchController: AbortController | null = null;
  private pending: Promise<void> = Promise.resolve();
  status = 'pending-files';
  constructor(
    private ctx: AudioContext,
    private output: AudioNode,
    private base = import.meta.env.BASE_URL + 'audio/',
  ) {}
  setScene(scene: AudioScene, previewBoundary = false) {
    const key = scene === 'menu' || scene === 'editor' || scene === 'results' ? scene : '';
    if (key === this.requested && !previewBoundary) return this.pending;
    this.requested = key;
    const generation = ++this.generation;
    this.fetchController?.abort();
    this.fadeOut();
    this.status = key ? 'loading' : 'silent';
    return (this.pending = key ? this.load(key, generation, previewBoundary) : Promise.resolve());
  }
  private async load(key: keyof MusicManifest, generation: number, previewBoundary: boolean) {
    try {
      this.manifest ??= fetch(this.base + 'music.json', { cache: 'no-cache' }).then((r) => {
        if (!r.ok) throw new Error('manifest');
        return r.json();
      });
      const track = (await this.manifest)[key];
      if (generation !== this.generation) return;
      if (!track) {
        this.status = 'pending-files';
        return;
      }
      if (!/^[\w./-]+$/.test(track.file) || track.file.includes('..'))
        throw new Error('invalid path');
      const controller = new AbortController();
      this.fetchController = controller;
      const revision = track.revision ? '?v=' + encodeURIComponent(track.revision) : '';
      const response = await fetch(this.base + track.file + revision, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('missing track');
      const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
      if (generation !== this.generation) return;
      if (
        !Number.isFinite(track.loopStart) ||
        !Number.isFinite(track.loopEnd) ||
        track.loopStart < 0 ||
        track.loopEnd <= track.loopStart ||
        track.loopEnd > buffer.duration + 0.01 ||
        !Number.isFinite(track.gain) ||
        track.gain < 0 ||
        track.gain > 0.3
      )
        throw new Error('invalid loop');
      const source = this.ctx.createBufferSource(),
        gain = this.ctx.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = track.loopStart;
      source.loopEnd = track.loopEnd;
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.output);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
        source.buffer = null;
        this.retiring.delete(source);
      };
      source.start(0, previewBoundary ? Math.max(track.loopStart, track.loopEnd - 3) : 0);
      gain.gain.setTargetAtTime(track.gain, this.ctx.currentTime, 0.25);
      this.active = { source, gain };
      this.status = 'playing';
    } catch {
      if (generation === this.generation) this.status = 'unavailable';
    }
  }
  private fadeOut() {
    if (!this.active) return;
    for (const source of this.retiring) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
    }
    const { source, gain } = this.active;
    this.active = null;
    gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
    source.stop(this.ctx.currentTime + 0.45);
    this.retiring.add(source);
  }
  stop(immediate = false) {
    this.requested = '';
    this.generation++;
    this.fetchController?.abort();
    this.fadeOut();
    if (immediate) {
      for (const source of this.retiring) {
        source.stop();
        source.disconnect();
        source.buffer = null;
      }
      this.retiring.clear();
    }
    this.status = 'silent';
  }
  dispose() {
    this.stop(true);
    for (const s of this.retiring) {
      try {
        s.stop();
      } catch {
        /* already ended */
      }
      s.disconnect();
    }
    this.retiring.clear();
  }
  get voices() {
    return Number(!!this.active) + this.retiring.size;
  }
  get track() {
    return this.requested || null;
  }
}
