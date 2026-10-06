import { surfaceAt } from '../core/tracks';
import { clamp, type Race, type Weather } from '../core/types';
import { materialFor, relativeSound } from './catalog';
import type { AudioMixer, Voice } from './mixer';
interface BikeVoices {
  layers: Voice[];
  rolling: Voice | null;
  material: string;
}
const engineIds = ['engine-idle', 'engine-mid', 'engine-high'] as const;
const weightsFor = (rpm: number) => {
  const blend = rpm * rpm * (3 - 2 * rpm);
  // Broad, smooth overlap; correlated firing pulses need gains that sum to one.
  return [(1 - blend) ** 2, 2 * blend * (1 - blend), blend ** 2];
};
// A single continuous firing rate through the original 32 / 56 / 88 Hz anchors.
const rateFor = (rpm: number) => ((32 + 40 * rpm + 16 * rpm * rpm) / 32) * (0.85 + rpm * 0.35);
export class EngineAudio {
  private bikes = new Map<number, BikeVoices>();
  constructor(private mixer: AudioMixer) {}
  private createLayers(pan: number, rpm: number, detune: number, startAt: number) {
    if (engineIds.some((id) => !this.mixer.bank.buffers.has(id))) return [];
    const layers = engineIds.flatMap((id) => {
      const v = this.mixer.create(id, true, 0, pan, 1, 0, startAt);
      if (v) v.source.playbackRate.value = this.layerRate(v, rpm, detune);
      return v ? [v] : [];
    });
    if (layers.length === 3) return layers;
    layers.forEach((v) => v.stop());
    return [];
  }
  private layerRate(voice: Voice, rpm: number, detune = 1) {
    const reference = this.mixer.bank.buffers.get('engine-idle')!;
    // Equal loop periods keep both firing irregularities and seams aligned,
    // including the rounding to whole PCM frames when generating each WAV.
    return rateFor(rpm) * (voice.source.buffer!.duration / reference.duration) * detune;
  }
  update(r: Race, weather: Weather) {
    const t = this.mixer.ctx.currentTime;
    for (const p of r.riders.slice(0, 6)) {
      const position =
        p.id === 0 ? { gain: 1, pan: 0 } : relativeSound(p.x, r.riders[0].x, r.track.length);
      if (!position.gain) {
        this.remove(p.id);
        continue;
      }
      const throttle = p.turbo ? 1 : p.previousA ? 0.7 : 0;
      const rpm = clamp((p.speed / 3.25) * 0.8 + throttle * 0.2 + (!p.grounded ? 0.12 : 0), 0, 1);
      const detune = 1 + p.id * 0.012;
      let bike = this.bikes.get(p.id);
      if (!bike) {
        const layers = this.createLayers(position.pan, rpm, detune, t + 0.02);
        if (layers.length !== 3) continue;
        bike = { layers, rolling: null, material: '' };
        this.bikes.set(p.id, bike);
      }
      const weights = weightsFor(rpm);
      const recovery = p.recovery ? 0.18 : p.overheated ? 0.35 : 1;
      const race = r;
      const stopped = race.finishes.some(
        (f) => f.id === [race.config.player, ...race.config.bots][p.id]?.id,
      );
      bike.layers.forEach((v, i) => {
        v.gain.gain.setTargetAtTime(
          stopped ? 0 : (0.12 + throttle * 0.025) * position.gain * weights[i] * recovery,
          t,
          0.12,
        );
        v.source.playbackRate.setTargetAtTime(this.layerRate(v, rpm, detune), t, 0.12);
        v.pan.pan.setTargetAtTime(position.pan, t, 0.07);
      });
      const material = materialFor(p.motion.kind==='loop' ? 'dirt' : surfaceAt(r.track, p.x, p.lane)?.surface, weather);
      const moving = p.grounded && p.speed > 0.2 && !p.recovery && !stopped;
      if (bike.material !== material || (!bike.rolling && moving)) {
        bike.rolling?.stop();
        bike.material = material;
        bike.rolling = moving
          ? this.mixer.create(`roll-${material}`, true, 0, position.pan, 0)
          : null;
      }
      if (bike.rolling) {
        bike.rolling.gain.gain.setTargetAtTime(
          moving ? 0.0225 * position.gain * clamp(p.speed / 3, 0, 1) : 0,
          t,
          0.025,
        );
        bike.rolling.source.playbackRate.setTargetAtTime(0.7 + clamp(p.speed / 5, 0, 0.8), t, 0.1);
        bike.rolling.pan.pan.setTargetAtTime(position.pan, t, 0.07);
      }
    }
    for (const id of this.bikes.keys()) if (!r.riders.some((p) => p.id === id)) this.remove(id);
  }
  private remove(id: number) {
    const b = this.bikes.get(id);
    b?.layers.forEach((v) => v.stop());
    b?.rolling?.stop();
    this.bikes.delete(id);
  }
  preview() {
    const t = this.mixer.ctx.currentTime + 0.02;
    this.createLayers(0, 0, 1, t).forEach((v, layer) => {
      for (let i = 0; i <= 100; i++) {
        const seconds = i / 20,
          rpm = seconds < 3 ? seconds / 3 : 1 - (seconds - 3) / 2;
        v.gain.gain.linearRampToValueAtTime(weightsFor(rpm)[layer] * 0.145, t + seconds);
        v.source.playbackRate.linearRampToValueAtTime(this.layerRate(v, rpm), t + seconds);
      }
    });
  }
  stop() {
    for (const id of [...this.bikes.keys()]) this.remove(id);
  }
}
