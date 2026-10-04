import type { Finish, RaceConfig } from './game';
import type { TimeOfDay } from './time-of-day';
import type { Weather } from './weather';
export type { TimeOfDay } from './time-of-day';
export type { Weather } from './weather';

export type PieceId =
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T';
export type Surface = 'dirt' | 'mud' | 'grass' | 'cool' | 'bump';
export interface Segment {
  x: number;
  length: number;
  profile: [number, number][];
  lanes: number;
  surface: Surface;
  boost: boolean;
  piece: string;
}
export interface Track {
  id: string;
  name: string;
  subtitle: string;
  number: number;
  length: number;
  segments: Segment[];
  laps: number;
  color: string;
  custom?: boolean;
}
export interface Rider {
  id: number;
  x: number;
  /** Timing/rank coordinate; physical x can move backwards inside a loop. */
  progress: number;
  motion: RiderMotion;
  lane: number;
  height: number;
  vy: number;
  speed: number;
  tilt: number;
  grounded: boolean;
  heat: number;
  recovery: number;
  overheated: boolean;
  invincible: number;
  crashes: number;
  targetLane: number;
  color: number;
  previousA: boolean;
  wheelie: number;
  wheelieVelocity: number;
  turbo: boolean;
  crashKind: 'impact' | 'backflip';
  crashAge: number;
  crashStartTilt: number;
  crashPhase: 'none' | 'rolling' | 'down' | 'mounting';
  crashPhaseAge: number;
  crashRollDuration: number;
  crashDownRemaining: number;
  crashVelocity: number;
  crashExitX: number | null;
}
export type RiderMotion = { kind: 'track' } | {
  kind: 'loop'; origin: number; distance: number; age: number;
  vx: number; vy: number; vlane: number;
} | {
  kind: 'loop-air'; origin: number; age: number; vx: number; vlane: number;
  basis: [number, number, number][]; basisPitch: number;
  pendingCrash: 'impact' | 'backflip' | null; ignoreRoad: number;
  /** Persistent contact cluster; short gaps must not restart a blocked fall. */
  contact: { origin: number; age: number; gap: number; anchor: [number, number, number] } | null;
};
export type RacePhase = 'countdown' | 'racing' | 'finished';
export type GameEvent = {
  type: 'start' | 'jump' | 'land' | 'crash' | 'cool' | 'overheat' | 'lap' | 'finish';
  rider: number;
  frame: number;
  /** Presentation-only context. Never serialized into inputs or used by physics. */
  impactSpeed?: number;
  surface?: Surface;
  cause?: 'impact' | 'backflip' | 'surface' | 'recovered';
};
export interface Race {
  config: RaceConfig;
  finishes: Finish[];
  riderLaps: number[][];
  limitTicks: number;
  track: Track;
  frame: number;
  elapsed: number;
  countdown: number;
  phase: RacePhase;
  riders: Rider[];
  laps: number[];
  previousLap: number;
  events: GameEvent[];
  seed: number;
  rank: number;
  timeUp: boolean;
}
export const Input = {
  A: 1,
  B: 2,
  UP: 4,
  DOWN: 8,
  LEFT: 16,
  RIGHT: 32,
  START: 64,
  SELECT: 128,
} as const;
export const HZ = 60.0988138974405;
export const STEP_MS = 1000 / HZ;
export interface VfxSettings {
  race: boolean;
  tracks: boolean;
  ambient: boolean;
  intensity: 'subtle' | 'balanced' | 'strong';
}
export const defaultVfxSettings: VfxSettings = {
  race: true,
  tracks: true,
  ambient: true,
  intensity: 'balanced',
};
export interface Settings {
  timeOfDay: TimeOfDay;
  weather: Weather;
  volume: number;
  audioLevels: AudioLevels;
  quality: 'low' | 'high';
  surfaceDetail: 'light' | 'detailed';
  vfx: VfxSettings;
  bloom: boolean;
  cameraShake: boolean;
  reducedMotion: boolean;
  attractReplays: boolean;
  bindings: Record<string, string>;
}
export type AudioBus = 'engines' | 'effects' | 'ambience' | 'ui' | 'music';
export type AudioLevels = Record<AudioBus, number>;
export const defaultAudioLevels: AudioLevels = {
  engines: 1,
  effects: 1,
  ambience: 1,
  ui: 1,
  music: 1,
};
export const defaultSettings: Settings = {
  timeOfDay: 'morning',
  weather: 'clear',
  volume: 0.45,
  audioLevels: { ...defaultAudioLevels },
  quality: 'high',
  surfaceDetail: 'detailed',
  vfx: { ...defaultVfxSettings },
  bloom: true,
  cameraShake: false,
  reducedMotion: false,
  attractReplays: true,
  bindings: {
    A: 'KeyZ',
    B: 'KeyX',
    UP: 'ArrowUp',
    DOWN: 'ArrowDown',
    LEFT: 'ArrowLeft',
    RIGHT: 'ArrowRight',
    START: 'Enter',
    SELECT: 'ShiftRight',
  },
};
export const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
export const q = (n: number) => Math.round(n * 256) / 256;
