import { GAME_ID, RULESET } from '../identity';
import { botAppearance, garageAppearance, initialGarage, normalizeAppearance, type Appearance, type GarageState } from '../appearance';
import type { TimeOfDay, Track, Weather } from './types';
export type { Race } from './types';

export type Difficulty = 'easy' | 'normal' | 'hard';
export type GameMode = 'quick' | 'tournament' | 'versus' | 'practice';
export interface PlayerProfile {
  id: string;
  name: string;
  color: string;
  appearance: Appearance;
}
/** Local customization and progression never travel with a race participant. */
export interface LocalProfile extends PlayerProfile {
  garage: GarageState;
  unlockedMotoneta: boolean;
}
export function localProfile(value: PlayerProfile & Partial<LocalProfile>): LocalProfile {
  const appearance = normalizeAppearance(value.appearance);
  const garage = value.garage ? structuredClone(value.garage) : initialGarage(appearance, value.color);
  const unlockedMotoneta = value.unlockedMotoneta === true;
  if (!unlockedMotoneta) garage.vehicle = 'motocross';
  return { id: value.id, name: value.name, color: value.color, garage, unlockedMotoneta, appearance: garageAppearance(garage) };
}
export function raceProfile(value: PlayerProfile | LocalProfile): PlayerProfile {
  return { id: value.id, name: value.name, color: value.color,
    appearance: 'garage' in value ? garageAppearance(value.garage) : normalizeAppearance(value.appearance) };
}
export interface TrackRef {
  id: string;
  revision: string;
  name: string;
}
export interface RaceCourse {
  track: Track;
  /** Present only on courses whose simulation depends on the loop geometry. */
  loopGeometryVersion?: number;
  ref: TrackRef;
  timeOfDay: TimeOfDay;
  weather: Weather;
}
export interface RaceConfig extends RaceCourse {
  mode: GameMode;
  player: PlayerProfile;
  bots: PlayerProfile[];
  difficulty: Difficulty;
  seed: number;
}
export interface Finish {
  id: string;
  ticks: number | null;
  laps: number[];
  crashes: number;
}
export interface RaceResult {
  config: RaceConfig;
  finishes: Finish[];
  limitTicks: number;
}
export interface Recording {
  game: typeof GAME_ID;
  version: 3;
  ruleset: typeof RULESET;
  config: RaceConfig;
  inputs: [number, number][];
  result: RaceResult;
  termination?: 'finished' | 'abandoned';
}
export interface CompetitionSession {
  presetId?: 'motoneta';
  reward?: 'unlocked' | 'already-unlocked' | 'not-earned';
  id: string;
  mode: 'tournament' | 'versus';
  players: PlayerProfile[];
  bots: PlayerProfile[];
  difficulty: Difficulty;
  courses: RaceCourse[];
  courseIndex: number;
  turnIndex: number;
  results: { course: number; player: string; result: RaceResult; replayId: string }[];
  phase: 'ready' | 'results' | 'complete';
  seed: number;
}
export interface PersonalRecord {
  key: string;
  profileId: string;
  ref: TrackRef;
  config: RaceConfig;
  ticks: number;
  bestLap: number;
  date: string;
  replayId: string;
  lapReplayId: string;
}
export const COLORS = ['#e05a3b', '#358aad', '#e6b853', '#729766', '#ba85df', '#e184b8'];
export const DIFFICULTIES: Record<Difficulty, string> = {
  easy: 'Fácil',
  normal: 'Normal',
  hard: 'Difícil',
};
export const uid = () => crypto.randomUUID();
export const ticksToTime = (ticks: number) => ticks * 0.016;
export const makeBots = (n: number): PlayerProfile[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `bot-${i + 1}`,
    name: `Bot ${i + 1}`,
    color: COLORS[(i + 1) % COLORS.length],
    appearance: botAppearance(i, COLORS[(i + 1) % COLORS.length]),
  }));
export function recordKey(c: RaceConfig) {
  return [
    c.player.id,
    c.ref.id,
    c.ref.revision,
    c.track.laps,
    c.bots.length,
    c.bots.length ? c.difficulty : 'solo',
  ].join('|');
}
