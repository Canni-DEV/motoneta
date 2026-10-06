import { describe, expect, it } from 'vitest';
import { emptyDesign, mapTrack, placedPiece, validateMap } from '../src/core/maps';
import { clockTime, stepRace } from '../src/core/racing';
import { appendInput, newRecording, validateRecording } from '../src/core/recording';
import { crash, fingerprint, formatTime } from '../src/core/simulation';
import { getTrack, heightAt, makeSegment, PIECES } from '../src/core/tracks';
import { HZ, Input, type Race, type Track } from '../src/core/types';
import { simulateInputs, testRace } from './race-fixture';
const flat: Track = {
  id: 'test',
  name: 'test',
  subtitle: '',
  number: 0,
  length: 20000,
  segments: [],
  laps: 1,
  color: '#fff',
};
const run = (r: Race, n: number, input = 0) => {
  for (let i = 0; i < n; i++) stepRace(r, input);
  return r;
};
const live = (track = flat, bots = 0) => {
  const r = testRace(track, bots);
  run(r, 180);
  return r;
};
describe('race rules', () => {
  it('waits for the countdown without moving the rider or starting the clock', () => {
    const r = testRace(flat, 0);
    run(r, 179, Input.B);
    expect(r.elapsed).toBe(0);
    expect(r.riders[0].x).toBe(80);
    expect(r.phase).toBe('countdown');
    stepRace(r, 0);
    expect(r.phase).toBe('racing');
    expect(r.events[0].type).toBe('start');
  });
  it('turbo accelerates faster, then overheats and recovers without input', () => {
    const a = live(),
      b = live();
    run(a, 45, Input.A);
    run(b, 45, Input.B);
    expect(b.riders[0].speed).toBeGreaterThan(a.riders[0].speed);
    run(b, 680, Input.B);
    expect(b.riders[0].overheated).toBe(true);
    run(b, 180);
    expect(b.riders[0].overheated).toBe(false);
    expect(b.riders[0].heat).toBeLessThan(21);
  });
  it('lane inputs stay within the four-lane boundary', () => {
    const r = live();
    run(r, 500, Input.UP);
    expect(r.riders[0].lane).toBe(0);
    run(r, 500, Input.DOWN);
    expect(r.riders[0].lane).toBe(3);
  });
  it('tapping A shortens recovery; holding it does not count as repeated taps', () => {
    const r = live(),
      held = live();
    crash(r, r.riders[0]);
    crash(held, held.riders[0]);
    for (let i = 0; i < 62; i++) {
      stepRace(r, i % 2 ? 0 : Input.A);
      stepRace(held, Input.A);
    }
    expect(r.riders[0].recovery).toBeLessThan(held.riders[0].recovery);
    expect(r.riders[0].crashes).toBe(1);
  });
  it('rolls forward through a ramp before the rider can remount', () => {
    const ramp = makeSegment('C', 100);
    const r = live({ ...flat, segments: [ramp] }), p = r.riders[0];
    p.x = 118;
    p.height = heightAt(r.track, p.x, p.lane);
    p.speed = 3;
    crash(r, p, 'backflip');
    expect(p.crashPhase).toBe('rolling');
    expect(p.crashRollDuration).toBeGreaterThanOrEqual(40);
    expect(p.crashRollDuration).toBeLessThanOrEqual(84);
    const startX = p.x;
    while (p.crashPhase === 'rolling') stepRace(r, 0);
    expect(p.x).toBeGreaterThan(startX);
    expect(p.x).toBeGreaterThanOrEqual(ramp.x + ramp.length + 11);
    expect(p.crashPhase).toBe('down');
    expect(p.speed).toBe(0);
    expect(p.recovery).toBe(90);
  });
  it('keeps a minimum fall and remount animation despite rapid A taps', () => {
    const r = live(), p = r.riders[0];
    p.speed = 3;
    crash(r, p);
    let ticks = 0;
    while (p.recovery) {
      stepRace(r, ticks % 2 ? 0 : Input.A);
      ticks++;
      if (ticks > 200) throw new Error('Recovery did not finish');
    }
    expect(ticks).toBeGreaterThanOrEqual(78);
    expect(ticks).toBeLessThan(100);
    expect(p.crashPhase).toBe('none');
    expect(p.invincible).toBe(90);
  });
  it('lets AI riders pulse A only after their roll, then remount', () => {
    const r = live(flat, 1), p = r.riders[1];
    p.speed = 3;
    crash(r, p);
    let ticks = 0;
    while (p.recovery) {
      stepRace(r, 0);
      ticks++;
      if (ticks > 200) throw new Error('AI recovery did not finish');
    }
    expect(ticks).toBeGreaterThanOrEqual(78);
    expect(ticks).toBeLessThan(130);
    expect(p.crashPhase).toBe('none');
  });
  it('counts the finish only when a fallen rider has remounted', () => {
    const r = live({ ...flat, length: 100 }), p = r.riders[0];
    p.x = 178;
    p.speed = 3;
    crash(r, p);
    for (let i = 0; i < 40; i++) stepRace(r, 0);
    expect(p.x).toBeGreaterThan(180);
    expect(r.finishes).toHaveLength(0);
    expect(r.riderLaps[0]).toHaveLength(0);
    while (p.recovery) stepRace(r, 0);
    expect(r.finishes[0].ticks).toBe(r.elapsed);
    expect(r.riderLaps[0]).toHaveLength(1);
  });
  it('cool strips reset temperature when crossed', () => {
    const track = { ...flat, segments: [makeSegment('M', 90)] };
    const r = live(track),
      p = r.riders[0];
    p.lane = 0;
    p.speed = 3;
    p.heat = 80;
    run(r, 4, Input.A);
    expect(p.heat).toBe(0);
  });
  it('mud slows a grounded bike on its affected lanes', () => {
    const r = live({ ...flat, segments: [makeSegment('K', 80)] }),
      p = r.riders[0];
    p.speed = 3.25;
    run(r, 4, Input.A);
    expect(p.speed).toBeLessThan(3);
  });
  it('an impact with a rival from behind crashes the trailing rider', () => {
    const r = live(flat, 3);
    r.riders[1].x = 90;
    r.riders[1].lane = 2;
    r.riders[0].speed = 3;
    stepRace(r, Input.A);
    expect(r.riders[0].recovery).toBeGreaterThan(0);
    expect(r.riders[1].recovery).toBe(0);
  });
  it('launches automatically from a ramp', () => {
    const r = live({ ...flat, segments: [makeSegment('C', 100)] });
    r.riders[0].speed = 3.25;
    let jumped = false;
    for (let i = 0; i < 40; i++) {
      stepRace(r, Input.A);
      if (r.events.some((e) => e.type === 'jump')) jumped = true;
    }
    expect(jumped).toBe(true);
    expect(r.riders[0].height).toBeGreaterThan(0);
  });
  it('a bad landing triggers a fall', () => {
    const r = live(),
      p = r.riders[0];
    p.height = 0.1;
    p.grounded = false;
    p.vy = -1;
    p.tilt = 1.5;
    p.speed = 3;
    stepRace(r, Input.A);
    expect(p.crashes).toBe(1);
  });
  it('completes exactly the requested laps and freezes the final result', () => {
    const r = live({ ...flat, length: 400, laps: 2 });
    run(r, 500, Input.A);
    expect(r.phase).toBe('finished');
    expect(r.laps).toHaveLength(2);
    const f = fingerprint(r);
    run(r, 1000, Input.B);
    expect(fingerprint(r)).toBe(f);
  });
  it('replays input at a fixed simulation rate with identical AI state', () => {
    const r = testRace(getTrack(2), 3),
      recording = newRecording(r.config);
    for (let i = 0; i < 4000; i++) {
      const input =
        (i % 650 < 350 ? Input.B : Input.A) |
        (i % 400 < 70 ? Input.UP : 0) |
        (i % 400 > 250 ? Input.DOWN : 0);
      appendInput(recording, input);
      stepRace(r, input);
    }
    expect(fingerprint(simulateInputs(recording))).toBe(fingerprint(r));
  });
  it('formats time with minutes and hundredths', () => {
    expect(formatTime(70.239)).toBe('01:10.23');
    expect(formatTime(0)).toBe('00:00.00');
  });
  it('uses the original clock accumulator rather than wall-clock seconds', () => {
    const r = live();
    run(r, 60);
    expect(clockTime(r)).toBe(0.96);
    run(r, 3);
    expect(clockTime(r)).toBeCloseTo(1.008);
  });
  it('ends an idle run at the original nine-minute timeout', () => {
    const r = live({ ...flat, length: 640 });
    run(r, 33750);
    expect(r.timeUp).toBe(true);
    expect(r.phase).toBe('finished');
    expect(r.rank).toBe(1);
  });
  it('validates a replay before reproducing it and rejects invalid counts or geometry', () => {
    const r = testRace(getTrack(0), 0),
      replay = newRecording(r.config);
    while (r.phase !== 'finished') {
      appendInput(replay, Input.A);
      stepRace(r, Input.A);
    }
    expect(validateRecording(replay).inputs).toEqual(replay.inputs);
    const bad = structuredClone(replay);
    bad.inputs[0][1] = Infinity;
    expect(() => validateRecording(bad)).toThrow();
    bad.inputs[0][1] = 1;
    bad.config.track.segments[1].x = -20;
    expect(() => validateRecording(bad)).toThrow();
    const truncated = structuredClone(replay);
    truncated.inputs[0][1] = 10;
    expect(() => validateRecording(truncated)).toThrow(/incompatible|dañada/);
  });
});
describe('circuits', () => {
  it('has five ordered, gap-free original table layouts and all 22 editor pieces', () => {
    expect(Array.from({ length: 5 }, (_, n) => getTrack(n))).toHaveLength(5);
    expect(PIECES).toHaveLength(22);
    for (let n = 0; n < 5; n++) {
      {
        const t = getTrack(n);
        expect(t.length).toBeGreaterThan(3000);
        for (let i = 1; i < t.segments.length; i++)
          expect(t.segments[i].x).toBe(t.segments[i - 1].x + t.segments[i - 1].length);
        expect(t.segments.at(-1)!.x + t.segments.at(-1)!.length).toBe(t.length);
      }
    }
  });
  it('wraps terrain at circuit boundaries', () => {
    const t = getTrack(0);
    expect(heightAt(t, t.length + 250, 2)).toBe(heightAt(t, 250, 2));
  });
  it('preserves map geometry and laps across serialization', () => {
    const d = validateMap({
      ...emptyDesign(),
      name: 'Trial',
      laps: 9,
      items: [placedPiece('R', 400), placedPiece('N', 800)],
    });
    expect(mapTrack(d)).toEqual(mapTrack(validateMap(JSON.parse(JSON.stringify(d)))));
    expect(mapTrack(d).laps).toBe(9);
  });
  it.each([
    { game: 'another-game' },
    { version: 1 },
    { laps: 0 },
    { length: Infinity },
    { items: Array(2501).fill(placedPiece('A', 400)) },
  ])('rejects incompatible or malformed maps', (change) => {
    expect(() => validateMap({ ...emptyDesign(), ...change })).toThrow();
  });
  it.each([0, 1, 2, 3, 4])(
    'allows a controlled run to finish circuit %i without nonfinite state',
    (n) => {
      const r = live(getTrack(n), 3);
      for (let i = 0; i < 12000 && r.phase !== 'finished'; i++) {
        const p = r.riders[0];
        let input: number = p.heat < 60 ? Input.B : Input.A;
        if (p.recovery) input = i % 2 ? Input.A : 0;
        if (!p.grounded && p.tilt > 0.15) input |= Input.RIGHT;
        stepRace(r, input);
      }
      expect(r.phase).toBe('finished');
      expect(Number.isFinite(r.riders[0].x)).toBe(true);
      console.log(`Track ${n + 1}: ${(r.elapsed / HZ).toFixed(2)}s, ${r.riders[0].crashes} falls`);
    },
  );
});
