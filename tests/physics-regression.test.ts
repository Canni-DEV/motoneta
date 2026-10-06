import { expect, it } from 'vitest';
import baseline from './fixtures/motoneta-4-physics.json';
import { physicsTrace } from './physics-fixture';

it.each(baseline)('preserves motoneta-4 track physics: track $track with $bots bots', (expected) => {
  expect(physicsTrace(expected.track, expected.bots)).toEqual(expected);
});
