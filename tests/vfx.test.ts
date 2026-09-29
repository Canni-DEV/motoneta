import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { stepRace } from '../src/core/racing';
import { fingerprint } from '../src/core/simulation';
import { heightAt } from '../src/core/tracks';
import { defaultSettings, HZ, Input, type Settings, type Weather } from '../src/core/types';
import { stadiumLayout, StadiumMotion } from '../src/stadium-layout';
import { settings as readSettings } from '../src/storage';
import { VFX_LIMITS, windAt, windTravel } from '../src/vfx/config';
import { captureVfxFrame, effectAnchors } from '../src/vfx/frame';
import { VfxModel, visualRandom } from '../src/vfx/model';
import { particleAtlas } from '../src/vfx/render';
import { VfxSystem } from '../src/vfx/system';
import { testRace, testTrack } from './race-fixture';

const flat = () => testTrack({ name: 'Effects', laps: 9 });
const settings = () => structuredClone(defaultSettings);
function fixture(s: Settings = settings()) {
  const race = testRace(flat(), 0);
  race.phase = 'racing';
  race.countdown = 0;
  const model = new VfxModel(race.track, s);
  model.reset(race.track, 17);
  const tick = (weather: Weather = 'clear') => {
    race.frame++;
    model.step(captureVfxFrame(race, weather));
  };
  return { race, model, tick, s };
}
afterEach(() => vi.unstubAllGlobals());

describe('effect preferences and resources', () => {
  it('loads effect groups and preserves unrelated settings', () => {
    vi.stubGlobal('localStorage', {
      getItem: () =>
        JSON.stringify({
          vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
          quality: 'low',
          cameraShake: true,
          bloom: false,
        }),
    });
    expect(readSettings()).toMatchObject({
      quality: 'low',
      cameraShake: true,
      bloom: false,
      vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
    });
    vi.stubGlobal('localStorage', {
      getItem: () =>
        JSON.stringify({
          vfx: { race: false, tracks: true, ambient: 'invalid', intensity: 'invalid' },
        }),
    });
    expect(readSettings().vfx).toEqual({
      race: false,
      tracks: true,
      ambient: true,
      intensity: 'balanced',
    });
    expect(defaultSettings.vfx.race).toBe(true);
  });
  it('generates a reproducible atlas and a wind integral matching its velocity', () => {
    const a = particleAtlas(),
      b = particleAtlas();
    expect(a.image.data).toEqual(b.image.data);
    expect(a.image.width).toBe(192);
    a.dispose();
    b.dispose();
    for (const t of [0, 1, 20]) {
      const a = windTravel(t, 91),
        b = windTravel(t + 0.00001, 91),
        v = windAt(t, 91);
      expect((b.x - a.x) / 0.00001).toBeCloseTo(v.x, 4);
      expect((b.z - a.z) / 0.00001).toBeCloseTo(v.z, 4);
    }
  });
});

describe('simulation isolation and reproducibility', () => {
  it('copies event context immediately and never changes physics, AI or seed', () => {
    const a = testRace(flat(), 3),
      b = structuredClone(a),
      model = new VfxModel(a.track, settings());
    for (let n = 0; n < 1200; n++) {
      const input = n % 200 < 100 ? Input.B : Input.A;
      stepRace(a, input);
      stepRace(b, input);
      const before = structuredClone(a);
      model.step(captureVfxFrame(a, n % 2 ? 'rain' : 'snow'));
      expect(a).toEqual(before);
    }
    expect(fingerprint(a)).toEqual(fingerprint(b));
    expect(a).toEqual(b);
    a.events = [{ type: 'land', rider: 0, frame: a.frame, impactSpeed: 4 }];
    const captured = captureVfxFrame(a, 'clear');
    a.events[0].impactSpeed = 0;
    a.riders[0].x = 999;
    expect(captured.events[0].impactSpeed).toBe(4);
    expect(captured.riders[0].x).not.toBe(999);
  });
  it('retains every event at 30/60/120 render FPS and ignores duplicate steps', () => {
    const results = [];
    for (const fps of [30, 60, 120]) {
      const { race, s } = fixture();
      const vfx = new VfxSystem(new THREE.Scene(), race.track, s);
      vfx.reset(race.track, 17);
      const { model } = vfx;
      race.riders[0].speed = 3;
      race.riders[0].previousA = true;
      let accumulator = 0;
      while (race.frame < 300) {
        accumulator += 1 / fps;
        while (accumulator >= 1 / HZ && race.frame < 300) {
          const n = race.frame++;
          race.events =
            n % 13 === 0 ? [{ type: 'land', rider: 0, frame: race.frame, impactSpeed: 3.8 }] : [];
          race.riders[0].x += 3;
          vfx.step(race, 'clear');
          vfx.step(race, 'clear');
          accumulator -= 1 / HZ;
        }
        // Actual presentation clock: 30 FPS consumes multiple steps, 120 FPS draws between them.
        vfx.advance(1 / fps, race, 'race', false, accumulator * HZ, race.riders[0].x, 'clear');
      }
      expect(model.eventsConsumed).toBe(24);
      results.push({
        origins: [...model.origins],
        styles: [...model.styles],
        counts: model.counts,
      });
      vfx.dispose();
    }
    expect(results[0]).toEqual(results[1]);
    expect(results[1]).toEqual(results[2]);
    expect(visualRandom(1, 20, 0, 1, 4)).not.toEqual(visualRandom(2, 20, 0, 1, 4));
  });
});

