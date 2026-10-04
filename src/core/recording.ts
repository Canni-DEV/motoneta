import { FILE_HEADER, FORMAT_VERSION, GAME_ID, RULESET } from '../identity';
import { isAppearance, normalizeAppearance } from '../appearance';
import type { Race, RaceConfig, Recording } from './game';
import { designFromTrack, mapTrack, validateMap } from './maps';
import {
  abandonPlayer,
  completeRace,
  createRace,
  isFinished,
  raceResult,
  stepRace,
} from './racing';
import { isTimeOfDay } from './time-of-day';
import { isWeather } from './weather';
import { compatibleLoopGeometry, loopGeometryMetadata } from './loop-geometry';

export type { Recording } from './game';
class InputReader {
  private index = 0;
  private remaining = 0;
  private value = 0;
  constructor(private inputs: Recording['inputs']) {}
  next(): number | null {
    if (!this.remaining) {
      const run = this.inputs[this.index++];
      if (!run) return null;
      [this.value, this.remaining] = run;
    }
    this.remaining--;
    return this.value;
  }
}
export function newRecording(config: RaceConfig): Recording {
  const race = createRace(config);
  return {
    ...FILE_HEADER,
    ruleset: RULESET,
    config: structuredClone(race.config),
    inputs: [],
    result: raceResult(race),
  };
}
export function appendInput(r: Recording, input: number) {
  const last = r.inputs.at(-1);
  if (last?.[0] === input) last[1]++;
  else r.inputs.push([input, 1]);
}
export class Playback {
  race: Race;
  private cursor: InputReader;
  done = false;
  constructor(public recording: Recording) {
    if (!compatibleLoopGeometry(recording.config))
      throw new Error('Repetición incompatible con la geometría actual del loop.');
    this.race = createRace(recording.config);
    this.cursor = new InputReader(recording.inputs);
  }
  step() {
    if (this.done) return;
    const input = this.cursor.next();
    if (input === null) {
      if (this.recording.termination === 'abandoned') abandonPlayer(this.race);
      this.done = true;
      return;
    }
    stepRace(this.race, input);
    this.done = isFinished(this.race, 0);
  }
}
export function validateRecording(value: unknown): Recording {
  const r = value as Recording,
    c = r?.config;
  const fail = () => {
    throw new Error('Repetición incompatible o dañada.');
  };
  if (
    r?.game !== GAME_ID ||
    r.version !== FORMAT_VERSION ||
    r.ruleset !== RULESET ||
    !c ||
    !['quick', 'tournament', 'versus', 'practice'].includes(c.mode) ||
    !['easy', 'normal', 'hard'].includes(c.difficulty) ||
    !isTimeOfDay(c.timeOfDay) ||
    !isWeather(c.weather) ||
    !Number.isInteger(c.seed) ||
    c.seed < 0 ||
    c.seed > 4294967295 ||
    !Array.isArray(c.bots) ||
    c.bots.length > 5 ||
    !c.ref ||
    typeof c.ref.id !== 'string' ||
    typeof c.ref.revision !== 'string' ||
    !Array.isArray(r.inputs) ||
    r.inputs.length > 300000
  )
    fail();
  if (!c.track || !Array.isArray(c.track.segments) || c.track.segments.length > 2500) fail();
  if (!compatibleLoopGeometry(c))
    throw new Error('Repetición incompatible con la geometría actual del loop.');
  const checked = validateMap(designFromTrack(c.track));
  const ids = new Set<string>();
  for (const p of [c.player, ...c.bots]) {
    if (
      !p ||
      typeof p.id !== 'string' ||
      !p.id ||
      ids.has(p.id) ||
      typeof p.name !== 'string' ||
      !p.name.trim() ||
      p.name.length > 40 ||
      !/^#[0-9a-f]{6}$/i.test(p.color) ||
      !isAppearance(p.appearance)
    )
      fail();
    ids.add(p.id);
  }
  const track = mapTrack(checked);
  track.id = c.track.id;
  track.name = c.track.name;
  track.custom = c.track.custom;
  track.number = c.track.number;
  const config: RaceConfig = {
    track,
    ...loopGeometryMetadata(track),
    ref: { id: c.ref.id, revision: checked.revision, name: track.name },
    mode: c.mode,
    player: { id: c.player.id, name: c.player.name, color: c.player.color, appearance: normalizeAppearance(c.player.appearance) },
    bots: c.bots.map((p) => ({ id: p.id, name: p.name, color: p.color, appearance: normalizeAppearance(p.appearance) })),
    difficulty: c.difficulty,
    seed: c.seed,
    timeOfDay: c.timeOfDay,
    weather: c.weather,
  };
  const race = createRace(config);
  let frames = 0;
  for (const run of r.inputs) {
    if (
      !Array.isArray(run) ||
      run.length !== 2 ||
      !Number.isInteger(run[0]) ||
      run[0] < 0 ||
      run[0] > 255 ||
      !Number.isInteger(run[1]) ||
      run[1] < 1
    )
      fail();
    frames += run[1];
    if (frames > race.limitTicks + 180) fail();
    for (let i = 0; i < run[1]; i++) {
      if (isFinished(race, 0)) fail();
      stepRace(race, run[0]);
    }
  }
  if (r.termination && !['finished', 'abandoned'].includes(r.termination)) fail();
  if (r.termination === 'abandoned') {
    if (isFinished(race, 0)) fail();
    abandonPlayer(race);
  } else if (!isFinished(race, 0)) fail();
  completeRace(race);
  return {
    ...FILE_HEADER,
    ruleset: RULESET,
    config,
    inputs: r.inputs.map((v) => [v[0], v[1]]),
    result: raceResult(race),
    termination: r.termination ?? 'finished',
  };
}
