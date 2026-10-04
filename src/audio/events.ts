import { heightAt, segmentAt } from '../core/tracks';
import type { Race, Weather } from '../core/types';
import {
  landingLevel,
  materialFor,
  relativeSound,
  variation,
  type AudioCueId,
  type SoundRequest,
} from './catalog';

/** Pure presentation state. Does not modify Race, its seed, or recorded inputs. */
export class AudioEvents {
  frame = -1;
  private count = -1;
  private riders = new Map<
    number,
    {
      recovery: number;
      crashPhase: Race['riders'][number]['crashPhase'];
      turbo: boolean;
      wheelie: number;
      pieceX?: number;
      bumpAt: number;
      airborneCheer: boolean;
    }
  >();
  reset() {
    this.frame = -1;
    this.count = -1;
    this.riders.clear();
  }
  consume(r: Race, weather: Weather): SoundRequest[] {
    if (r.frame <= this.frame) return [];
    this.frame = r.frame;
    const out: SoundRequest[] = [];
    const count = Math.ceil(r.countdown / 60);
    if (count > 0 && count !== this.count) out.push({ id: 'countdown', gain: 0.23, priority: 3 });
    this.count = count;
    const finish = r.events.some((e) => e.rider === 0 && e.type === 'finish');
    for (const e of r.events) {
      const p = r.riders.find((p) => p.id === e.rider);
      if (!p) continue;
      const position =
        e.rider === 0 ? { gain: 1, pan: 0 } : relativeSound(p.x, r.riders[0].x, r.track.length);
      if (!position.gain) continue;
      const push = (id: AudioCueId, gain: number, priority = 1, delay = 0) =>
        out.push({ id, gain: gain * position.gain, pan: position.pan, priority, delay });
      if (e.type === 'land') {
        const level = landingLevel(e.impactSpeed ?? 2);
        push(
          `land-${level}-${variation(e.frame, e.rider, 3) as 0 | 1 | 2}`,
          [0.11, 0.19, 0.28][level],
        );
        push(`touch-${materialFor(e.surface, weather)}`, 0.055 + level * 0.025);
      }
      if (e.type === 'crash') {
        push(
          `crash-${variation(e.frame, e.rider, 3) as 0 | 1 | 2}`,
          e.cause === 'backflip' ? 0.24 : 0.32,
          2,
        );
        push(`scrape-${variation(e.frame, e.rider, 2) as 0 | 1}`, 0.095, 1, 0.05);
      }
      if (e.type === 'jump') push('jump', 0.06);
      if (e.rider !== 0) continue;
      if (e.type === 'start') push('start', 0.28, 3);
      if (e.type === 'overheat') push('overheat', 0.24, 3);
      if (e.type === 'cool') push(e.cause === 'surface' ? 'cool' : 'recovered', 0.2, 3);
      if (e.type === 'lap' && !finish) {
        push(r.track.laps > 1 && r.previousLap === r.track.laps - 1 ? 'last-lap' : 'lap', 0.22, 3);
        push('cheer-1', 0.09, 0);
      }
      if (e.type === 'finish') {
        push(r.timeUp ? 'dnf' : 'finish', 0.25, 3);
        if (!r.timeUp) push('cheer-2', 0.12, 0);
      }
    }
    for (const p of r.riders) {
      const previous = this.riders.get(p.id);
      const s = p.motion.kind === 'loop' ? undefined : segmentAt(r.track, p.x, p.lane);
      let bumpAt = previous?.bumpAt ?? -100;
      const position =
        p.id === 0 ? { gain: 1, pan: 0 } : relativeSound(p.x, r.riders[0].x, r.track.length);
      if (previous && r.phase === 'racing') {
        if (p.crashPhase === 'rolling' && p.crashAge > 0 && p.crashAge % 15 === 0)
          out.push({
            id: `scrape-${variation(r.frame, p.id, 2) as 0 | 1}`,
            gain: 0.055 * position.gain,
            pan: position.pan,
            priority: 1,
          });
        if (previous.crashPhase === 'down' && p.crashPhase === 'mounting')
          out.push({ id: 'bump', gain: 0.07 * position.gain, pan: position.pan, priority: 1 });
        if (previous.recovery > 0 && p.recovery === 0 && p.id === 0)
          out.push({ id: 'recovery', gain: 0.14, priority: 2 });
        if (!previous.turbo && p.turbo && p.id === 0)
          out.push({ id: 'turbo', gain: 0.035, priority: 0 });
        if (
          p.grounded &&
          !p.recovery &&
          p.speed > 0.5 &&
          r.frame - bumpAt > 8 &&
          ((s?.surface === 'bump' && previous.pieceX !== s.x && p.wheelie < 0.2) ||
            (previous.wheelie > 0.2 && p.wheelie <= 0.02))
        ) {
          out.push({ id: 'bump', gain: 0.1 * position.gain, pan: position.pan, priority: 1 });
          bumpAt = r.frame;
        }
      }
      let airborneCheer = p.grounded ? false : (previous?.airborneCheer ?? false);
      if (
        p.id === 0 &&
        !p.grounded &&
        !airborneCheer &&
        p.height - heightAt(r.track, p.x, p.lane) > 48
      ) {
        airborneCheer = true;
        out.push({ id: 'cheer-0', gain: 0.08, priority: 0 });
      }
      this.riders.set(p.id, {
        recovery: p.recovery,
        crashPhase: p.crashPhase,
        turbo: p.turbo,
        wheelie: p.wheelie,
        pieceX: s?.x,
        bumpAt,
        airborneCheer,
      });
    }
    return out;
  }
}
