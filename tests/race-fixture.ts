import { makeBots, type Recording } from '../src/core/game';
import { emptyDesign, mapTrack, validateMap, type MapDesign } from '../src/core/maps';
import { createRace, stepRace } from '../src/core/racing';
import { getTrack } from '../src/core/tracks';
import type { Track } from '../src/core/types';

export function testRace(track: Track = getTrack(0), bots = 0) {
  return createRace({
    track,
    ref: { id: track.id, revision: 'test', name: track.name },
    mode: 'quick',
    player: { id: 'player', name: 'Player', color: '#e05a3b' },
    bots: makeBots(bots),
    difficulty: 'normal',
    seed: 1984,
    timeOfDay: 'morning',
    weather: 'clear',
  });
}
export function testTrack(options: Partial<MapDesign> = {}) {
  return mapTrack(
    validateMap({ ...emptyDesign(), id: 'test-track', length: 640, laps: 1, ...options }),
  );
}
export function simulateInputs(recording: Recording) {
  const race = createRace(recording.config);
  for (const [input, count] of recording.inputs)
    for (let i = 0; i < count; i++) stepRace(race, input);
  return race;
}

export { placedPiece } from '../src/core/maps';
export { PIECES } from '../src/core/tracks';
