import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { emptyDesign, validateMap } from '../src/core/maps';
import { isFinished, stepRace } from '../src/core/racing';
import { appendInput, newRecording, validateRecording } from '../src/core/recording';
import { FILE_HEADER, GAME_ID, mapFilename } from '../src/identity';
import { testRace, testTrack } from './race-fixture';

it('keeps package identity and portable download filenames consistent', () => {
  expect(JSON.parse(readFileSync('package.json', 'utf8')).name).toBe(GAME_ID);
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  expect(lock.name).toBe(GAME_ID);
  expect(lock.packages[''].name).toBe(GAME_ID);
  expect(mapFilename('  Ruta Ñandú / Río  ')).toBe('motoneta-mapa-ruta-nandu-rio.json');
  expect(mapFilename('🏍️ /')).toBe('motoneta-mapa-circuito.json');
});
it('accepts only the current MotoNeta map and recording contracts', () => {
  const design = emptyDesign();
  expect(validateMap(JSON.parse(JSON.stringify(design)))).toMatchObject(FILE_HEADER);
  const race = testRace(testTrack());
  const recording = newRecording(race.config);
  while (!isFinished(race, 0)) {
    appendInput(recording, 1);
    stepRace(race, 1);
  }
  expect(validateRecording(recording)).toMatchObject({ ...FILE_HEADER, ruleset: 'motoneta-2' });
  for (const change of [{ game: undefined }, { game: 'other' }, { version: 1 }, { version: 0 }]) {
    expect(() => validateMap({ ...design, ...change })).toThrow();
    expect(() => validateRecording({ ...recording, ...change })).toThrow();
  }
  expect(() => validateRecording({ ...recording, ruleset: 'other' })).toThrow();
});
