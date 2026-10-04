import { expect, test } from '@playwright/test';
import { nav, ready, runtimeModuleUrl } from './ui-helpers';

test('equipped Tanque works across tournaments, versus, quick race and editor; older snapshots keep their vehicle', async ({ page }) => {
  await ready(page); const module = await runtimeModuleUrl(page, '/src/persistence.ts');
  const originalReplay = await page.evaluate(async (module) => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { motonetaTournament }, { tanqueTournament }, { localProfile, raceProfile }, { defaultAppearance, garageAppearance }, { newRecording }, { sessionConfig, advanceSession }, { emptyDesign, mapCourse }] = await Promise.all([
      source(module), source('/src/core/motoneta-tournament.ts'), source('/src/core/tanque-tournament.ts'), source('/src/core/game.ts'), source('/src/appearance.ts'), source('/src/core/recording.ts'), source('/src/core/competition.ts'), source('/src/core/maps.ts'),
    ]);
    const store = new GameStore(); await store.open(); const owner = store.state.profiles[0];
    await store.update((s: any) => { s.motonetaSessions[owner.id] = motonetaTournament(owner); });
    const prior = store.state.motonetaSessions[owner.id], config = sessionConfig(prior), replay = newRecording(config);
    replay.termination = 'abandoned'; replay.result = { config, limitTicks: 10000, finishes: [config.player, ...config.bots].map((p: any, i: number) => ({ id: p.id, ticks: i ? 100 + i * 100 : null, laps: i ? [50, 100 + i * 100] : [], crashes: 0 })) };
    await store.commit(replay, prior); const id = store.state.motonetaSessions[owner.id].results[0].replayId;
    await store.update((s: any) => {
      s.motonetaSessions[owner.id] = advanceSession(s.motonetaSessions[owner.id]);
      const maps = [1, 2, 3].map((i) => mapCourse({ ...emptyDesign(), name: `Corto ${i}`, length: 640, laps: 1 }));
      const custom = motonetaTournament(owner); delete custom.presetId; custom.courses = maps; custom.bots = []; s.sessions.tournament = custom;
      const second = localProfile({ id: 'second', name: 'Segundo', color: '#123abc', appearance: defaultAppearance() }); s.profiles.push(second);
      s.sessions.versus = { ...structuredClone(custom), id: 'versus-fixture', mode: 'versus', players: [raceProfile(owner), raceProfile(second)], courses: maps.slice(0, 2) };
      s.profiles[0].unlockedMotoneta = true; s.profiles[0].unlockedTanque = true;
      s.profiles[0].garage.vehicle = 'tanque'; s.profiles[0].appearance = garageAppearance(s.profiles[0].garage);
      s.tanqueSessions[owner.id] = tanqueTournament(s.profiles[0]);
    }); return id;
  }, module);
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden();
  for (const mode of ['motoneta', 'tanque', 'tournament', 'versus']) {
    await page.locator(`[data-action="resume-session"][data-value="${mode}"]`).click(); await page.locator('[data-action="begin-turn"]').click();
    await expect(page.locator('.race-identity')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__motoneta.vehicles[0])).toBe('tanque');
    await page.keyboard.press('Escape'); await page.locator('[data-action="leave-race"]').click(); await page.locator('[data-action="confirm-abandon"]').click();
    await expect(page.getByRole('heading', { name: 'Resultado', exact: true })).toBeVisible(); await page.locator('[data-action="leave-race"]').click();
    await page.locator('.topbar [data-action="home"]').click();
  }
  const prior = await page.evaluate(async ({ module, id }) => {
    const { GameStore } = await import(/* @vite-ignore */ module); const store = new GameStore(); await store.open(); return (await store.replay(id)).config.player.appearance.vehicle;
  }, { module, id: originalReplay });
  expect(prior).toBe('motocross');
  await nav(page, 'quick'); await page.locator('[data-action="start"]').click(); await expect(page.locator('.race-identity')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__motoneta.vehicles[0])).toBe('tanque');
  await page.keyboard.press('Escape'); await page.locator('[data-action="leave-race"]').click(); await nav(page, 'editor');
  await page.getByRole('button', { name: 'Probar pista', exact: true }).click(); await expect(page.locator('.race-identity')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__motoneta.vehicles[0])).toBe('tanque');
});

