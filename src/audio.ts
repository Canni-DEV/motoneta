import type { Race, Settings, Weather } from './core/types';
import { AudioBank } from './audio/bank';
import { AudioMixer } from './audio/mixer';
import { EngineAudio } from './audio/engines';
import { AmbienceAudio } from './audio/ambience';
import { MusicAudio } from './audio/music';
import { AudioEvents } from './audio/events';
import type { AudioCueId, AudioScene, UiCue } from './audio/catalog';
export class GameAudio {
  ctx: AudioContext | null = null;
  bank: AudioBank | null = null;
  mixer: AudioMixer | null = null;
  private engines: EngineAudio | null = null;
  private ambience: AmbienceAudio | null = null;
  private music: MusicAudio | null = null;
  private events = new AudioEvents();
  private scene: AudioScene = 'menu';
  private weather: Weather = 'clear';
  private ready = false;
  private hidden = false;
  private disposed = false;
  private epoch = 0;
  private previewing = false;
  private previewGeneration = 0;
  private previewStage: AudioScene | null = null;
  private demoTimers: ReturnType<typeof setTimeout>[] = [];
  private slowMotion = false;
  constructor(public settings: Settings) {}
  async unlock(playMusic = true) {
    if (this.disposed || this.hidden) return;
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.bank = new AudioBank(this.ctx);
        this.mixer = new AudioMixer(this.ctx, this.bank);
        this.engines = new EngineAudio(this.mixer);
        this.ambience = new AmbienceAudio(this.mixer);
        this.music = new MusicAudio(this.ctx, this.mixer.buses.music);
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      await this.bank!.load();
      if (this.disposed || this.hidden) return;
      this.ready = true;
      this.volume();
      if (playMusic) void this.music?.setScene(this.scene);
    } catch {
      /* Audio failures never prevent play. Diagnostics show bank failures. */
    }
  }
  async interfaceSound(kind: UiCue) {
    if (!this.settings.audioLevels.ui || !this.settings.volume || this.hidden) return;
    const epoch = this.epoch,
      requested = performance.now();
    await this.unlock();
    if (epoch !== this.epoch || performance.now() - requested > 700 || !this.ready || this.hidden)
      return;
    this.mixer?.play({ id: `ui-${kind}`, gain: kind === 'error' ? 0.12 : 0.1, priority: 2 });
  }
  volume() {
    this.mixer?.apply(this.settings);
  }
  beginRace() {
    this.epoch++;
    this.stopPreview();
    this.events.reset();
    this.mixer?.reset();
    if (this.mixer) this.mixer.history.length = 0;
    this.engines?.stop();
    this.ambience?.stop();
  }
  setScene(scene: AudioScene, weather = this.weather) {
    this.weather = weather;
    if (scene === this.scene) return;
    const previous = this.scene;
    this.scene = scene;
    this.epoch++;
    this.stopPreview();
    if (scene !== 'race' && scene !== 'countdown' && scene !== 'cinematic') this.engines?.stop();
    if (scene === 'pause' || scene === 'menu' || scene === 'editor' || previous === 'results')
      this.mixer?.stopWhere((v) => !v.loop && v.bus !== 'ui');
    this.mixer?.setPresentation(scene === 'cinematic', this.slowMotion, this.settings);
    if (!this.hidden && this.ready) this.music?.setScene(scene);
  }
  setSlowMotion(slow: boolean) {
    if (this.slowMotion === slow) return;
    this.slowMotion = slow;
    this.mixer?.setPresentation(this.scene === 'cinematic', slow, this.settings);
  }
  beatDelay() { return this.music?.beatDelay() ?? null; }
  get unlocked() { return this.ready && this.ctx?.state === 'running'; }
  update(r: Race | null, active: boolean) {
    if (!this.ready || this.hidden || this.previewing || this.disposed) return;
    if (active && r) {
      this.engines?.update(r, this.weather);
      for (const request of this.events.consume(r, this.weather)) this.mixer?.play(request);
    }
    this.ambience?.update(this.scene, this.weather, active ? r : null);
  }
  playCue(id: AudioCueId, gain = 0.2, delay = 0) {
    if (this.ready && !this.hidden) this.mixer?.play({ id, gain, delay, priority: 3 });
  }
  setHidden(hidden: boolean) {
    this.hidden = hidden;
    this.epoch++;
    this.mixer?.reset(true);
    this.stopPreview();
    this.engines?.stop();
    this.ambience?.stop();
    if (hidden && this.scene === 'cinematic') this.music?.setScene('pause');
    if (this.music?.status !== 'paused') this.music?.stop(true);
    if (hidden) void this.ctx?.suspend().catch(() => {});
    else if (this.ctx)
      void this.ctx
        .resume()
        .then(() => {
          if (!this.hidden) this.music?.setScene(this.scene);
        })
        .catch(() => {});
  }
  stopPreview(includeMusic = false) {
    const wasPreviewing = this.previewing;
    if (includeMusic) this.music?.stop(true);
    this.previewGeneration++;
    for (const timer of this.demoTimers) clearTimeout(timer);
    this.demoTimers = [];
    this.previewStage = null;
    if (this.previewing) {
      this.mixer?.reset();
      this.engines?.stop();
      this.ambience?.stop();
      this.previewing = false;
    }
    if (wasPreviewing && !includeMusic && this.ready && !this.hidden && !this.disposed)
      void this.music?.setScene(this.scene);
  }
  async preview() {
    this.stopPreview(true);
    const generation = this.previewGeneration,
      epoch = this.epoch;
    await this.unlock(false);
    if (!this.ready || this.hidden || generation !== this.previewGeneration || epoch !== this.epoch)
      return;
    this.previewing = true;
    this.mixer?.reset();
    this.engines?.stop();
    this.ambience?.stop();
    const later = (seconds: number, fn: () => void) =>
      this.demoTimers.push(setTimeout(fn, seconds * 1000));
    const stage = (scene: AudioScene) => {
      this.previewStage = scene;
      void this.music?.setScene(scene);
      this.ambience?.update(scene, scene === 'race' ? 'rain' : 'clear', null);
    };
    await this.music?.setScene('menu');
    if (generation !== this.previewGeneration || epoch !== this.epoch || this.hidden) return;
    stage('menu');
    this.playCue('ui-open', 0.1);
    later(6, () => {
      stage('editor');
      this.playCue('ui-place', 0.1);
    });
    later(8, () => this.playCue('ui-duplicate', 0.1));
    later(10, () => this.playCue('ui-saved', 0.1));
    later(12, () => {
      stage('countdown');
      this.playCue('countdown', 0.23);
    });
    later(13, () => this.playCue('countdown', 0.23));
    later(14, () => {
      stage('race');
      this.engines?.preview();
      this.playCue('start', 0.23);
    });
    later(15.5, () => this.playCue('land-0-0', 0.11));
    later(17, () => this.playCue('land-2-0', 0.28));
    later(18, () => {
      this.playCue('crash-0', 0.32);
      this.playCue('scrape-0', 0.095, 0.05);
    });
    later(20, () => {
      this.mixer?.stopWhere((v) => v.bus === 'engines');
      stage('results');
      this.playCue('finish', 0.25);
    });
    later(21, () => this.playCue('record', 0.2));
    later(26, () => this.stopPreview());
  }
  diagnostics() {
    return {
      ready: this.ready,
      scene: this.scene,
      hidden: this.hidden,
      state: this.ctx?.state ?? 'locked',
      voices: this.mixer?.voices.size ?? 0,
      engineVoices: [...(this.mixer?.voices ?? [])].filter((v) => v.bus === 'engines').length,
      musicVoices: this.music?.voices ?? 0,
      musicTrack: this.music?.track ?? null,
      previewStage: this.previewStage,
      buffers: this.bank?.buffers.size ?? 0,
      failed: this.bank?.failed ?? [],
      music: this.music?.status ?? 'pending-files',
      history: this.mixer?.history ?? [],
    };
  }
  dispose() {
    this.disposed = true;
    this.epoch++;
    this.stopPreview();
    this.engines?.stop();
    this.ambience?.stop();
    this.music?.dispose();
    this.bank?.dispose();
    this.mixer?.dispose();
    void this.ctx?.close().catch(() => {});
  }
}
