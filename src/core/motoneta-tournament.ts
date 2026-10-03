import { makeBots, raceProfile, type CompetitionSession, type PlayerProfile } from './game';
import { BUILTINS } from './maps';
import type { TimeOfDay, Weather } from './types';

const conditions: [TimeOfDay, Weather][] = [
  ['morning', 'clear'], ['afternoon', 'rain'], ['morning', 'snow'],
  ['night', 'clear'], ['night', 'rain'],
];
export function motonetaCourses() {
  return BUILTINS.map((course, index) => ({
    ...structuredClone(course), track: { ...structuredClone(course.track), laps: 2 },
    timeOfDay: conditions[index][0], weather: conditions[index][1],
  }));
}
export function motonetaTournament(player: PlayerProfile): CompetitionSession {
  return { id: crypto.randomUUID(), mode: 'tournament', presetId: 'motoneta',
    players: [raceProfile(player)], bots: makeBots(3), difficulty: 'hard',
    courses: motonetaCourses(), courseIndex: 0, turnIndex: 0, results: [], phase: 'ready', seed: 1984 };
}