test('Tanque replay import and personal ghost retain paint after changing the equipped bike', async ({ page }) => {
  await ready(page); const module = await runtimeModuleUrl(page, '/src/persistence.ts');
  const imported = await page.evaluate(async (module) => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { raceProfile }, { garageAppearance }, { emptyDesign, mapCourse, validateMap }, { quickRaceConfig }, { createRace, stepRace, raceResult }, { newRecording, appendInput, validateRecording }] = await Promise.all([
      source(module), source('/src/core/game.ts'), source('/src/appearance.ts'), source('/src/core/maps.ts'), source('/src/core/personal-ghost.ts'), source('/src/core/racing.ts'), source('/src/core/recording.ts'),
    ]);
    const store = new GameStore(); await store.open(); const map = validateMap({ ...emptyDesign(), name: 'Fantasma Tanque', length: 640, laps: 1 });
    await store.update((s: any) => {
      s.maps = [map]; const owner = s.profiles[0]; owner.unlockedMotoneta = true; owner.unlockedTanque = true; owner.garage.vehicle = 'tanque';
      owner.garage.bikes.tanque.paints.fairing = { primary: '#21a4bd', accent: '#df6135' }; owner.appearance = garageAppearance(owner.garage);
    });
    const config = quickRaceConfig(mapCourse(map), raceProfile(store.state.profiles[0]), 0, 'normal');
    const race = createRace(config), replay = newRecording(config);
    while (race.phase !== 'finished') { stepRace(race, 1); appendInput(replay, 1); }
    replay.result = raceResult(race); const imported = validateRecording(replay); await store.commit(imported);
    await store.update((s: any) => { const p = s.profiles[0]; p.garage.vehicle = 'motocross'; p.appearance = garageAppearance(p.garage); });
    return { vehicle: imported.config.player.appearance.vehicle, paint: imported.config.player.appearance.paints.fairing };
  }, module);
  expect(imported).toEqual({ vehicle: 'tanque', paint: { primary: '#21a4bd', accent: '#df6135' } });
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden(); await nav(page, 'quick');
  await page.locator('.track-card', { hasText: 'Fantasma Tanque' }).click(); await expect(page.locator('#quick-record')).toContainText('Tu récord:');
  await page.getByRole('checkbox', { name: 'Correr contra mi fantasma' }).check(); await page.locator('[data-action="start"]').click();
  await expect(page.locator('.race-identity')).toBeVisible();
  const state = await page.evaluate(() => (window as any).__motoneta);
  expect(state.vehicles.slice(0, 2)).toEqual(['motocross', 'tanque']); expect(state.ghosts[0].vehicle).toBe('tanque');
  await page.keyboard.press('Escape'); await page.locator('[data-action="leave-race"]').click(); await nav(page, 'records');
  await page.locator('[data-action="record-watch"]').click(); await expect(page.locator('.race-identity')).toBeVisible();
  const watched = await page.evaluate(() => (window as any).__motoneta);
  expect(watched.vehicles[0]).toBe('tanque'); expect(watched.race.config.player.appearance.paints.fairing).toEqual(imported.paint);
});

test('profile isolation and deletion remove only the owner Tanque attempt and its retained replay', async ({ page }) => {
  await ready(page); const module = await runtimeModuleUrl(page, '/src/persistence.ts');
  const replayId = await page.evaluate(async (module) => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { tanqueTournament }, { sessionConfig }, { newRecording }, { localProfile }, { defaultAppearance }] = await Promise.all([
      source(module), source('/src/core/tanque-tournament.ts'), source('/src/core/competition.ts'), source('/src/core/recording.ts'), source('/src/core/game.ts'), source('/src/appearance.ts'),
    ]);
    const store = new GameStore(); await store.open();
    await store.update((s: any) => {
      s.profiles[0].unlockedMotoneta = true; s.profiles[0].unlockedTanque = true; s.tanqueSessions[s.profiles[0].id] = tanqueTournament(s.profiles[0]);
      s.profiles.push(localProfile({ id: 'other', name: 'Otro', color: '#123abc', appearance: defaultAppearance() }));
    });
    const session = store.state.tanqueSessions[store.state.activeProfile], config = sessionConfig(session), replay = newRecording(config);
    replay.termination = 'abandoned'; replay.result = { config, limitTicks: 10000, finishes: [config.player, ...config.bots].map((p: any, i: number) => ({ id: p.id, ticks: i ? 100 + i * 100 : null, laps: i ? [50, 100 + i * 100] : [], crashes: 0 })) };
    await store.commit(replay, session); await store.update((s: any) => { s.activeProfile = 'other'; });
    return store.state.tanqueSessions[session.players[0].id].results[0].replayId;
  }, module);
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden();
  await expect(page.getByRole('button', { name: /Continuar Torneo Tanque/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Perfiles', exact: true }).click();
  await page.locator('[data-action="profile-select"][data-value="player-1"]').click();
  await page.locator('[data-action="delete-profile"][data-value="player-1"]').click(); await page.locator('[data-action="confirm-delete-profile"]').click();
  await expect(page.locator('[data-action="profile-select"][data-value="player-1"]')).toHaveCount(0);
  const result = await page.evaluate(async ({ module, replayId }) => {
    const { GameStore } = await import(/* @vite-ignore */ module); const store = new GameStore(); await store.open();
    return { ownerRemoved: !store.state.tanqueSessions['player-1'], replayRemoved: !await store.replay(replayId), otherLocked: !store.state.profiles[0].unlockedTanque };
  }, { module, replayId });
  expect(result).toEqual({ ownerRemoved: true, replayRemoved: true, otherLocked: true });
});
