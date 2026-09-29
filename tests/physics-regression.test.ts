import { expect, it } from 'vitest';
import baseline from './fixtures/motoneta-physics.json';
import { physicsTrace } from './physics-fixture';

it.each(baseline)('reproduces ruleset 2 physics: track $track with $bots bots', (expected) => {
  expect(physicsTrace(expected.track, expected.bots)).toEqual(expected);
});
