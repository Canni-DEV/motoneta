import { describe, expect, it } from 'vitest';
import { BIKE_SLOTS, TANQUE_PAINT, defaultAppearance, defaultVehicleAppearance, editGarage, garageAppearance, normalizeAppearance } from '../src/appearance';
import { localProfile, raceProfile, recordKey } from '../src/core/game';
import { tanqueCourses, tanqueDay, tanqueTournament } from '../src/core/tanque-tournament';
import { acceptResult, advanceSession, sessionConfig, standings } from '../src/core/competition';
import { emptyDesign, mapCourse } from '../src/core/maps';
import { createRace, stepRace } from '../src/core/racing';
import { motonetaTournament } from '../src/core/motoneta-tournament';

const owner = () => localProfile({ id: 'p', name: 'Piloto', color: '#123abc', appearance: defaultAppearance(), unlockedMotoneta: true });
describe('Torneo Tanque diario', () => {
  it('changes at Argentina midnight irrespective of the date representation', () => {
    expect(tanqueDay(new Date('2026-10-05T02:59:59.999Z'))).toBe('2026-10-04');
    expect(tanqueDay(new Date('2026-10-05T03:00:00.000Z'))).toBe('2026-10-05');
    expect(tanqueDay(new Date('2026-10-04T20:00:00-07:00'))).toBe('2026-10-05');
    expect(tanqueDay(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
  });
  it('uses identical independent calendars, with five distinct long tracks and guaranteed coverage', () => {
    for (let offset = 0; offset < 40; offset++) {
      const day = new Date(Date.UTC(2026, 9, 4 + offset)).toISOString().slice(0, 10);
      const courses = tanqueCourses(day);
      expect(tanqueCourses(day)).toEqual(courses);
      expect(courses).toHaveLength(5);
      expect(new Set(courses.map((c) => c.ref.revision)).size).toBe(5);
      expect(courses.every((c) => c.track.length === 6144 && c.track.laps === 2)).toBe(true);
      expect(courses.map((c) => c.track.segments.filter((s) => s.piece === 'T').length).sort()).toEqual([0, 1, 1, 2, 2]);
      expect(new Set(courses.map((c) => c.timeOfDay))).toEqual(new Set(['morning', 'afternoon', 'night']));
      expect(new Set(courses.map((c) => c.weather))).toEqual(new Set(['clear', 'rain', 'snow']));
      expect(courses.filter((c) => c.track.segments.some((s) => s.piece === 'T')).every((c) => c.loopGeometryVersion === 2)).toBe(true);
    }
    expect(tanqueCourses('2026-10-04').map((c) => c.ref.revision)).not.toEqual(tanqueCourses('2026-10-05').map((c) => c.ref.revision));
    expect(() => tanqueCourses('2026-02-30')).toThrow(/Fecha/);
    const a = tanqueCourses('2026-10-04'); a[0].track.laps = 9;
    expect(tanqueCourses('2026-10-04')[0].track.laps).toBe(2);
  });
  it('gates entry by local progression without leaking it into participants', () => {
    const p = owner(); p.unlockedMotoneta = false;
    expect(() => tanqueTournament(p)).toThrow('Desbloqueá la Motoneta');
    p.unlockedMotoneta = true;
    const s = tanqueTournament(p, new Date('2026-10-04T12:00:00Z'));
    expect(s).toMatchObject({ presetId: 'tanque', calendarDate: '2026-10-04', calendarVersion: 2, difficulty: 'hard' });
    expect(s.bots.map((b) => b.appearance.vehicle)).toEqual(['motocross', 'motocross', 'motocross']);
    expect(Object.keys(s.players[0]).sort()).toEqual(['appearance', 'color', 'id', 'name']);
    const other = owner(); other.id = 'other';
    expect(tanqueTournament(other, new Date('2026-10-04T22:00:00Z')).courses).toEqual(s.courses);
    expect(tanqueTournament(other, new Date('2026-10-04T22:00:00Z')).seed).toBe(s.seed);
    const frozen = structuredClone(s.courses);
    advanceSession(s);
    expect(s.courses).toEqual(frozen);
  });
  it('keeps the Motoneta scoring including exact ties and DNF', () => {
    let s = tanqueTournament(owner());
    for (let i = 0; i < 5; i++) {
      const config = sessionConfig(s);
      s = advanceSession(acceptResult(s, { config, limitTicks: 10000, finishes: [
        { id: 'p', ticks: 100, laps: [50, 100], crashes: 0 }, { id: 'bot-1', ticks: 100, laps: [50, 100], crashes: 0 },
        { id: 'bot-2', ticks: 200, laps: [100, 200], crashes: 0 }, { id: 'bot-3', ticks: null, laps: [], crashes: 0 },
      ] }, `r${i}`));
    }
    expect(s.phase).toBe('complete');
    expect(standings(s).map((r) => [r.id, r.rank, r.points])).toEqual([['p', 1, 50], ['bot-1', 1, 50], ['bot-2', 3, 30], ['bot-3', 4, 0]]);
  });
});
describe('Tanque appearance compatibility', () => {
  it('adds a locked vehicle to existing garages and keeps both earlier bikes and rider', () => {
    const original = owner(); original.garage.bikes.motoneta.parts.fairing = 'trail'; original.garage.rider.parts.helmet = 'sprint';
    const legacy = structuredClone(original); delete (legacy as Partial<typeof legacy>).unlockedTanque;
    delete (legacy.garage.bikes as Partial<typeof legacy.garage.bikes>).tanque;
    const restored = localProfile(legacy);
    expect(restored.unlockedTanque).toBe(false);
    expect(restored.garage.bikes.motoneta.parts.fairing).toBe('trail');
    expect(restored.garage.rider.parts.helmet).toBe('sprint');
    expect(garageAppearance(restored.garage, 'tanque').paints.fairing).toEqual(TANQUE_PAINT);
  });
  it('canonicalizes global paint and fixed bike parts while preserving rider choices', () => {
    const p = owner(), a = garageAppearance(p.garage, 'tanque');
    a.parts.wheels = 'trail'; a.parts.helmet = 'sprint'; a.paints.fairing = { primary: '#abcdef', accent: '#fedcba' };
    a.paints.exhaust.primary = '#000000'; editGarage(p.garage, a);
    const normalized = garageAppearance(p.garage, 'tanque');
    for (const slot of BIKE_SLOTS) {
      expect(normalized.parts[slot]).toBe('core');
      expect(normalized.paints[slot]).toEqual(a.paints.fairing);
    }
    expect(normalized.parts.helmet).toBe('sprint');
    expect(garageAppearance(p.garage).parts.helmet).toBe('sprint');
    expect(garageAppearance(p.garage).paints.fairing.primary).not.toBe('#abcdef');
    expect(normalizeAppearance(a)).toEqual(normalized);
    expect(defaultVehicleAppearance('tanque').paints.fairing).toEqual(TANQUE_PAINT);
  });
  it('retains identical physics and record keys for all three vehicles', () => {
    const config = sessionConfig(motonetaTournament(owner()));
    const map = emptyDesign(); map.length = 640; map.laps = 1; Object.assign(config, mapCourse(map));
    const races = ['motocross', 'motoneta', 'tanque'].map((vehicle) => {
      const c = structuredClone(config); c.player.appearance = defaultVehicleAppearance(vehicle as 'motocross' | 'motoneta' | 'tanque');
      expect(recordKey(c)).toBe(recordKey(config)); return createRace(c);
    });
    for (let tick = 0; tick < 600; tick++) for (const r of races) stepRace(r, 1);
    expect(races[1].riders).toEqual(races[0].riders); expect(races[2].riders).toEqual(races[0].riders);
    expect(raceProfile(owner())).not.toHaveProperty('unlockedTanque');
  });
});
