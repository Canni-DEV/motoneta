import { expect, test, type Page } from '@playwright/test';
import { nav, ready, runtimeModuleUrl } from './ui-helpers';

const state = (page: Page) => page.evaluate(() => (window as any).__motoneta);
async function replay(page: Page) {
  await ready(page);
  await page.evaluate(async () => {
    const source = (p: string) => import(/* @vite-ignore */ p);
    const [{ testRace, testTrack }, { newRecording, appendInput }, { stepRace, isFinished, raceResult }, { GameStore }] = await Promise.all([
      source('/tests/race-fixture.ts'), source('/src/core/recording.ts'), source('/src/core/racing.ts'), source('/src/persistence.ts'),
    ]);
    const store = new GameStore(); await store.open();
    const race = testRace(testTrack({ length: 6144, laps: 2 }));
    race.config.player = { ...race.config.player, id: store.state.profiles[0].id };
    const recording = newRecording(race.config);
    while (!isFinished(race, 0)) { appendInput(recording, 1); stepRace(race, 1); }
    recording.result = raceResult(race); await store.commit(recording);
  });
  await page.reload(); await expect(page.locator('#model-status')).toBeHidden();
  const module = await runtimeModuleUrl(page, '/src/renderer.ts');
  const audioModule = await runtimeModuleUrl(page, '/src/audio.ts');
  await page.evaluate(async ({ module, audioModule }) => {
    const { World } = await import(/* @vite-ignore */ module);
    const { GameAudio } = await import(/* @vite-ignore */ audioModule);
    const render = World.prototype.render;
    const setSlowMotion = GameAudio.prototype.setSlowMotion;
    GameAudio.prototype.setSlowMotion = function (slow: boolean) {
      (window as any).cameraSlowMotion = slow;
      return setSlowMotion.call(this, slow);
    };
    World.prototype.render = function (...args: any[]) {
      (window as any).cameraWorld = this;
      return render.apply(this, args);
    };
  }, { module, audioModule });
  await nav(page, 'records');
  await page.locator('[data-action="record-watch"]').first().click();
}
async function press(page: Page, key: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press(key);
}

test('manual views, digits/numpad, C memory, pause, normal zoom and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await replay(page);
  await expect(page.locator('#cinematic-view')).toBeHidden();
  await press(page, '2'); expect((await state(page)).cinematic).toBeNull();
  await press(page, 'c'); await expect(page.locator('#cinematic-view')).toHaveValue('mix');
  await expect.poll(async () => (await state(page)).audio.music).toBe('playing');
  expect((await state(page)).audio.scene).toBe('cinematic');
  await expect.poll(async () => (await state(page)).cinematic?.droneLimit).toBeGreaterThan(0);
  await page.evaluate(() => {
    const timeline = (window as any).cameraWorld.cinematic.timeline;
    timeline.slowMotion.splice(0, timeline.slowMotion.length, { lap: 0, start: 0, end: timeline.lastFrame });
  });
  await press(page, '2'); await expect.poll(async () => (await state(page)).cinematic?.shot).toBe('firstPerson');
  await expect.poll(() => page.evaluate(() => (window as any).cameraSlowMotion)).toBe(true);
  const beforeZoom = (await state(page)).camera;
  await page.mouse.wheel(0, -120); expect((await state(page)).camera).toEqual(beforeZoom);
  expect(await page.evaluate(() => {
    const world = (window as any).cameraWorld, bike = world.bikes[0];
    return { eyes: world.cinematic.camera.position.distanceTo(bike.getRiderViewPose({ position: world.riderView.position, quaternion: world.riderView.quaternion }).position),
      helmet: bike.rider.getObjectByName('Slot_helmet_core').visible, gloves: bike.rider.getObjectByName('Slot_gloves_core').visible };
  })).toEqual({ eyes: 0, helmet: false, gloves: true });
  await press(page, 'c'); await expect(page.locator('#cinematic-view')).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as any).cameraWorld.bikes[0].rider.getObjectByName('Slot_helmet_core').visible)).toBe(true);
  await press(page, 'c'); await expect(page.locator('#cinematic-view')).toHaveValue('firstPerson');
  const modes = ['chase', 'front', 'ground', 'drone', 'mounted', 'tripod', 'crowd'];
  for (let i = 0; i < modes.length; i++) {
    await press(page, i % 2 ? `Numpad${i + 3}` : String(i + 3));
    await expect.poll(async () => (await state(page)).cinematic?.shot).toBe(modes[i]);
    expect((await state(page)).audio.scene).toBe('cinematic');
    expect(await page.evaluate(() => (window as any).cameraSlowMotion)).toBe(true);
  }
  await press(page, '1'); await expect(page.locator('#cinematic-view')).toHaveValue('mix');
  await page.locator('#cinematic-view').selectOption('firstPerson');
  await press(page, 'Control+3'); expect((await state(page)).cinematic.mode).toBe('firstPerson');
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit3', repeat: true, bubbles: true, cancelable: true })));
  expect((await state(page)).cinematic.mode).toBe('firstPerson');
  await page.evaluate(() => {
    (window as any).cameraWorld.settings.bindings.START = 'Digit3';
    const field = document.createElement('div'); field.id = 'editable-test'; field.contentEditable = 'plaintext-only';
    document.body.append(field); field.focus();
  });
  await page.keyboard.press('3');
  expect((await state(page)).cinematic.mode).toBe('firstPerson');
  expect((await state(page)).paused).toBe(false);
  await page.locator('#editable-test').evaluate(el => el.remove());
  // Restore the normal pause binding before checking digits in a dialog.
  // A user-assigned START key deliberately retains its resume behavior there.
  await page.evaluate(() => (window as any).cameraWorld.settings.bindings.START = 'Enter');
  await press(page, 'Escape'); await expect(page.locator('#modal')).toBeVisible();
  await page.keyboard.press('3');
  expect((await state(page)).cinematic.mode).toBe('firstPerson');
  await page.locator('[data-action="resume"]').click();
  await page.locator('#cinematic-view').selectOption('chase');
  // A consumed camera digit must not also trigger the user-assigned pause key.
  await page.evaluate(() => (window as any).cameraWorld.settings.bindings.START = 'Digit3');
  await press(page, '3'); expect((await state(page)).paused).toBe(false);
  await press(page, 'Escape'); await page.locator('[data-action="retry"]').click();
  expect((await state(page)).cinematic).toBeNull();
  await press(page, 'c'); await expect(page.locator('#cinematic-view')).toHaveValue('mix');
  expect(errors).toEqual([]);
});

