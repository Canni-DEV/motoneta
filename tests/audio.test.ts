import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import manifest from '../assets/audio/manifest.json';
import { landingLevel, materialFor, relativeSound } from '../src/audio/catalog';
import { AudioEvents } from '../src/audio/events';
import { EngineAudio } from '../src/audio/engines';
import type { AudioMixer, Voice } from '../src/audio/mixer';
import { stepRace } from '../src/core/racing';
import { fingerprint } from '../src/core/simulation';
import { getTrack } from '../src/core/tracks';
import { Input, defaultSettings, type Track } from '../src/core/types';
import { settings } from '../src/storage';
import { testRace } from './race-fixture';
const flat: Track = { ...getTrack(0), length: 20000, segments: [] };
afterEach(() => vi.unstubAllGlobals());

describe('audio events independent of simulation', () => {
  it('captures vertical impact before landing resets velocity', () => {
    const r = testRace(flat, 0);
    r.countdown = 0;
    r.phase = 'racing';
    Object.assign(r.riders[0], { height: 0.1, vy: -4, grounded: false, tilt: 0, speed: 2 });
    stepRace(r, Input.A);
    expect(r.riders[0].vy).toBe(0);
    expect(r.events.find((e) => e.type === 'land')).toMatchObject({
      impactSpeed: 4.105,
      surface: 'dirt',
    });
    const bad = testRace(flat, 0);
    bad.countdown = 0;
    bad.phase = 'racing';
    Object.assign(bad.riders[0], { height: 0.1, vy: -4, grounded: false, tilt: 1.6, speed: 2 });
    stepRace(bad, Input.A);
    expect(bad.events.find((e) => e.type === 'crash')).toMatchObject({
      impactSpeed: 4.105,
      cause: 'impact',
    });
  });
  it('scales landing strength, keeps a crash separate, and never repeats a frame', () => {
    const r = testRace(flat, 0),
      events = new AudioEvents();
    r.countdown = 0;
    for (const [frame, speed, level] of [
      [1, 0.8, 0],
      [2, 2.2, 1],
      [3, 4.2, 2],
    ]) {
      r.frame = frame;
      r.events = [{ type: 'land', rider: 0, frame, impactSpeed: speed, surface: 'dirt' }];
      expect(events.consume(r, 'rain').map((e) => e.id)).toEqual([
        expect.stringMatching(`^land-${level}-`),
        'touch-wet',
      ]);
      expect(events.consume(r, 'rain')).toEqual([]);
    }
    r.frame++;
    r.events = [{ type: 'crash', rider: 0, frame: r.frame, cause: 'backflip' }];
    expect(events.consume(r, 'clear').map((e) => e.id)).toEqual([
      expect.stringMatching('^crash-'),
      expect.stringMatching('^scrape-'),
    ]);
  });
  it('suppresses lap at finish, recognizes DNF and does not add a last-lap cue to a single lap race', () => {
    const r = testRace(flat, 0);
    r.countdown = 0;
    r.frame = 5;
    r.events = [
      { type: 'lap', rider: 0, frame: 5 },
      { type: 'finish', rider: 0, frame: 5 },
    ];
    expect(new AudioEvents().consume(r, 'clear').map((e) => e.id)).toEqual(['finish', 'cheer-2']);
    r.timeUp = true;
    expect(new AudioEvents().consume(r, 'clear').map((e) => e.id)).toEqual(['dnf']);
    r.events = [{ type: 'lap', rider: 0, frame: 5 }];
    r.track = { ...flat, laps: 1 };
    r.previousLap = 1;
    expect(new AudioEvents().consume(r, 'clear').map((e) => e.id)).toContain('lap');
    r.track.laps = 3;
    r.previousLap = 2;
    expect(new AudioEvents().consume(r, 'clear').map((e) => e.id)).toContain('last-lap');
  });
  it('distinguishes cooling pad from engine recovery', () => {
    const r = testRace(flat, 0);
    r.countdown = 0;
    r.events = [{ type: 'cool', rider: 0, frame: 0, cause: 'surface' }];
    expect(new AudioEvents().consume(r, 'clear')[0].id).toBe('cool');
    r.events[0].cause = 'recovered';
    expect(new AudioEvents().consume(r, 'clear')[0].id).toBe('recovered');
  });
  it('does not modify physics, RNG or serialized race states across 4000 steps', () => {
    const a = testRace(getTrack(0), 3),
      b = structuredClone(a),
      events = new AudioEvents();
    for (let i = 0; i < 4000; i++) {
      const input = i % 350 < 240 ? Input.B : Input.A;
      stepRace(a, input);
      stepRace(b, input);
      events.consume(a, 'snow');
      expect(fingerprint(a)).toBe(fingerprint(b));
    }
  });
  it('uses circular distance and independent variants of physical surface/weather', () => {
    expect(relativeSound(10, 990, 1000)).toEqual(relativeSound(1010, 990, 1000));
    expect(relativeSound(700, 200, 2000).gain).toBe(0);
    expect(materialFor('mud', 'rain')).toBe('mud');
    expect(materialFor('grass', 'snow')).toBe('snow');
    expect([0, 2, 4].map(landingLevel)).toEqual([0, 1, 2]);
  });
});
describe('audio settings', () => {
  const stored = (value: unknown) =>
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify(value) });
  it('preserves master and UI levels without sharing defaults', () => {
    stored({ volume: 0.31, audioLevels: { ui: 0 } });
    const s = settings();
    expect(s.volume).toBe(0.31);
    expect(s.audioLevels.ui).toBe(0);
    expect(s.audioLevels.engines).toBe(1);
    s.audioLevels.engines = 0;
    expect(defaultSettings.audioLevels.engines).toBe(1);
  });
  it('loads valid new values independently and clamps invalid persisted levels', () => {
    stored({ audioLevels: { ui: 0.6, music: -2, engines: 8, effects: 'bad' } });
    expect(settings().audioLevels).toEqual({
      ui: 0.6,
      music: 0,
      engines: 1,
      effects: 1,
      ambience: 1,
    });
  });
});
describe('distributed sound bank', () => {
  it('contains reproducible, bounded PCM and continuous loop boundaries', () => {
    for (const a of manifest.assets) {
      const data = readFileSync(`public/audio/${a.file}`);
      expect(createHash('sha256').update(data).digest('hex')).toBe(a.sha256);
      expect(data.toString('ascii', 0, 4)).toBe('RIFF');
      const channels = data.readUInt16LE(22);
      let peak = 0;
      for (let i = 44; i < data.length; i += 2)
        peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
      expect(peak).toBeLessThan(24000);
      if (a.loop)
        for (let c = 0; c < channels; c++)
          expect(
            Math.abs(
              data.readInt16LE(44 + c * 2) - data.readInt16LE(data.length - channels * 2 + c * 2),
            ) / 32768,
          ).toBeLessThan(0.001);
    }
  });
});

