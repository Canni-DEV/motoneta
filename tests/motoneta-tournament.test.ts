import { describe, expect, it } from 'vitest';
import { BIKE_SLOTS, defaultAppearance, editGarage, garageAppearance } from '../src/appearance';
import { localProfile, raceProfile, recordKey } from '../src/core/game';
import { motonetaTournament } from '../src/core/motoneta-tournament';
import { acceptResult, advanceSession, sessionConfig, standings } from '../src/core/competition';
import { completeRace, createRace, stepRace } from '../src/core/racing';
import { appendInput, newRecording, validateRecording } from '../src/core/recording';
import { emptyDesign, mapCourse } from '../src/core/maps';

const player = () => localProfile({ id: 'p1', name: 'Piloto', color: '#123abc', appearance: defaultAppearance('#123abc') });
describe('Torneo Motoneta', () => {
  it('freezes the approved five-course preset and bot identities', () => {
    const s = motonetaTournament(player());
    expect(s).toMatchObject({ mode: 'tournament', presetId: 'motoneta', seed: 1984, difficulty: 'hard' });
    expect(s.bots.map((p) => [p.id, p.name, p.appearance.vehicle])).toEqual([['bot-1','Bot 1','motocross'],['bot-2','Bot 2','motocross'],['bot-3','Bot 3','motocross']]);
    expect(s.courses.map((c) => [c.ref.id, c.track.laps, c.timeOfDay, c.weather])).toEqual([
      ['nes-1-main',2,'morning','clear'],['nes-2-main',2,'afternoon','rain'],['nes-3-main',2,'morning','snow'],['nes-4-main',2,'night','clear'],['nes-5-main',2,'night','rain'],
    ]);
    s.courses[0].track.laps = 9;
    expect(motonetaTournament(player()).courses[0].track.laps).toBe(2);
  });
  it('allows a tied championship winner, with no points for DNF', () => {
    let s = motonetaTournament(player());
    for (let i = 0; i < 5; i++) {
      const config = sessionConfig(s);
      s = advanceSession(acceptResult(s, {config,limitTicks:10000,finishes:[
        {id:'p1',ticks:100,laps:[50,100],crashes:0}, {id:'bot-1',ticks:100,laps:[50,100],crashes:0},
        {id:'bot-2',ticks:200,laps:[100,200],crashes:0},{id:'bot-3',ticks:null,laps:[],crashes:0},
      ]}, `r${i}`));
    }
    expect(s.phase).toBe('complete');
    expect(standings(s).map((p) => [p.id,p.rank,p.points])).toEqual([['p1',1,50],['bot-1',1,50],['bot-2',3,30],['bot-3',4,0]]);
  });
});
describe('vehicle appearances and compatibility', () => {
  it('preserves old customization, initializes a locked scooter, and strips local progression from snapshots', () => {
    const old = player();
    old.appearance.parts.fairing = 'trail';
    const legacy = {id:old.id,name:old.name,color:old.color,appearance:old.appearance};
    delete (legacy.appearance as Partial<typeof old.appearance>).vehicle;
    const restored = localProfile(legacy);
    expect(restored.unlockedMotoneta).toBe(false);
    expect(restored.garage.bikes.motocross.parts.fairing).toBe('trail');
    expect(garageAppearance(restored.garage,'motoneta').parts.fairing).toBe('core');
    expect(garageAppearance(restored.garage,'motoneta').paints.fairing).toEqual({primary:'#123abc',accent:'#eff0ec'});
    expect(Object.keys(raceProfile(restored)).sort()).toEqual(['appearance','color','id','name']);
  });
  it('keeps each motorcycle independent while sharing rider clothing', () => {
    const p = player();
    const scooter = garageAppearance(p.garage,'motoneta');
    scooter.parts.fairing = 'sprint'; scooter.paints.fairing.primary = '#abcdef'; scooter.parts.helmet = 'trail';
    editGarage(p.garage,scooter);
    expect(garageAppearance(p.garage).parts.fairing).toBe('core');
    expect(garageAppearance(p.garage).parts.helmet).toBe('trail');
    expect(garageAppearance(p.garage,'motoneta').paints.fairing.primary).toBe('#abcdef');
    expect(BIKE_SLOTS.every((slot) => garageAppearance(p.garage).parts[slot] === 'core')).toBe(true);
  });
  it('has identical physical states, arrivals and record keys, and imports older recordings', () => {
    const config = sessionConfig(motonetaTournament(player()));
    const map = emptyDesign(); map.length = 640; map.laps = 1;
    Object.assign(config,mapCourse(map));
    const scooter = structuredClone(config); scooter.player.appearance.vehicle = 'motoneta';
    const a = createRace(config), b = createRace(scooter), recording = newRecording(config);
    while (a.phase !== 'finished') { stepRace(a,1); stepRace(b,1); appendInput(recording,1); }
    completeRace(a); completeRace(b);
    expect(b.riders).toEqual(a.riders);
    expect(b.finishes).toEqual(a.finishes);
    expect(recordKey(scooter)).toBe(recordKey(config));
    recording.result = {config,finishes:a.finishes,limitTicks:a.limitTicks};
    for (const p of [recording.config.player,...recording.config.bots]) delete (p.appearance as Partial<typeof p.appearance>).vehicle;
    expect(validateRecording(recording).config.player.appearance.vehicle).toBe('motocross');
  });
});