test.describe('touch controls', () => {
  test.use({ hasTouch: true });
  test('touch selector survives delayed analysis; analysis failures restore normal view', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/src/cinematic.worker.ts*', async route => { await gate; await route.continue(); });
    await replay(page);
    await page.locator('[data-action="toggle-cinematic"]').tap();
    await page.locator('#cinematic-view').tap();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('#cinematic-view')).toHaveValue('firstPerson');
    await expect.poll(async () => (await state(page)).cinematic?.shot).toBe('firstPerson');
    release();
    await expect.poll(async () => (await state(page)).cinematic?.droneLimit).toBeGreaterThan(0);
    expect((await state(page)).cinematic.mode).toBe('firstPerson');
    await page.screenshot({ path: 'test-results/cinematic-selector-mobile.png' });
    await press(page, 'Escape');
    await page.unroute('**/src/cinematic.worker.ts*');
    await page.route('**/src/cinematic.worker.ts*', route => route.abort());
    await page.locator('[data-action="retry"]').click();
    await press(page, 'c');
    await expect.poll(async () => (await state(page)).cinematic).toBeNull();
    await expect(page.locator('#cinematic-view')).toBeHidden();
    await expect(page.locator('#toast')).toContainText('preparar');
  });
});

test('idle playback shares the new mix and ignores manual shortcuts', async ({ page }) => {
  await replay(page);
  await press(page, 'Escape'); await page.locator('[data-action="leave-race"]').click();
  await nav(page, 'home');
  await page.clock.install();
  await page.mouse.click(10, 100);
  await page.clock.fastForward(61_000);
  await expect.poll(async () => (await state(page)).cinematic?.mode).toBe('mix');
  await expect(page.locator('.attract-hint')).toBeVisible();
  await page.keyboard.press('2'); expect((await state(page)).cinematic.mode).toBe('mix');
  await expect(page.locator('#cinematic-view')).toHaveCount(0);
  await page.clock.resume();
  // Advance the director with its existing replay state; no race inputs are changed.
  expect(await page.evaluate(() => {
    const world = (window as any).cameraWorld, race = (window as any).__motoneta.race;
    const camera = world.cinematic;
    race.phase = 'racing'; race.countdown = 0;
    for (let i = 0; i < 2000; i++) {
      race.frame++;
      camera.update(race, { x: world.focus, y: 0, z: 0 }, 0.05, 2, false, 0, world.riderView);
    }
    return camera.cuts.some((cut: any) => cut.shot === 'firstPerson');
  })).toBe(true);
  await page.keyboard.press('Escape'); await expect(page.locator('.home-modes')).toBeVisible();
});
