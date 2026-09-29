import { segmentAt } from '../core/tracks';
import { clamp, type Race, type Weather } from '../core/types';
import { materialFor, relativeSound } from './catalog';
import type { AudioMixer, Voice } from './mixer';
interface BikeVoices {
  layers: Voice[];
  rolling: Voice | null;
  material: string;
}
const engineIds = ['engine-idle', 'engine-mid', 'engine-high'] as const;
const weightsFor = (rpm: number) => [
  Math.max(0, 1 - rpm * 2),
  1 - Math.abs(rpm * 2 - 1),
  Math.max(0, rpm * 2 - 1),
];
export class EngineAudio {
  private bikes = new Map<number, BikeVoices>();
  constructor(private mixer: AudioMixer) {}
  update(r: Race, weather: Weather) {
    const t = this.mixer.ctx.currentTime;
    for (const p of r.riders.slice(0, 6)) {
      const position =
        p.id === 0 ? { gain: 1, pan: 0 } : relativeSound(p.x, r.riders[0].x, r.track.length);
      if (!position.gain) {
        this.remove(p.id);
        continue;
      }
      let bike = this.bikes.get(p.id);
      if (!bike) {
        if (engineIds.some((id) => !this.mixer.bank.buffers.has(id))) continue;
        const layers = engineIds.flatMap((id) => {
          const v = this.mixer.create(id, true, 0, position.pan);
          return v ? [v] : [];
        });
        if (layers.length !== 3) {
          layers.forEach((v) => v.stop());
          continue;
        }
        bike = { layers, rolling: null, material: '' };
        this.bikes.set(p.id, bike);
      }
      const throttle = p.turbo ? 1 : p.previousA ? 0.7 : 0;
      const rpm = clamp((p.speed / 3.25) * 0.8 + throttle * 0.2 + (!p.grounded ? 0.12 : 0), 0, 1);
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
          0.06,
        );
        v.source.playbackRate.setTargetAtTime((0.85 + rpm * 0.35) * (1 + p.id * 0.012), t, 0.08);
        v.pan.pan.setTargetAtTime(position.pan, t, 0.07);
      });
      const material = materialFor(segmentAt(r.track, p.x, p.lane)?.surface, weather);
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
          moving ? 0.045 * position.gain * clamp(p.speed / 3, 0, 1) : 0,
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
    const t = this.mixer.ctx.currentTime;
    engineIds.forEach((id, layer) => {
      const v = this.mixer.create(id, true, 0);
      if (!v) return;
      for (let i = 0; i <= 100; i++) {
        const seconds = i / 20,
          rpm = seconds < 3 ? seconds / 3 : 1 - (seconds - 3) / 2;
        v.gain.gain.linearRampToValueAtTime(weightsFor(rpm)[layer] * 0.145, t + seconds);
        v.source.playbackRate.linearRampToValueAtTime(0.85 + rpm * 0.35, t + seconds);
      }
    });
  }
  stop() {
    for (const id of [...this.bikes.keys()]) this.remove(id);
  }
}