describe('contact, materials and signals', () => {
  it('anchors flat/ramp wheels and leaves a raised front wheel clean', () => {
    const { race } = fixture(),
      p = race.riders[0];
    expect(effectAnchors(p, race.track)).toMatchObject({ rearContact: true, frontContact: true });
    p.tilt = 0.75;
    expect(effectAnchors(p, race.track)).toMatchObject({ rearContact: true, frontContact: false });
    const ramp = flat();
    ramp.segments = [
      {
        x: 0,
        length: 200,
        lanes: 15,
        profile: [
          [0, 0],
          [1, 100],
        ],
        surface: 'dirt',
        boost: false,
        piece: 'test',
      },
    ];
    p.x = 100;
    p.height = heightAt(ramp, p.x, p.lane);
    p.tilt = Math.atan(0.5);
    const anchors = effectAnchors(p, ramp);
    expect(anchors.rearContact).toBe(true);
    expect(anchors.frontContact).toBe(true);
    for (const v of [anchors.rear, anchors.front])
      expect(v.y).toBeCloseTo(heightAt(ramp, v.x / 0.052, p.lane) * 0.052, 5);
    p.grounded = false;
    p.height += 20;
    expect(effectAnchors(p, ramp)).toMatchObject({ rearContact: false, frontContact: false });
  });
  it.each(['clear', 'rain', 'snow'] as const)(
    'emits the correct terrain material for %s and interrupts contact in flight',
    (weather) => {
      const { race, model, tick } = fixture();
      const p = race.riders[0];
      p.speed = 3.25;
      p.turbo = true;
      for (let n = 0; n < 60; n++) {
        p.x += 3;
        tick(weather);
      }
      const expected = weather === 'rain' ? 'water' : weather === 'snow' ? 'snow' : 'clod';
      expect(model.counts[expected]).toBeGreaterThan(0);
      expect(model.diagnostics().marks).toBeGreaterThan(0);
      const before = model.counts[expected];
      p.grounded = false;
      p.height = 30;
      for (let n = 0; n < 60; n++) {
        p.x += 3;
        tick(weather);
      }
      // Atmospheric snow shares the pool; ground clods/water must stop exactly.
      if (weather !== 'snow') expect(model.counts[expected]).toBe(before);
      expect(model.counts.air).toBeGreaterThan(0);
    },
  );
  it('scales landing bursts, differentiates crashes, and produces mechanical effects', () => {
    const totals = [];
    for (const impactSpeed of [0.8, 2.5, 5]) {
      const { race, model, tick } = fixture();
      race.events = [{ type: 'land', rider: 0, frame: 1, impactSpeed }];
      tick();
      totals.push(model.counts.clod);
    }
    expect(totals[1]).toBeGreaterThan(totals[0]);
    expect(totals[2]).toBeGreaterThan(totals[1]);
    const { race, model, tick } = fixture();
    race.riders[0].overheated = true;
    for (let i = 0; i < 60; i++) tick();
    expect(model.counts.steam).toBeGreaterThan(0);
    race.events = [{ type: 'crash', rider: 0, frame: race.frame + 1, impactSpeed: 5 }];
    tick();
    expect(model.counts.clod).toBeGreaterThan(totals[2]);
  });
  it('cuts tracks on teleports, flight and recovery; fades at eight seconds', () => {
    const { race, model, tick } = fixture();
    const p = race.riders[0];
    for (let i = 0; i < 30; i++) {
      p.x += 3;
      tick();
    }
    const n = model.trackRevision;
    p.x += 300;
    tick();
    expect(model.trackRevision).toBe(n);
    p.recovery = 1;
    p.x += 3;
    tick();
    expect(model.trackRevision).toBe(n);
    expect(model.diagnostics(model.time + 8.1).marks).toBe(0);
  });
});

