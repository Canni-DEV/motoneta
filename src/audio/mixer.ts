import { defaultAudioLevels, type AudioBus, type Settings } from '../core/types';
import { busFor, type AudioCueId, type SoundRequest } from './catalog';
import type { AudioBank } from './bank';
function cheerEnvelope(elapsed: number, duration: number) {
  if (elapsed <= 0 || elapsed >= duration) return 0;
  const attack = Math.min(0.4, duration * 0.2);
  const release = Math.min(1.4, duration * 0.55);
  const progress = Math.min(1, elapsed / attack, (duration - elapsed) / release);
  return progress * progress * (3 - 2 * progress);
}
export interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode;
  bus: AudioBus;
  priority: number;
  loop: boolean;
  stop(immediate?: boolean): void;
}
export class AudioMixer {
  master: GainNode;
  buses: Record<AudioBus, GainNode>;
  voices = new Set<Voice>();
  private retiring = new Set<Voice>();
  history: { id: AudioCueId; time: number }[] = [];
  private recent = new Map<string, number>();
  private cheers = new Map<Voice, { start: number; duration: number }>();
  private compressor: DynamicsCompressorNode;
  private applied = false;
  constructor(
    public ctx: AudioContext,
    public bank: AudioBank,
  ) {
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.16;
    this.master.connect(this.compressor);
    this.compressor.connect(ctx.destination);
    this.buses = Object.fromEntries(
      Object.keys(defaultAudioLevels).map((id) => {
        const g = ctx.createGain();
        g.connect(this.master);
        return [id, g];
      }),
    ) as Record<AudioBus, GainNode>;
  }
  apply(settings: Settings) {
    if (!this.applied) {
      this.master.gain.value = settings.volume * 0.75;
      for (const id of Object.keys(this.buses) as AudioBus[])
        this.buses[id].gain.value = settings.audioLevels[id];
      this.applied = true;
      return;
    }
    this.master.gain.setTargetAtTime(settings.volume * 0.75, this.ctx.currentTime, 0.025);
    for (const id of Object.keys(this.buses) as AudioBus[])
      this.buses[id].gain.setTargetAtTime(settings.audioLevels[id], this.ctx.currentTime, 0.025);
  }
  create(
    id: AudioCueId,
    looping: boolean,
    gain: number,
    pan = 0,
    priority = 1,
    delay = 0,
    startAt = this.ctx.currentTime + delay,
  ): Voice | null {
    const buffer = this.bank.buffers.get(id);
    if (!buffer) return null;
    const transient = [...this.voices].filter((v) => !v.loop);
    if ((!looping && transient.length >= 12) || this.voices.size >= 48) {
      const victim = transient.find((v) => v.priority < priority);
      if (!victim) return null;
      victim.stop();
    }
    const source = this.ctx.createBufferSource(),
      g = this.ctx.createGain(),
      p = this.ctx.createStereoPanner();
    const cheering = !looping && id.startsWith('cheer-');
    source.buffer = buffer;
    source.loop = looping;
    g.gain.value = cheering ? 0 : gain;
    if (cheering) {
      // The recordings end during active cheering. Fade into the existing
      // stadium bed well before the WAV's short anti-click fade is reached.
      g.gain.setValueAtTime(0, startAt);
      for (let step = 1; step <= 64; step++) {
        const elapsed = (buffer.duration * step) / 64;
        g.gain.linearRampToValueAtTime(
          gain * cheerEnvelope(elapsed, buffer.duration),
          startAt + elapsed,
        );
      }
    }
    p.pan.value = pan;
    const bus = busFor(id);
    source.connect(g);
    g.connect(p);
    p.connect(this.buses[bus]);
    let stopped = false;
    const cleanup = () => {
      source.disconnect();
      g.disconnect();
      p.disconnect();
      this.voices.delete(voice);
      this.retiring.delete(voice);
      this.cheers.delete(voice);
    };
    const voice: Voice = {
      source,
      gain: g,
      pan: p,
      bus,
      priority,
      loop: looping,
      stop: (immediate = false) => {
        if (stopped && !immediate) return;
        stopped = true;
        // Ramp even a scheduled source to zero before stopping it.
        const t = this.ctx.currentTime;
        const heldGain = g.gain.value;
        g.gain.cancelScheduledValues(t);
        if (cheering && !immediate) {
          g.gain.setValueAtTime(heldGain, t);
          g.gain.linearRampToValueAtTime(0, t + 0.25);
        } else g.gain.setTargetAtTime(0, t, 0.006);
        try {
          source.stop(immediate ? t : t + (cheering ? 0.26 : 0.035));
        } catch {
          cleanup();
        }
        this.voices.delete(voice);
        this.cheers.delete(voice);
        if (immediate) cleanup();
        else this.retiring.add(voice);
      },
    };
    source.onended = cleanup;
    this.voices.add(voice);
    if (cheering && gain > 0) this.cheers.set(voice, { start: startAt, duration: buffer.duration });
    source.start(startAt);
    if (!looping) {
      this.history.push({ id, time: startAt });
      if (this.history.length > 120) this.history.shift();
    }
    return voice;
  }
  crowdBedGain() {
    let reaction = 0;
    for (const cheer of this.cheers.values())
      reaction = Math.max(
        reaction,
        cheerEnvelope(this.ctx.currentTime - cheer.start, cheer.duration),
      );
    // Keep the same uninterrupted crowd loop underneath the reaction. Make a
    // little room at its peak, then restore the murmur as the cheer trails off.
    return 1 - reaction * 0.18;
  }
  play(request: SoundRequest) {
    const now = this.ctx.currentTime;
    const key = request.id.startsWith('cheer-') ? 'cheer' : request.id;
    const cooldown =
      key === 'cheer' ? 3 : request.id === 'turbo' ? 0.7 : request.id.startsWith('ui-') ? 0.06 : 0;
    if (now - (this.recent.get(key) ?? -Infinity) < cooldown && (request.priority ?? 1) < 3) return;
    this.recent.set(key, now);
    return this.create(
      request.id,
      false,
      request.gain ?? 0.15,
      request.pan,
      request.priority,
      request.delay,
    );
  }
  stopWhere(predicate: (v: Voice) => boolean) {
    for (const v of [...this.voices]) if (predicate(v)) v.stop();
  }
  reset(immediate = false) {
    const sources = immediate ? new Set([...this.voices, ...this.retiring]) : this.voices;
    for (const voice of [...sources]) voice.stop(immediate);
    this.recent.clear();
  }
  dispose() {
    this.reset(true);
    for (const b of Object.values(this.buses)) b.disconnect();
    this.master.disconnect();
    this.compressor.disconnect();
  }
}
