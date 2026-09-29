import { describe, expect, it } from 'vitest';
import {
  acceptResult,
  advanceSession,
  placements,
  sessionConfig,
  standings,
  turnPlayer,
} from '../src/core/competition';
import { makeBots, recordKey, type CompetitionSession, type RaceConfig } from '../src/core/game';
import {
  BUILTINS,
  designFromTrack,
  emptyDesign,
  generateMap,
  generatorDefaults,
  mapCourse,
  mapTrack,
  placedPiece,
  validateMap,
} from '../src/core/maps';
import {
  abandonPlayer,
  completeRace,
  createRace,
  isFinished,
  raceResult,
  stepRace,
} from '../src/core/racing';
import { appendInput, newRecording, Playback, validateRecording } from '../src/core/recording';
import { heightAt } from '../src/core/tracks';
import { Input } from '../src/core/types';

const config = (bots = 0): RaceConfig => {
  const d = emptyDesign();
  d.id = 'flat';
  d.length = 640;
  d.laps = 1;
  return {
    ...mapCourse(validateMap(d)),
    mode: 'quick',
    player: { id: 'p1', name: 'Jugador 1', color: '#e05a3b' },
    bots: makeBots(bots),
    difficulty: 'normal',
    seed: 1984,
  };
};
const drive = (c: RaceConfig) => {
  const r = createRace(c),
    replay = newRecording(c);
  while (!isFinished(r, 0)) {
    const input = Input.A;
    appendInput(replay, input);
    stepRace(r, input);
  }
  replay.result = raceResult(completeRace(r));
  return { r, replay };
};

describe('real competition', () => {
  it.each([0, 1, 2, 3, 4, 5])('finishes every real racer with %i bots', (bots) => {
    const { r } = drive(config(bots));
    expect(r.finishes).toHaveLength(bots + 1);
    expect(r.finishes.every((f) => f.ticks !== null && f.laps.length === 1)).toBe(true);
    expect(r.phase).toBe('finished');
  });
  it('freezes arrival and lap times while slower bots continue', () => {
    const { r } = drive(config(5));
    const result = structuredClone(r.finishes);
    stepRace(r, Input.B);
    expect(r.finishes).toEqual(result);
  });
  it('does not teleport a bot when the player falls behind', () => {
    const r = createRace(config(1));
    r.countdown = 0;
    r.phase = 'racing';
    r.riders[1].x = 2000;
    stepRace(r, 0);
    expect(r.riders[1].x).toBeGreaterThanOrEqual(2000);
    expect(r.riders[1].x).toBeLessThan(2004);
  });
  it('extends the deadline for long nine-lap tracks and times out idle racers', () => {
    const c = config();
    c.track.length = 30000;
    c.track.laps = 9;
    expect(createRace(c).limitTicks).toBeGreaterThan(33750);
    const r = createRace(config());
    completeRace(r);
    expect(r.finishes[0].ticks).toBeNull();
    expect(r.elapsed).toBe(r.limitTicks);
  });
  it('abandonment is final and does not prevent bots finishing', () => {
    const r = createRace(config(2));
    abandonPlayer(r);
    completeRace(r);
    expect(r.finishes[0]).toMatchObject({ id: 'p1', ticks: null });
    expect(r.finishes.filter((f) => f.ticks !== null)).toHaveLength(2);
  });
  it('orders exact ties without awarding abandoned racers points', () => {
    expect(
      placements([
        { id: 'a', ticks: 100, laps: [], crashes: 0 },
        { id: 'b', ticks: 100, laps: [], crashes: 0 },
        { id: 'c', ticks: 120, laps: [], crashes: 0 },
        { id: 'd', ticks: null, laps: [], crashes: 0 },
      ]).map((f) => f.rank),
    ).toEqual([1, 1, 3, null]);
  });
  it('replays fixed input with identical riders and does not let ghosts change a race', () => {
    const c = config(5),
      { replay } = drive(c);
    const original = new Playback(replay),
      ghosts = Array.from({ length: 5 }, () => new Playback(replay));
    while (!original.done) {
      original.step();
      ghosts.forEach((g) => g.step());
    }
    for (const ghost of ghosts) expect(ghost.race).toEqual(original.race);
    expect((original.race as any).finishes.find((f: any) => f.id === 'p1').ticks).toBe(
      replay.result.finishes.find((f) => f.id === 'p1')!.ticks,
    );
  });
  it('validates complete recordings, rejects extra frames and untrusted geometry', () => {
    const { replay } = drive(config());
    expect(validateRecording(replay).version).toBe(1);
    const bad = structuredClone(replay);
    bad.inputs[0][1]++;
    expect(() => validateRecording(bad)).toThrow();
    const broken = structuredClone(replay);
    broken.config.track.laps = 99;
    expect(() => validateRecording(broken)).toThrow();
  });
  it('uses comparable record keys across modes and visuals, but separates geometry and bots', () => {
    const c = config();
    const key = recordKey(c);
    expect(recordKey({ ...c, mode: 'versus', timeOfDay: 'night', weather: 'snow' })).toBe(key);
    expect(recordKey({ ...c, bots: makeBots(1) })).not.toBe(key);
    expect(recordKey({ ...c, ref: { ...c.ref, revision: 'changed' } })).not.toBe(key);
  });
  it('difficulty improves aggregate bot times over official maps and seeds', () => {
    const totals = { easy: 0, normal: 0, hard: 0 };
    for (const difficulty of ['easy', 'normal', 'hard'] as const)
      for (const c of BUILTINS)
        for (const seed of [1, 12, 83]) {
          const r = createRace({ ...config(1), ...structuredClone(c), difficulty, seed });
          abandonPlayer(r);
          completeRace(r);
          totals[difficulty] += r.finishes.find((f) => f.id === 'bot-1')!.ticks ?? r.limitTicks;
        }
    expect(totals.normal).toBeLessThan(totals.easy);
    expect(totals.hard).toBeLessThan(totals.normal);
  });
});

