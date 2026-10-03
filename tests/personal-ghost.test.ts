import { describe, expect, it } from 'vitest';
import { defaultAppearance } from '../src/appearance';
import { recordKey, type PersonalRecord, type RaceConfig } from '../src/core/game';
import { BUILTINS, emptyDesign, mapCourse, validateMap } from '../src/core/maps';
import { ghostLapComparison, personalRecord, preparePersonalGhost, quickRaceConfig } from '../src/core/personal-ghost';
import { completeRace, createRace, isFinished, raceResult, stepRace } from '../src/core/racing';
import { appendInput, newRecording, Playback } from '../src/core/recording';
import { formatGhostDelta, personalGhostResults } from '../src/ui/personal-ghost-view';

const player = { id: 'p1', name: 'Jugador', color: '#e05a3b', appearance: defaultAppearance('#e05a3b') };
const course = mapCourse(validateMap({ ...emptyDesign(), id: 'flat', length: 640, laps: 2 }));
const config = (bots = 0) => quickRaceConfig(course, player, bots, 'normal');
function drive(c: RaceConfig) {
  const race = createRace(c), replay = newRecording(c);
  while (!isFinished(race, 0)) {
    appendInput(replay, 1);
    stepRace(race, 1);
  }
  replay.result = raceResult(completeRace(race));
  const own = replay.result.finishes.find((f) => f.id === player.id)!;
  const record: PersonalRecord = {
    key: recordKey(c), profileId: player.id, ref: c.ref, config: c,
    ticks: own.ticks!, bestLap: own.laps[0], date: '2026-10-03', replayId: 'best', lapReplayId: 'lap',
  };
  return { replay, record };
}

describe('quick personal record selection', () => {
  it('freezes the configured course and profile for an attempt', () => {
    const input = structuredClone(course), person = structuredClone(player);
    const c = quickRaceConfig(input, person, 2, 'hard');
    input.track.laps = 9;
    person.name = 'Changed';
    expect(c.track.laps).toBe(2);
    expect(c.player.name).toBe('Jugador');
    expect(c.bots).toHaveLength(2);
    expect(c).toMatchObject({ mode: 'quick', difficulty: 'hard', seed: 1984 });
  });
  it('shares records across modes, weather, time and solo difficulty', () => {
    const c = config(), { record } = drive(c);
    expect(personalRecord([record], { ...c, mode: 'versus', weather: 'snow', timeOfDay: 'night', difficulty: 'hard' })).toBe(record);
  });
  it('separates profile, geometry, laps, bots and bot difficulty', () => {
    const c = config(2), { record } = drive(c);
    const others: RaceConfig[] = [
      { ...c, player: { ...player, id: 'other' } },
      { ...c, ref: { ...c.ref, id: 'other-track' } },
      { ...c, ref: { ...c.ref, revision: 'edited' } },
      { ...c, track: { ...c.track, laps: 1 } },
      config(5), { ...c, difficulty: 'hard' },
    ];
    for (const other of others) expect(personalRecord([record], other)).toBeUndefined();
    expect(personalRecord([], c)).toBeUndefined();
  });
});

describe('personal ghost loading and isolation', () => {
  it('validates and freezes the complete personal race, including its original bots', () => {
    const c = config(2), { replay, record } = drive(c);
    const target = preparePersonalGhost(record, c, replay);
    expect(target.replay.config.bots).toHaveLength(2);
    expect(target.reference).toMatchObject({ key: record.key, replayId: 'best', ticks: record.ticks });
    record.ticks = 1;
    replay.result.finishes[0].laps[0] = 1;
    expect(target.reference.ticks).not.toBe(1);
    expect(target.reference.laps[0]).not.toBe(1);
  });
  it('rejects missing, incompatible, mismatched and falsely timed recordings', () => {
    const c = config(), { replay, record } = drive(c);
    expect(() => preparePersonalGhost(record, c, undefined)).toThrow();
    expect(() => preparePersonalGhost(record, c, { ...replay, ruleset: 'old' })).toThrow();
    expect(() => preparePersonalGhost(record, config(2), replay)).toThrow();
    expect(() => preparePersonalGhost({ ...record, ticks: record.ticks - 1 }, c, replay)).toThrow();
    const bad = structuredClone(replay);
    bad.inputs[0][1]++;
    expect(() => preparePersonalGhost(record, c, bad)).toThrow();
  });
  it('accepts the official track revision after recording validation', () => {
    const c = quickRaceConfig({ ...BUILTINS[0], track: { ...BUILTINS[0].track, laps: 1 } }, player, 0, 'normal');
    const { replay, record } = drive(c);
    expect(preparePersonalGhost(record, c, replay).reference.key).toBe(record.key);
  });
  it.each([0, 2, 5])('keeps %i bots, physics and finishes independent of the ghost', (bots) => {
    const c = config(bots), { replay, record } = drive(c);
    const ghost = new Playback(preparePersonalGhost(record, c, replay).replay);
    const plain = createRace(c), withGhost = createRace(c);
    while (!isFinished(plain, 0)) {
      stepRace(plain, 1);
      stepRace(withGhost, 1);
      ghost.step();
    }
    expect(withGhost).toEqual(plain);
    expect(withGhost.riders).toHaveLength(bots + 1);
    expect(ghost.race.riders[0]).toEqual(plain.riders[0]);
  });
});

describe('lap and finish comparisons', () => {
  const reference = { key: 'key', replayId: 'best', ticks: 600, laps: [100, 300, 600] };
  it('compares the same lap and checkpoint independently', () => {
    const laps = [80, 300, 590];
    expect(ghostLapComparison(laps, reference, 0)).toMatchObject({ lap: 1, ownTicks: 80, ghostTicks: 100, lapDeltaTicks: -20, totalDeltaTicks: -20 });
    expect(ghostLapComparison(laps, reference, 1)).toMatchObject({ lap: 2, lapDeltaTicks: 20, totalDeltaTicks: 0 });
    expect(ghostLapComparison(laps, reference, 2)).toMatchObject({ lap: 3, lapDeltaTicks: -10, totalDeltaTicks: -10 });
    expect(ghostLapComparison([], reference, -1)).toBeNull();
    expect(ghostLapComparison([100], reference, 1)).toBeNull();
  });
  it('formats signed tick differences with readable advantage and disadvantage', () => {
    expect(formatGhostDelta(-100)).toBe('−00:01.60 · Ventaja');
    expect(formatGhostDelta(100)).toBe('+00:01.60 · Desventaja');
    expect(formatGhostDelta(0)).toBe('±00:00.00 · Igual');
    expect(formatGhostDelta(1)).toBe('+00:00.01 · Desventaja');
  });
  it('shows the frozen target, completed splits, and no total delta for a DNF', () => {
    const race = createRace(config());
    race.finishes = [{ id: player.id, ticks: null, laps: [80, 300], crashes: 1 }];
    const partial = personalGhostResults(race, reference);
    expect(partial).toContain('Tiempo del fantasma <b>00:09.60');
    expect(partial).toContain('−00:00.32 · Ventaja');
    expect(partial).toContain('+00:00.32 · Desventaja');
    expect(partial).not.toContain('Diferencia total');
    race.finishes[0].ticks = 590;
    race.finishes[0].laps.push(590);
    expect(personalGhostResults(race, reference)).toContain('Diferencia total');
    expect(personalGhostResults(race, reference)).toContain('−00:00.16 · Ventaja');
  });
});