describe('budgets, lifecycle and crowd', () => {
  it.each(['high', 'low'] as const)(
    'bounds %s pools under repeated bursts and prioritizes impact slots',
    (quality) => {
      const s = settings();
      s.quality = quality;
      const { race, model, tick } = fixture(s);
      for (let n = 0; n < 1000; n++) {
        race.riders[0].x += 3;
        race.events = [{ type: 'crash', rider: 0, frame: n + 1, impactSpeed: 10 }];
        tick();
        const d = model.diagnostics();
        expect(d.active).toBeLessThanOrEqual(VFX_LIMITS[quality].particles);
        expect(d.marks).toBeLessThanOrEqual(VFX_LIMITS[quality].tracks);
      }
      expect(model.styles.length).toBe(1536 * 4);
      expect(model.trackPositions.length).toBe(512 * 18);
      expect(
        model.priorities.some((v, i) => i >= VFX_LIMITS[quality].particles * 0.75 && v === 2),
      ).toBe(true);
    },
  );
  it('freezes pause and camera, caps finish tail, resets, and honors reduced motion', () => {
    const s = settings();
    s.cameraShake = true;
    const { race } = fixture(s),
      vfx = new VfxSystem(new THREE.Scene(), race.track, s);
    race.frame = 10;
    race.events = [{ type: 'land', frame: 10, rider: 0, impactSpeed: 4 }];
    vfx.step(race, 'clear');
    vfx.advance(0.016, race, 'race', false, 1, 0, 'clear');
    const before = vfx.diagnostics();
    for (let i = 0; i < 60; i++) vfx.advance(1, race, 'race', true, 1, 0, 'clear');
    expect(vfx.diagnostics()).toEqual(before);
    // The app clears interpolation's accumulator while paused. Resuming before the
    // next simulation step must not rewind particles, wind or the camera pulse.
    vfx.advance(0.016, race, 'race', false, 0, 0, 'clear');
    expect(vfx.time).toBe(before.time);
    race.frame++;
    race.events = [{ type: 'finish', frame: race.frame, rider: 0 }];
    vfx.step(race, 'clear');
    for (let i = 0; i < 30; i++) vfx.advance(0.1, race, 'race', false, 1, 0, 'clear', true);
    expect(vfx.diagnostics().tail).toBe(2);
    const final = vfx.time;
    vfx.advance(50, race, 'race', false, 1, 0, 'clear', true);
    expect(vfx.time).toBe(final);
    vfx.reset();
    expect(vfx.diagnostics()).toMatchObject({
      active: 0,
      marks: 0,
      eventsConsumed: 0,
      finished: false,
    });
    vfx.applySettings(s, true);
    race.frame++;
    race.events = [{ type: 'crash', frame: race.frame, rider: 0, impactSpeed: 5 }];
    vfx.step(race, 'rain');
    expect(vfx.diagnostics().active).toBe(0);
    expect(vfx.model.cameraStrength).toBe(0);
    vfx.dispose();
  });
  it('reacts to nearby crashes and overtakes without consuming physics randomness', () => {
    const race = testRace(flat(), 3),
      motion = new StadiumMotion(stadiumLayout(race.track));
    race.phase = 'racing';
    race.frame = 1;
    race.events = [{ type: 'crash', frame: 1, rider: 1 }];
    const before = structuredClone(race);
    motion.step(race);
    expect([...motion.reactions.values()].some((r) => r.strength < 0)).toBe(true);
    expect(race).toEqual(before);
    motion.reset();
    race.events = [];
    race.riders[0].x = 80;
    race.riders[1].x = 81;
    race.frame = 2;
    motion.step(race);
    race.riders[0].x = 83;
    race.riders[1].x = 82;
    race.frame = 3;
    motion.step(race);
    expect(motion.reactions.size).toBeGreaterThan(0);
  });
});
