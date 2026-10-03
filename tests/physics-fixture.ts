import { createHash } from 'node:crypto';
import { makeBots } from '../src/core/game';
import { createRace, stepRace } from '../src/core/racing';
import { getTrack } from '../src/core/tracks';
import { defaultAppearance } from '../src/appearance';

export function physicsTrace(trackIndex: number, bots: number) {
  const track = getTrack(trackIndex);
  const race = createRace({
    track,
    ref: { id: track.id, revision: 'baseline', name: track.name },
    mode: 'quick',
    player: { id: 'player', name: 'Player', color: '#e05a3b', appearance: defaultAppearance('#e05a3b') },
    bots: makeBots(bots),
    difficulty: 'normal',
    seed: 1984,
    timeOfDay: 'morning',
    weather: 'clear',
  });
  const digest = createHash('sha256');
  while (race.phase !== 'finished') {
    const tick = race.frame;
    const input = (tick % 420 < 300 ? 2 : 1) | (tick % 160 < 20 ? 16 : 0);
    stepRace(race, input);
    if (race.frame % 30 === 0 || String(race.phase) === 'finished')
      digest.update(
        JSON.stringify([
          race.frame,
          race.elapsed,
          race.phase,
          race.seed,
          race.riders,
          race.laps,
          race.riderLaps,
          race.events,
          race.rank,
          race.timeUp,
          race.finishes,
        ]),
      );
  }
  return {
    track: trackIndex,
    bots,
    hash: digest.digest('hex'),
    frames: race.frame,
    finishes: race.finishes,
  };
}
