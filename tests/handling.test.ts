import { describe, expect, it } from 'vitest';
import { BALANCE, DRIVE } from '../src/core/handling';
import { stepRace } from '../src/core/racing';
import { appendInput, newRecording } from '../src/core/recording';
import { fingerprint } from '../src/core/simulation';
import { Input, type Race, type Track } from '../src/core/types';
import { simulateInputs, testRace } from './race-fixture';
const track: Track = {
  id: 'handling',
  name: 'Handling',
  number: 0,
  subtitle: '',
  color: '#ffffff',
  length: 20000,
  laps: 1,
  segments: [],
};
const live = () => {
  const r = testRace(track, 0);
  for (let i = 0; i < 180; i++) stepRace(r, 0);
  return r;
};
const run = (r: Race, n: number, input: number) => {
  for (let i = 0; i < n; i++) stepRace(r, input);
};
describe('ground balance', () => {
  it('lifts progressively beyond the former fixed angle and falls backward if held', () => {
    const r = live(),
      p = r.riders[0];
    p.speed = 2.5;
    run(r, 20, Input.A | Input.LEFT);
    const first = p.wheelie;
    expect(first).toBeGreaterThan(0.1);
    expect(p.crashes).toBe(0);
    run(r, 15, Input.A | Input.LEFT);
    expect(p.wheelie).toBeGreaterThan(first + 0.2);
    expect(p.tilt).toBeGreaterThan(0.44);
    run(r, 35, Input.A | Input.LEFT);
    expect(p.crashes).toBe(1);
    expect(p.crashKind).toBe('backflip');
    expect(p.recovery).toBeGreaterThan(0);
    expect(p.tilt).toBeGreaterThan(BALANCE.fallAngle);
    const angle = p.tilt;
    stepRace(r, 0);
    expect(p.tilt).toBeGreaterThanOrEqual(angle);
    expect(p.tilt - angle).toBeLessThan(0.12);
  });
  it('countersteering catches the bike before it tips and restores two-wheel contact', () => {
    const r = live(),
      p = r.riders[0];
    p.speed = 2.5;
    run(r, 35, Input.A | Input.LEFT);
    expect(p.wheelie).toBeGreaterThan(0.5);
    run(r, 50, Input.A | Input.RIGHT);
    expect(p.crashes).toBe(0);
    expect(p.wheelie).toBe(0);
    expect(p.tilt).toBeCloseTo(0, 2);
  });
  it('releasing a small wheelie lets gravity lower the front wheel', () => {
    const r = live(),
      p = r.riders[0];
    p.speed = 2.5;
    run(r, 15, Input.A | Input.LEFT);
    run(r, 110, Input.A);
    expect(p.crashes).toBe(0);
    expect(p.wheelie).toBe(0);
  });
  it('does not wheelie at rest or when opposite tilt inputs cancel out', () => {
    const r = live();
    run(r, 180, Input.LEFT);
    expect(r.riders[0].tilt).toBe(0);
    expect(r.riders[0].crashes).toBe(0);
    run(r, 180, Input.A | Input.LEFT | Input.RIGHT);
    expect(r.riders[0].wheelie).toBe(0);
  });
  it('clears accumulated lean and angular motion after recovery', () => {
    const r = live(),
      p = r.riders[0];
    p.speed = 2.5;
    run(r, 70, Input.A | Input.LEFT);
    run(r, 120, 0);
    expect(p.recovery).toBe(0);
    expect(p.wheelie).toBe(0);
    expect(p.wheelieVelocity).toBe(0);
    expect(p.tilt).toBe(0);
  });
  it('reproduces a backward fall and recovery deterministically', () => {
    const r = testRace(track, 0),
      replay = newRecording(r.config);
    for (let i = 0; i < 600; i++) {
      const input = i < 310 ? Input.B | Input.LEFT : i % 2 ? Input.A : 0;
      appendInput(replay, input);
      stepRace(r, input);
    }
    expect(r.riders[0].crashes).toBeGreaterThan(0);
    expect(fingerprint(simulateInputs(replay))).toBe(fingerprint(r));
  });
});
describe('throttle response', () => {
  it('gives B a measurable dash start with the decoded acceleration ratio', () => {
    const a = live(),
      b = live();
    run(a, 40, Input.A);
    run(b, 40, Input.B);
    expect(b.riders[0].speed / a.riders[0].speed).toBeCloseTo(2.625, 5);
    expect(b.riders[0].x - 80).toBeGreaterThan((a.riders[0].x - 80) * 2.5);
    run(b, 16, Input.B);
    expect(b.riders[0].speed).toBe(DRIVE.turboSpeed);
    expect(b.riders[0].turbo).toBe(true);
  });
  it('still accelerates when turbo is added while A is already held at its ceiling', () => {
    const r = live(),
      p = r.riders[0];
    run(r, 150, Input.A);
    expect(p.speed).toBe(DRIVE.normalSpeed);
    run(r, 4, Input.A | Input.B);
    expect(p.speed).toBe(DRIVE.turboSpeed);
    expect(p.turbo).toBe(true);
    run(r, 12, Input.A);
    expect(p.speed).toBe(DRIVE.normalSpeed);
    expect(p.turbo).toBe(false);
  });
  it('stops applying turbo while the engine is overheated', () => {
    const r = live(),
      p = r.riders[0];
    run(r, 730, Input.B);
    expect(p.overheated).toBe(true);
    expect(p.turbo).toBe(false);
    const speed = p.speed;
    stepRace(r, Input.B);
    expect(p.speed).toBeLessThanOrEqual(speed);
  });
});
