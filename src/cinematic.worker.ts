/// <reference lib="webworker" />
import { heightAt } from './core/tracks';
import { Playback, validateRecording } from './core/recording';
import type { Recording } from './core/game';
import type { CinematicEvent, CinematicMoment, CinematicPose, CinematicTimeline, SlowMotionWindow } from './cinematic-timeline';
import { WORLD_SCALE as SCALE, LANE_WIDTH as LANE } from './world-space';

type Candidate = { lap: number; frame: number; score: number };

export function analyzeCinematicRecording(source: Recording): CinematicTimeline {
  const recording = validateRecording(source);
  const playback = new Playback(recording);
  const events: CinematicEvent[] = [];
  const moments: CinematicMoment[] = [];
  const poses: CinematicPose[] = [];
  const lapEnds: number[] = [];
  const candidates: Candidate[] = [];
  let airborne: { frame: number; lap: number; apex: number } | null = null;
  let duel: { frame: number; lap: number; ticks: number; closest: number; rankGain: number } | null = null;
  let crash: { frame: number; lap: number } | null = null;
  let previousRank = 0;
  let previousLap = 0;
  const closeDuel = (end: number) => {
    if (duel && duel.ticks >= 20) {
      const peak = duel.frame + Math.floor(duel.ticks / 2);
      const score = 1 + duel.ticks / 60 + (65 - duel.closest) / 35 + duel.rankGain * 3;
      moments.push({ type: 'duel', lap: duel.lap, start: duel.frame, peak, end, score });
      candidates.push({ lap: duel.lap, frame: peak, score });
    }
    duel = null;
  };
  const closeJump = (end: number) => {
    if (airborne) {
      const duration = end - airborne.frame;
      if (duration >= 8) {
        const peak = airborne.frame + Math.floor(duration / 2);
        const score = 2 + airborne.apex * 2 + duration / 55;
        moments.push({ type: 'jump', lap: airborne.lap, start: airborne.frame, peak, end, score });
        if (duration >= 18 && airborne.apex > 0.25)
          candidates.push({ lap: airborne.lap, frame: peak, score });
      }
    }
    airborne = null;
  };
  while (!playback.done) {
    playback.step();
    const race = playback.race;
    const player = race.riders[0];
    const lap = Math.min(recording.config.track.laps - 1, race.laps.length);
    if (race.frame % 6 === 0 || playback.done)
      poses.push({ frame: race.frame, x: player.x * SCALE, y: player.height * SCALE, z: (player.lane - 1.5) * LANE });
    for (const event of race.events) {
      if (event.rider !== 0 || !['start', 'jump', 'land', 'crash', 'lap', 'finish'].includes(event.type)) continue;
      events.push({ frame: race.frame, type: event.type as CinematicEvent['type'], lap });
      if (event.type === 'jump') airborne = { frame: race.frame, lap, apex: 0 };
      if (event.type === 'land' || event.type === 'crash') closeJump(race.frame);
      if (event.type === 'crash') crash = { frame: race.frame, lap };
      if (event.type === 'lap') lapEnds.push(race.frame);
      if (event.type === 'finish')
        moments.push({ type: 'finish', lap, start: Math.max(180, race.frame - 90), peak: race.frame, end: race.frame, score: 10 });
    }
    if (airborne) {
      const floor = heightAt(race.track, player.x, player.lane);
      airborne.apex = Math.max(airborne.apex, (player.height - floor) * SCALE);
    }
    if (crash && (player.crashPhase === 'none' || race.frame - crash.frame > 180)) {
      moments.push({ type: 'crash', lap: crash.lap, start: crash.frame, peak: crash.frame, end: race.frame, score: 5 });
      crash = null;
    }
    const nearest = race.riders.slice(1).reduce((best, other) => {
      const relative = Math.abs((((other.x - player.x + race.track.length / 2) % race.track.length) + race.track.length) % race.track.length - race.track.length / 2);
      return Math.abs(other.lane - player.lane) <= 1.2 && relative < best ? relative : best;
    }, Infinity);
    if (race.phase === 'racing' && nearest < 65 && !player.recovery) {
      if (!duel) duel = { frame: race.frame, lap, ticks: 0, closest: nearest, rankGain: 0 };
      duel.ticks++;
      duel.closest = Math.min(duel.closest, nearest);
      if (previousRank && race.rank < previousRank) {
        events.push({ frame: race.frame, type: 'duel', lap });
        duel.rankGain += previousRank - race.rank;
      }
    } else closeDuel(race.frame);
    if (race.laps.length > previousLap) {
      closeDuel(race.frame);
      previousLap = race.laps.length;
    }
    previousRank = race.rank;
  }
  const lastFrame = playback.race.frame;
  closeJump(lastFrame);
  closeDuel(lastFrame);
  if (crash) moments.push({ type: 'crash', lap: crash.lap, start: crash.frame, peak: crash.frame, end: lastFrame, score: 5 });
  while (lapEnds.length < recording.config.track.laps) lapEnds.push(lastFrame);
  moments.sort((a, b) => a.start - b.start || b.score - a.score);
  const best = new Map<number, Candidate>();
  for (const candidate of candidates) {
    const prior = best.get(candidate.lap);
    if (!prior || candidate.score > prior.score) best.set(candidate.lap, candidate);
  }
  const slowMotion: SlowMotionWindow[] = [...best.values()].map((candidate) => ({
    lap: candidate.lap,
    start: Math.max(0, candidate.frame - 60),
    end: Math.min(lastFrame, candidate.frame + 60),
  }));
  slowMotion.sort((a, b) => a.start - b.start);
  return { events, moments, poses, lapEnds, slowMotion, lastFrame };
}

if (typeof self !== 'undefined')
  self.onmessage = (event: MessageEvent<Recording>) => {
    try {
      self.postMessage({ timeline: analyzeCinematicRecording(event.data) });
    } catch (error) {
      self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
  };
