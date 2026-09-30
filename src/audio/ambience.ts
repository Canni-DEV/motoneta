import type { Race, Weather } from '../core/types';
import type { AudioCueId, AudioScene } from './catalog';
import type { AudioMixer, Voice } from './mixer';
export class AmbienceAudio {
  private loops = new Map<AudioCueId, Voice>();
  constructor(private mixer: AudioMixer) {}
  update(scene: AudioScene, weather: Weather, race: Race | null) {
    const game = scene === 'race' || scene === 'countdown' || scene === 'cinematic';
    const level = scene === 'pause' ? 0.13 : game ? 1 : 0.28;
    const player = race?.riders[0];
    const levels: Partial<Record<AudioCueId, number>> = {
      crowd: 0.052 * level * (weather === 'snow' ? 0.65 : 1) * this.mixer.crowdBedGain(),
      wind: 0.013 * level * (weather === 'snow' ? 1.7 : 1),
      rain: weather === 'rain' ? 0.052 * level : 0,
      air: game && player && !player.grounded ? 0.028 * Math.min(1, player.speed / 4) : 0,
    };
    for (const [key, gain] of Object.entries(levels)) {
      const id = key as AudioCueId;
      let v = this.loops.get(id);
      if (!gain) {
        v?.stop();
        this.loops.delete(id);
        continue;
      }
      if (!v) {
        v = this.mixer.create(id, true, 0, 0, 0) ?? undefined;
        if (v) this.loops.set(id, v);
      }
      v?.gain.gain.setTargetAtTime(gain, this.mixer.ctx.currentTime, 0.3);
    }
  }
  stop() {
    for (const v of this.loops.values()) v.stop();
    this.loops.clear();
  }
}
