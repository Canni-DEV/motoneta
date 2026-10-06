import { expect, test, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { nav, ready, runtimeModuleUrl } from './ui-helpers';

const day = '2026-10-04';
async function menu(page: Page) {
  await nav(page, 'home');
  await page.locator('.home-modes [data-value="tournament"]').click();
  await page.getByRole('button', { name: 'Torneo Tanque', exact: true }).click();
}
async function unlock(page: Page, tanque = false) {
  const module = '/src/persistence.ts';
  await page.evaluate(async ({ module, tanque }) => {
    const { GameStore } = await import(/* @vite-ignore */ module);
    const store = new GameStore(); await store.open();
    await store.update((s: any) => { s.profiles[0].unlockedMotoneta = true; s.profiles[0].unlockedTanque = tanque; });
  }, { module, tanque });
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden();
}
test('locked entry, Argentina calendar rollover, frozen continuation and replacement', async ({ page }) => {
  await page.clock.install({ time: new Date(`${day}T15:00:00Z`) });
  await ready(page); await menu(page);
  await expect(page.getByText('Desbloqueá la Motoneta para participar.')).toBeVisible();
  await expect(page.locator('[data-action="start-tanque"]')).toBeDisabled();
  await expect(page.locator('.preset-calendar li')).toHaveCount(5);
  await unlock(page); await menu(page);
  await expect(page.getByRole('heading', { name: `Calendario del ${day}` })).toBeVisible();
  await page.clock.setSystemTime(new Date('2026-10-05T03:00:01Z'));
  await expect(page.getByRole('heading', { name: 'Calendario del 2026-10-05' })).toBeVisible();
  await page.locator('[data-action="start-tanque"]').click();
  await expect(page.locator('.session-page')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Torneo Tanque', exact: true })).toBeVisible();
  const original = await page.evaluate(() => (window as any).__motoneta.session);
  expect(original.calendarDate).toBe('2026-10-05');
  await page.clock.setSystemTime(new Date('2026-10-06T03:00:01Z'));
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: /Continuar Torneo Tanque/ }).click();
  expect(await page.evaluate(() => (window as any).__motoneta.session)).toEqual(original);
  await menu(page);
  await expect(page.getByRole('heading', { name: 'Calendario de tu intento: 2026-10-05' })).toBeVisible();
  await page.getByRole('button', { name: 'Empezar nuevo', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continuar Torneo Tanque', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Empezar nuevo', exact: true }).click();
  await page.getByRole('button', { name: 'Reemplazar intento', exact: true }).click();
  await expect(page.locator('.session-page')).toBeVisible();
  const replaced = await page.evaluate(() => (window as any).__motoneta.session);
  expect(replaced.id).not.toBe(original.id); expect(replaced.calendarDate).toBe('2026-10-06'); expect(replaced.courses).not.toEqual(original.courses);
});