describe('competition sessions', () => {
  it('imports an abandoned replay and reconstructs all remaining bot arrivals', () => {
    const c = config(2),
      r = createRace(c),
      replay = newRecording(c);
    for (let i = 0; i < 230; i++) {
      appendInput(replay, Input.A);
      stepRace(r, Input.A);
    }
    abandonPlayer(r);
    replay.termination = 'abandoned';
    replay.result = raceResult(completeRace(r));
    const imported = validateRecording(replay);
    expect(imported.version).toBe(1);
    expect(imported.result.finishes).toHaveLength(3);
    expect(imported.result.finishes.find((f) => f.id === 'p1')!.ticks).toBeNull();
    const ghost = new Playback(imported);
    while (!ghost.done) ghost.step();
    expect(ghost.race.finishes.find((f) => f.id === 'p1')!.ticks).toBeNull();
  });
  const session = (): CompetitionSession => ({
    id: 'session',
    mode: 'versus',
    players: [config().player, { id: 'p2', name: 'Segundo', color: '#358aad' }],
    bots: [],
    difficulty: 'normal',
    courses: [
      mapCourse(validateMap({ ...emptyDesign(), id: 'one', length: 640, laps: 1 })),
      mapCourse(validateMap({ ...emptyDesign(), id: 'two', length: 640, laps: 1 })),
    ],
    courseIndex: 0,
    turnIndex: 0,
    results: [],
    phase: 'ready',
    seed: 1984,
  });
  it('runs everyone on each map, rotates first player and commits once', () => {
    let s = session();
    expect(turnPlayer(s).id).toBe('p1');
    const first = drive(sessionConfig(s)).replay.result;
    s = acceptResult(s, first, 'first');
    expect(acceptResult(s, first, 'duplicate').results).toHaveLength(1);
    s = advanceSession(s);
    expect(turnPlayer(s).id).toBe('p2');
    s = acceptResult(s, drive(sessionConfig(s)).replay.result, 'second');
    s = advanceSession(s);
    expect(s.courseIndex).toBe(1);
    expect(turnPlayer(s).id).toBe('p2');
    for (let i = 0; i < 2; i++) {
      s = acceptResult(s, drive(sessionConfig(s)).replay.result, 'next' + i);
      s = advanceSession(s);
    }
    expect(s.phase).toBe('complete');
    expect(standings(s).map((r) => r.points)).toEqual([20, 20]);
    expect(standings(s).map((r) => r.rank)).toEqual([1, 1]);
  });
  it('does not score partial maps and penalizes DNF in time tiebreaks', () => {
    let s = session();
    let result = drive(sessionConfig(s)).replay.result;
    s = advanceSession(acceptResult(s, result, 'a'));
    expect(standings(s).every((r) => r.points === 0)).toBe(true);
    result = drive(sessionConfig(s)).replay.result;
    result.finishes[0].ticks = null;
    s = acceptResult(s, result, 'b');
    const rows = standings(s);
    expect(rows[0].points).toBe(10);
    expect(rows[1].points).toBe(0);
    expect(rows[1].ticks).toBe(result.limitTicks);
  });
  it('freezes selected tracks and participant names in configs', () => {
    const s = session(),
      c = sessionConfig(s);
    s.courses[0].track.name = 'Edited';
    s.players[0].name = 'Changed';
    expect(c.track.name).not.toBe('Edited');
    expect(c.player.name).not.toBe('Changed');
  });
});

