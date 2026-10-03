import { expect, it } from 'vitest';
import { World } from '../src/renderer';
import { testRace } from './race-fixture';

it('interpolation snapshots do not alias riders and shrink when ghosts/riders leave', () => {
  // capture() only owns the interpolation buffer; no WebGL context is needed.
  const world = Object.create(World.prototype) as World;
  world.previous = [];
  const race = testRace(undefined, 5);
  world.capture(race);
  const snapshot = world.previous[0];
  const oldX = snapshot.x;
  race.riders[0].x += 12;
  race.riders[0].crashPhase = 'rolling';
  race.riders[0].crashPhaseAge = 3;
  expect(snapshot.x).toBe(oldX);
  world.capture(race);
  expect(world.previous[0]).toBe(snapshot);
  expect(snapshot).toMatchObject({ x: oldX + 12, crashPhase: 'rolling', crashPhaseAge: 3 });
  race.riders.length = 1;
  world.capture(race);
  expect(world.previous).toHaveLength(1);
});