test('fifth result and tied reward are atomic, idempotent and owned by the participant', async ({ page }) => {
  await ready(page); const module = await runtimeModuleUrl(page, '/src/persistence.ts');
  const result = await page.evaluate(async (module) => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { tanqueTournament }, { sessionConfig, advanceSession }, { newRecording }, { localProfile }, { defaultAppearance }] = await Promise.all([
      source(module), source('/src/core/tanque-tournament.ts'), source('/src/core/competition.ts'), source('/src/core/recording.ts'), source('/src/core/game.ts'), source('/src/appearance.ts'),
    ]);
    const store = new GameStore(); await store.open();
    await store.update((s: any) => {
      s.profiles[0].unlockedMotoneta = true;
      s.profiles.push(localProfile({ id: 'other', name: 'Otro', color: '#123abc', appearance: defaultAppearance() }));
      s.activeProfile = 'other'; s.tanqueSessions[s.profiles[0].id] = tanqueTournament(s.profiles[0]);
    });
    const ownerId = store.state.profiles[0].id;
    const recording = (session: any) => {
      const config = sessionConfig(session), r = newRecording(config);
      r.result = { config, limitTicks: 10000, finishes: [config.player, ...config.bots].map((p: any, i: number) => ({ id: p.id, ticks: i < 2 ? 100 : 100 + i * 100, laps: i < 2 ? [50, 100] : [100, 100 + i * 100], crashes: 0 })) };
      return r;
    };
    for (let i = 0; i < 4; i++) {
      const s = store.state.tanqueSessions[ownerId]; await store.commit(recording(s), s);
      await store.update((state: any) => { state.tanqueSessions[ownerId] = advanceSession(state.tanqueSessions[ownerId]); });
    }
    const last = store.state.tanqueSessions[ownerId], replay = recording(last), put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) { if (this.name === 'replays') throw new DOMException('Full', 'QuotaExceededError'); return put.apply(this, args as any); };
    let rejected = false;
    try { await store.commit(replay, last); } catch { rejected = true; } finally { IDBObjectStore.prototype.put = put; }
    const disk = new GameStore(); await disk.open();
    const rollback = !store.state.profiles[0].unlockedTanque && !disk.state.profiles[0].unlockedTanque && disk.state.tanqueSessions[ownerId].results.length === 4;
    await store.commit(replay, last);
    const snapshot = JSON.stringify(await store.backup()); await store.commit(replay, last);
    const duplicate = JSON.stringify(await store.backup()) === snapshot;
    await disk.open(); const backup = await disk.backup();
    await disk.update((s: any) => { s.activeProfile = ownerId; });
    return { rejected, rollback, duplicate, unlocked: disk.state.profiles[0].unlockedTanque, other: disk.state.profiles[1].unlockedTanque,
      reward: disk.state.tanqueSessions[ownerId].reward, phase: disk.state.tanqueSessions[ownerId].phase,
      retained: disk.state.tanqueSessions[ownerId].results.every((r: any) => !!backup.replays[r.replayId]), vehicle: disk.state.profiles[0].garage.vehicle };
  }, module);
  expect(result).toEqual({ rejected: true, rollback: true, duplicate: true, unlocked: true, other: false, reward: 'unlocked', phase: 'complete', retained: true, vehicle: 'motocross' });
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden();
  await menu(page); await page.getByRole('button', { name: 'Ver último resultado', exact: true }).click();
  await expect(page.getByText('¡Desbloqueaste el Tanque!')).toBeVisible();
  await page.getByRole('button', { name: 'Ir al garaje', exact: true }).click();
  await expect(page.locator('[data-action="garage-vehicle"][data-value="tanque"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="garage-cancel"]').click();
  expect(await page.evaluate(() => (window as any).__motoneta.profiles[0].garage.vehicle)).toBe('motocross');
  await page.getByRole('button', { name: 'Ir al garaje', exact: true }).click();
  await page.locator('[data-action="garage-save"]').click();
  await expect(page.locator('#garage-stage')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__motoneta.profiles[0].garage.vehicle)).toBe('tanque');
});