describe('map library and generator', () => {
  it('preserves MotoNeta map geometry, identity and appearance', () => {
    const original = validateMap({
      ...emptyDesign(),
      name: 'MotoNeta',
      laps: 3,
      timeOfDay: 'night',
      weather: 'snow',
      items: [placedPiece('C', 400), placedPiece('K', 800)],
    });
    const restored = validateMap(JSON.parse(JSON.stringify(original)));
    expect(restored).toEqual(original);
    expect(mapTrack(restored)).toEqual(mapTrack(original));
  });
  it('supports parallel pieces and rejects overlaps on the same lane', () => {
    const d = emptyDesign();
    d.items = [placedPiece('C', 400, 1), placedPiece('A', 400, 2)];
    const valid = validateMap(d),
      t = mapTrack(valid);
    expect(heightAt(t, 436, 0)).toBeGreaterThan(heightAt(t, 412, 1));
    d.items[1].lanes = 1;
    expect(() => validateMap(d)).toThrow(/superpuestas/);
    d.items = [{ ...d.items[0], piece: 'flat', surface: 'mud' }];
    expect(() => validateMap(d)).toThrow(/pieza/);
  });
  it('renaming and ambiance preserve revision; geometry changes it', () => {
    const d = validateMap({ ...emptyDesign(), items: [placedPiece('A', 400)] });
    expect(validateMap({ ...d, name: 'Otro', weather: 'rain' }).revision).toBe(d.revision);
    const next = structuredClone(d);
    next.items[0].x += 8;
    expect(validateMap(next).revision).not.toBe(d.revision);
  });
  it('can copy all five full official tracks into the editor', () => {
    for (const c of BUILTINS) {
      expect(c.track.id).toContain('main');
      const d = validateMap(designFromTrack(c.track));
      for (let x = 0; x < c.track.length; x += 13)
        for (let lane = 0; lane < 4; lane++)
          expect(heightAt(mapTrack(d), x, lane)).toBe(heightAt(c.track, x, lane));
    }
  });
  it.each(['easy', 'normal', 'hard'] as const)(
    'generates reproducible valid maps at %s difficulty',
    (difficulty) => {
      for (const size of ['short', 'medium', 'long'] as const) {
        const options = { ...generatorDefaults, difficulty, size, seed: 'test' };
        const a = generateMap(options),
          b = generateMap(Object.fromEntries(Object.entries(options).reverse()) as typeof options);
        expect(a).toEqual(b);
        expect(a.items[0].x).toBeGreaterThanOrEqual(320);
        expect(Math.max(...a.items.map((p) => p.x + p.length))).toBeLessThanOrEqual(a.length - 320);
        expect(validateMap(a)).toEqual(a);
      }
    },
  );
  it('honors zero frequencies and rejects invalid controls', () => {
    expect(generateMap({ ...generatorDefaults, ramps: 0, mud: 0, cool: 0 }).items).toEqual([]);
    expect(() => generateMap({ ...generatorDefaults, mud: -1 })).toThrow();
  });
});
