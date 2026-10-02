import { GAME_ID, RULESET } from '../identity';
import { botAppearance, type Appearance } from '../appearance';
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
export interface TrackRef {
  id: string;
  revision: string;
  name: string;
}
export interface RaceCourse {
  track: Track;
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
  version: 2;
  ruleset: typeof RULESET;
  config: RaceConfig;
  inputs: [number, number][];
  result: RaceResult;
  termination?: 'finished' | 'abandoned';
}
export interface CompetitionSession {
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
