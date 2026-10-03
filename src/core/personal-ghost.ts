import {
  makeBots,
  recordKey,
  type Difficulty,
  type PersonalRecord,
  type PlayerProfile,
  type RaceConfig,
  type RaceCourse,
  type Recording,
} from './game';
import { validateRecording } from './recording';

/** An attempt's frozen comparison target; never persisted with the new recording. */
export interface PersonalGhostReference {
  key: string;
  replayId: string;
  ticks: number;
  laps: number[];
}

export function quickRaceConfig(
  course: RaceCourse,
  player: PlayerProfile,
  bots: number,
  difficulty: Difficulty,
): RaceConfig {
  return structuredClone({ ...course, mode: 'quick', player, bots: makeBots(bots), difficulty, seed: 1984 });
}

export function personalRecord(records: readonly PersonalRecord[], config: RaceConfig) {
  const key = recordKey(config);
  return records.find((record) => record.key === key && record.profileId === config.player.id);
}

export function preparePersonalGhost(record: PersonalRecord, config: RaceConfig, source: unknown) {
  const replay = validateRecording(source);
  const own = replay.result.finishes.find((finish) => finish.id === replay.config.player.id);
  if (
    record.key !== recordKey(config) ||
    record.profileId !== config.player.id ||
    recordKey(replay.config) !== record.key ||
    own?.ticks !== record.ticks ||
    own.laps.length !== config.track.laps ||
    own.laps.at(-1) !== record.ticks
  ) throw new Error('La repetición no corresponde a tu récord de esta configuración.');
  const reference: PersonalGhostReference = {
    key: record.key,
    replayId: record.replayId,
    ticks: own.ticks,
    laps: [...own.laps],
  };
  return { replay, reference } satisfies { replay: Recording; reference: PersonalGhostReference };
}

export function ghostLapComparison(laps: readonly number[], reference: PersonalGhostReference, index: number) {
  if (index < 0 || index >= laps.length || index >= reference.laps.length) return null;
  const ownTicks = laps[index] - (laps[index - 1] ?? 0);
  const ghostTicks = reference.laps[index] - (reference.laps[index - 1] ?? 0);
  return {
    lap: index + 1,
    ownTicks,
    ghostTicks,
    lapDeltaTicks: ownTicks - ghostTicks,
    totalDeltaTicks: laps[index] - reference.laps[index],
  };
}