test('losses, DNF, custom competitions, replay commits and repeated victories preserve the right reward', async ({ page }) => {
  await ready(page); const module = await runtimeModuleUrl(page, '/src/persistence.ts');
  const outcomes = await page.evaluate(async (module) => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { tanqueTournament }, { advanceSession, sessionConfig }, { newRecording }] = await Promise.all([
      source(module), source('/src/core/tanque-tournament.ts'), source('/src/core/competition.ts'), source('/src/core/recording.ts'),
    ]);
    const store = new GameStore(); await store.open(); await store.update((s: any) => { s.profiles[0].unlockedMotoneta = true; });
    const owner = store.state.profiles[0];
    const standalone = newRecording(sessionConfig(tanqueTournament(owner)));
    standalone.result.finishes = [standalone.config.player, ...standalone.config.bots].map((p: any, i: number) => ({ id: p.id, ticks: 100 + i * 100, laps: [50, 100 + i * 100], crashes: 0 }));
    await store.commit(standalone);
    const replayUnlock = store.state.profiles[0].unlockedTanque;
    const run = async (preset: boolean, win: boolean, abandoned = false) => {
      const fresh = tanqueTournament(owner); if (!preset) delete fresh.presetId;
      await store.update((s: any) => { if (preset) s.tanqueSessions[owner.id] = fresh; else s.sessions.tournament = fresh; });
      for (let i = 0; i < 5; i++) {
        const session = preset ? store.state.tanqueSessions[owner.id] : store.state.sessions.tournament;
        const config = sessionConfig(session), replay = newRecording(config);
        replay.result = { config, limitTicks: 10000, finishes: [config.player, ...config.bots].map((p: any, index: number) => ({ id: p.id, ticks: index === 0 && abandoned ? null : index === 0 && !win ? 500 : 100 + index * 100, laps: index === 0 && abandoned ? [] : [50, 100 + index * 100], crashes: 0 })) };
        await store.commit(replay, session);
        await store.update((s: any) => { if (preset) s.tanqueSessions[owner.id] = advanceSession(s.tanqueSessions[owner.id]); else s.sessions.tournament = advanceSession(s.sessions.tournament); });
      }
      return { reward: preset ? store.state.tanqueSessions[owner.id].reward : undefined, unlocked: store.state.profiles[0].unlockedTanque };
    };
    const custom = await run(false, true), dnf = await run(true, false, true), lost = await run(true, false), won = await run(true, true), repeated = await run(true, true), laterLoss = await run(true, false);
    return { replayUnlock, custom: custom.unlocked, dnf, lost, won, repeated, laterLoss };
  }, module);
  expect(outcomes).toEqual({ replayUnlock: false, custom: false, dnf: { reward: 'not-earned', unlocked: false }, lost: { reward: 'not-earned', unlocked: false }, won: { reward: 'unlocked', unlocked: true }, repeated: { reward: 'already-unlocked', unlocked: true }, laterLoss: { reward: 'not-earned', unlocked: true } });
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 844, height: 390 }]) test(`fixed scooter colors, shared rider, cancel and reset at ${viewport.width}px`, async ({ page }) => {
  await page.setViewportSize(viewport); await ready(page);
  const open = async () => { await page.getByRole('button', { name: 'Perfiles', exact: true }).click(); await page.locator('[data-action="garage-open"]').click(); };
  await open(); await page.locator('[data-action="garage-vehicle"][data-value="tanque"]').click();
  await expect(page.getByText('Ganá el Torneo Tanque para equiparlo y personalizarlo.')).toBeVisible();
  await expect(page.locator('[data-action="garage-save"]')).toBeDisabled();
  await expect(page.locator('[data-garage-color="primary"]')).toBeDisabled();
  await expect(page.locator('.garage-variants')).toHaveCount(0);
  await mkdir('assets/tanque/review/ui', { recursive: true });
  await page.screenshot({ path: `assets/tanque/review/ui/garage-locked-${viewport.width}.png` });
  await page.locator('[data-action="garage-cancel"]').click();
  await unlock(page, true); await open();
  await page.locator('[data-action="garage-vehicle"][data-value="tanque"]').click();
  await page.locator('[data-garage-color="primary"]').fill('#123abc'); await page.locator('[data-garage-color="accent"]').fill('#cd4567');
  await page.locator('[data-action="garage-slot"][data-value="helmet"]').click();
  await page.locator('[data-action="garage-variant"][data-value="trail"]').click();
  await page.locator('[data-action="garage-vehicle"][data-value="motoneta"]').click();
  await page.locator('[data-action="garage-vehicle"][data-value="tanque"]').click();
  await page.locator('[data-action="garage-slot"][data-value="fairing"]').click();
  await expect(page.locator('[data-garage-color="primary"]')).toHaveValue('#123abc');
  await expect(page.locator('[data-garage-color="accent"]')).toHaveValue('#cd4567');
  await page.screenshot({ path: `assets/tanque/review/ui/garage-unlocked-${viewport.width}.png` });
  await page.locator('[data-action="garage-cancel"]').click();
  expect(await page.evaluate(() => (window as any).__motoneta.profiles[0].garage.bikes.tanque.paints.fairing.primary)).toBe('#bfc6cf');
  await page.locator('[data-action="garage-open"]').click();
  await page.locator('[data-action="garage-vehicle"][data-value="tanque"]').click();
  await page.locator('[data-garage-color="primary"]').fill('#123abc'); await page.locator('[data-garage-color="accent"]').fill('#cd4567');
  await page.locator('[data-action="garage-slot"][data-value="helmet"]').click(); await page.locator('[data-action="garage-variant"][data-value="trail"]').click();
  await page.locator('[data-action="garage-save"]').click();
  await expect(page.locator('#garage-stage')).toHaveCount(0);
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden();
  const p = await page.evaluate(() => (window as any).__motoneta.profiles[0]);
  expect(p.garage.vehicle).toBe('tanque'); expect(p.appearance.parts.helmet).toBe('trail');
  for (const slot of ['fairing', 'fender', 'seat', 'exhaust', 'plate', 'wheels']) {
    expect(p.appearance.parts[slot]).toBe('core'); expect(p.appearance.paints[slot]).toEqual({ primary: '#123abc', accent: '#cd4567' });
  }
  await menu(page); await page.screenshot({ path: `assets/tanque/review/ui/tournament-${viewport.width}.png` });
  await page.locator('[data-action="start-tanque"]').click(); await page.locator('[data-action="begin-turn"]').click();
  await expect(page.locator('.race-identity')).toBeVisible();
  const race = await page.evaluate(() => (window as any).__motoneta);
  expect(race.vehicles.slice(0, 4)).toEqual(['tanque', 'motocross', 'motocross', 'motocross']);
  await page.screenshot({ path: `assets/tanque/review/ui/race-${viewport.width}.png` });
  await page.keyboard.press('Escape'); await page.locator('[data-action="leave-race"]').click(); await page.locator('[data-action="confirm-abandon"]').click();
  await expect(page.getByRole('heading', { name: 'Resultado', exact: true })).toBeVisible();
  await page.locator('[data-action="leave-race"]').click();
  await expect(page.locator('.session-page')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__motoneta.session.results.length)).toBe(1);
  await nav(page, 'home'); await open();
  await page.locator('[data-action="garage-reset-slot"]').click();
  await expect(page.locator('[data-garage-color="primary"]')).toHaveValue('#bfc6cf');
  await expect(page.locator('[data-garage-color="accent"]')).toHaveValue('#58616b');
  await page.locator('[data-action="garage-save"]').click(); await expect(page.locator('#garage-stage')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__motoneta.profiles[0].appearance.parts.helmet)).toBe('trail');
  await page.locator('[data-action="garage-open"]').click(); await page.locator('[data-action="garage-reset-all"]').click();
  await page.locator('[data-action="garage-save"]').click(); await expect(page.locator('#garage-stage')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__motoneta.profiles[0].appearance.parts.helmet)).toBe('core');
});

