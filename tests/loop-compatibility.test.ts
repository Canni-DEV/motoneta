import { describe, expect, it } from 'vitest';
import { emptyDesign, mapCourse, mapTrack, placedPiece, validateMap } from '../src/core/maps';
import { appendInput, newRecording, Playback, validateRecording } from '../src/core/recording';
import { abandonPlayer, completeRace, createRace, raceResult, stepRace } from '../src/core/racing';
import { fingerprint } from '../src/core/simulation';
import { LOOP_GEOMETRY_VERSION } from '../src/core/loop-geometry';
import { Input } from '../src/core/types';
import { testRace } from './race-fixture';

function design(loops: boolean) {
  const d = emptyDesign();
  d.laps = 1;
  d.items = loops ? [placedPiece('T', 512)] : [];
  return validateMap(d);
}
function recording(loops: boolean) {
  const d = design(loops), r = createRace({ ...testRace(mapTrack(d), 0).config, ...mapCourse(d) });
  const recording = newRecording(r.config);
  for (let frame = 0; frame < 400; frame++) {
    appendInput(recording, Input.A);
    stepRace(r, Input.A);
  }
  abandonPlayer(r);
  completeRace(r);
  recording.termination = 'abandoned';
  recording.result = raceResult(r);
  return { r, recording };
}

describe('loop geometry compatibility without a global save reset', () => {
  it.each([false, true])('adds metadata only to new courses, races and recordings with loops: %s', loops => {
    const course = mapCourse(design(loops)), { r, recording: replay } = recording(loops);
    for (const config of [course, r.config, replay.config, replay.result.config])
      expect(config.loopGeometryVersion).toBe(loops ? LOOP_GEOMETRY_VERSION : undefined);
    const imported = validateRecording(replay), playback = new Playback(imported);
    while (!playback.done) playback.step();
    completeRace(playback.race);
    expect(fingerprint(playback.race)).toBe(fingerprint(r));
    expect(imported.config.loopGeometryVersion).toBe(loops ? LOOP_GEOMETRY_VERSION : undefined);
    expect(imported.result.finishes).toEqual(replay.result.finishes);
    expect(imported.result.limitTicks).toBe(replay.result.limitTicks);
  });
  it.each([undefined, 1, 3])('rejects a replay with loops and incompatible geometry %s before playing it', version => {
    const { recording: replay } = recording(true);
    replay.config.loopGeometryVersion = version;
    expect(() => validateRecording(replay)).toThrow(/geometría actual del loop/);
    expect(() => new Playback(replay)).toThrow(/geometría actual del loop/);
  });
  it('keeps previous format-3 loop maps and their exact saved positions', () => {
    const saved = design(true), imported = validateMap(JSON.parse(JSON.stringify(saved)));
    expect(imported).toEqual(saved);
    expect(imported.version).toBe(3);
    expect(imported.items[0].length).toBe(128);
    expect(mapCourse(imported).loopGeometryVersion).toBe(2);
  });
});
