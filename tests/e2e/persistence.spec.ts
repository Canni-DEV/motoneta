import { expect, test } from '@playwright/test';
test('initialization is repeatable; failed result writes roll back atomically and retry once', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem('motoneta.settings.v3', JSON.stringify({ quality: 'low', volume: 0 }));
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  const result = await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [
      { GameStore },
      { createRace, stepRace, raceResult },
      { newRecording, appendInput },
      { mapCourse, emptyDesign, validateMap },
    ] = await Promise.all([
      source('/src/persistence.ts'),
      source('/src/core/racing.ts'),
      source('/src/core/recording.ts'),
      source('/src/core/maps.ts'),
    ]);
    const store = new GameStore();
    await store.open();
    await store.update((s: any) => {
      s.maps = [validateMap({ ...emptyDesign(), name: 'Original', length: 640, laps: 1 })];
    });
    const saved = JSON.stringify(store.state.maps);
    await store.open();
    const repeat = JSON.stringify(store.state.maps);
    const c = {
      ...mapCourse(store.state.maps[0]),
      mode: 'tournament',
      player: store.state.profiles[0],
      bots: [],
      difficulty: 'normal',
      seed: 12,
    };
    const r = createRace(c),
      replay = newRecording(c);
    while (r.phase !== 'finished') {
      appendInput(replay, 1);
      stepRace(r, 1);
    }
    replay.result = raceResult(r);
    const session = {
      id: 'atomic',
      mode: 'tournament',
      players: [c.player],
      bots: [],
      difficulty: 'normal',
      courses: [mapCourse(store.state.maps[0])],
      courseIndex: 0,
      turnIndex: 0,
      results: [],
      phase: 'ready',
      seed: 12,
    };
    await store.update((s: any) => {
      s.sessions.tournament = session;
    });
    const put = IDBObjectStore.prototype.put;
    let rejected = false;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === 'replays') throw new DOMException('Storage full', 'QuotaExceededError');
      return put.apply(this, args as any);
    };
    try {
      await store.commit(replay, session);
    } catch {
      rejected = true;
    } finally {
      IDBObjectStore.prototype.put = put;
    }
    const disk = new GameStore();
    await disk.open();
    const rolledBack =
      disk.state.sessions.tournament.results.length === 0 &&
      disk.state.records.length === 0 &&
      store.state.records.length === 0;
    await store.commit(replay, session);
    const first = JSON.stringify(await store.replay('atomic:0:0'));
    await store.commit({ ...replay, result: { ...replay.result, finishes: [] } }, session);
    const duplicate = JSON.stringify(await store.replay('atomic:0:0'));
    await disk.open();
    return {
      saved,
      repeat,
      rejected,
      rolledBack,
      first,
      duplicate,
      count: disk.state.sessions.tournament.results.length,
      marks: disk.state.records.length,
    };
  });
  expect(result.repeat).toBe(result.saved);
  expect(result.rejected).toBe(true);
  expect(result.rolledBack).toBe(true);
  expect(result.first).toBe(result.duplicate);
  expect(result.count).toBe(1);
  expect(result.marks).toBe(1);
});

test('best lap and best race retain separate replays and old map snapshots', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  const result = await page.evaluate(async () => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { emptyDesign, mapCourse, validateMap }, { newRecording }] =
      await Promise.all([
        source('/src/persistence.ts'),
        source('/src/core/maps.ts'),
        source('/src/core/recording.ts'),
      ]);
    const store = new GameStore();
    await store.open();
    const map = validateMap({
      ...emptyDesign(),
      id: 'original',
      name: 'Mapa original',
      length: 640,
      laps: 2,
    });
    const c = {
      ...mapCourse(map),
      mode: 'quick',
      player: store.state.profiles[0],
      bots: [],
      difficulty: 'normal',
      seed: 1,
    };
    const first = newRecording(c);
    first.result = {
      config: c,
      limitTicks: 33750,
      finishes: [{ id: c.player.id, ticks: 200, laps: [100, 200], crashes: 0 }],
    };
    await store.commit(first);
    const second = structuredClone(first);
    second.result.finishes[0] = { id: c.player.id, ticks: 240, laps: [80, 240], crashes: 0 };
    await store.commit(second);
    const record = store.state.records[0];
    const a = await store.replay(record.replayId),
      b = await store.replay(record.lapReplayId);
    await store.update((s: any) => {
      s.maps = [];
    });
    const frozen = store.state.records[0].config.track.name;
    return {
      ticks: record.ticks,
      lap: record.bestLap,
      different: record.replayId !== record.lapReplayId,
      a: !!a,
      b: !!b,
      frozen,
    };
  });
  expect(result).toEqual({
    ticks: 200,
    lap: 80,
    different: true,
    a: true,
    b: true,
    frozen: 'Mapa original',
  });
});