test('old format-3 save gains a locked Tanque without losing data; obsolete loop sessions are selectively removed', async ({ page }) => {
  await ready(page); const module = await runtimeModuleUrl(page, '/src/persistence.ts');
  const result = await page.evaluate(async (module) => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ GameStore }, { tanqueTournament }, { emptyDesign }] = await Promise.all([
      source(module), source('/src/core/tanque-tournament.ts'), source('/src/core/maps.ts'),
    ]);
    const store = new GameStore(); await store.open();
    await store.update((s: any) => { s.profiles[0].unlockedMotoneta = true; s.profiles[0].garage.bikes.motoneta.parts.fairing = 'trail'; s.maps = [{ ...emptyDesign(), name: 'Conservado' }]; s.draft.name = 'Borrador conservado'; });
    const legacy = structuredClone(store.state); delete legacy.tanqueSessions; delete legacy.profiles[0].unlockedTanque; delete legacy.profiles[0].garage.bikes.tanque;
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('motoneta-game', 5); req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result, tx = db.transaction('data', 'readwrite'); tx.objectStore('data').put(legacy, 'state'); tx.oncomplete = () => { db.close(); resolve(); }; };
    });
    const restored = new GameStore(); await restored.open(); const p = restored.state.profiles[0];
    const persisted = await new Promise<any>((resolve, reject) => {
      const req = indexedDB.open('motoneta-game', 5); req.onerror = () => reject(req.error);
      req.onsuccess = () => { const db = req.result, get = db.transaction('data').objectStore('data').get('state'); get.onsuccess = () => { db.close(); resolve(get.result); }; };
    });
    const migration = !p.unlockedTanque && !!p.garage.bikes.tanque && p.unlockedMotoneta && p.garage.bikes.motoneta.parts.fairing === 'trail' && restored.state.maps[0].name === 'Conservado' && restored.state.draft.name === 'Borrador conservado';
    await restored.update((s: any) => {
      s.tanqueSessions[p.id] = tanqueTournament(p, new Date('2026-10-04T12:00:00Z'));
      const course = s.tanqueSessions[p.id].courses.find((c: any) => c.loopGeometryVersion); course.loopGeometryVersion = 1;
    });
    const clean = new GameStore(); await clean.open();
    return { migration, persisted: !!persisted.tanqueSessions && persisted.profiles[0].unlockedTanque === false && !!persisted.profiles[0].garage.bikes.tanque, removed: !clean.state.tanqueSessions[p.id], progression: clean.state.profiles[0].unlockedMotoneta, version: clean.state.version, defaultColor: p.garage.bikes.tanque.paints.fairing.primary };
  }, module);
  expect(result).toEqual({ migration: true, persisted: true, removed: true, progression: true, version: 4, defaultColor: '#bfc6cf' });
});