describe('one continuous engine across RPM layers', () => {
  const ids = ['engine-idle', 'engine-mid', 'engine-high'];
  function fixture() {
    let clock = 10;
    const buffers = new Map(
      ids.map((id) => {
        const data = readFileSync(`public/audio/${id}.wav`);
        return [id, { duration: (data.length - 44) / 2 / data.readUInt32LE(24) }];
      }),
    );
    const voices: Voice[] = [];
    const parameter = (value = 0) => ({
      value,
      setTargetAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
    });
    const create = vi.fn((id, _loop, _gain, pan, _priority, _delay, startAt) => {
      const buffer = buffers.get(id);
      if (!buffer) return null;
      const voice = {
        source: { buffer, playbackRate: parameter(1) },
        gain: { gain: parameter() },
        pan: { pan: parameter(pan) },
        stop: vi.fn(),
      } as unknown as Voice;
      voices.push(voice);
      // Model the audio clock moving while nodes are allocated. Every layer
      // must still receive exactly the same future start time.
      clock += 0.003;
      expect(startAt).toBeGreaterThan(clock);
      return voice;
    });
    const mixer = {
      ctx: {
        get currentTime() {
          return clock;
        },
      },
      bank: { buffers },
      create,
    } as unknown as AudioMixer;
    return { engine: new EngineAudio(mixer), create, voices, buffers };
  }
  it('starts together, preserves loop phase while revving, and keeps broad overlap', () => {
    const { engine, create, voices } = fixture();
    const race = testRace(flat, 0);
    race.riders[0].speed = 0;
    engine.update(race, 'clear');
    expect(voices).toHaveLength(3);
    expect(new Set(create.mock.calls.map((call) => call[6])).size).toBe(1);
    const initialPeriods = voices.map(
      (v) => v.source.buffer!.duration / v.source.playbackRate.value,
    );
    initialPeriods.forEach((period) => expect(period).toBeCloseTo(initialPeriods[0], 12));
    for (const rpm of [0.25, 0.5, 0.75, 1, 0]) {
      race.riders[0].speed = (rpm * 3.25) / 0.8;
      engine.update(race, 'clear');
      const rates = voices.map(
        (v) => vi.mocked(v.source.playbackRate.setTargetAtTime).mock.lastCall!,
      );
      const periods = rates.map(([rate], i) => voices[i].source.buffer!.duration / rate);
      periods.forEach((period) => expect(period).toBeCloseTo(periods[0], 12));
      rates.forEach(([, time, smoothing]) => {
        expect(time).toBe(rates[0][1]);
        expect(smoothing).toBe(rates[0][2]);
      });
      const gains = voices.map((v) => vi.mocked(v.gain.gain.setTargetAtTime).mock.lastCall![0]);
      expect(gains.reduce((a, b) => a + b, 0)).toBeCloseTo(0.12, 12);
      if (rpm === 0.5) gains.forEach((gain) => expect(gain).toBeGreaterThan(0.02));
      voices.forEach((v) => expect(vi.mocked(v.pan.pan.setTargetAtTime).mock.lastCall![0]).toBe(0));
    }
    expect(voices).toHaveLength(3);
    engine.stop();
    voices.forEach((v) => expect(v.stop).toHaveBeenCalledOnce());
  });
  it('uses the same synchronized pitch curve in the audition', () => {
    const { engine, create, voices } = fixture();
    engine.preview();
    expect(voices).toHaveLength(3);
    expect(new Set(create.mock.calls.map((call) => call[6])).size).toBe(1);
    const curves = voices.map(
      (v) => vi.mocked(v.source.playbackRate.linearRampToValueAtTime).mock.calls,
    );
    expect(curves[0]).toHaveLength(101);
    for (let step = 0; step < curves[0].length; step++) {
      const period = voices[0].source.buffer!.duration / curves[0][step][0];
      curves.forEach((curve, i) => {
        expect(voices[i].source.buffer!.duration / curve[step][0]).toBeCloseTo(period, 12);
        expect(curve[step][1]).toBe(curves[0][step][1]);
      });
    }
  });
  it('never starts a partial motor if a layer is missing', () => {
    const { engine, create, buffers } = fixture();
    buffers.delete('engine-high');
    engine.preview();
    engine.update(testRace(flat, 0), 'clear');
    expect(create).not.toHaveBeenCalled();
  });
});
