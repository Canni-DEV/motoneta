import { expect, test } from '@playwright/test';
import { nav, ready } from './ui-helpers';

test('populated records, results, podium and touch HUD fit desktop and compact windows', async ({
  browser,
}, info) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await ready(page);
  await page.evaluate(async () => {
    const source = (path: string) => import(/* @vite-ignore */ path);
    const [
      { GameStore },
      { emptyDesign, mapCourse },
      { createRace, stepRace, raceResult },
      { newRecording, appendInput },
      { makeBots },
    ] = await Promise.all([
      source('/src/persistence.ts'),
      source('/src/core/maps.ts'),
      source('/src/core/racing.ts'),
      source('/src/core/recording.ts'),
      source('/src/core/game.ts'),
    ]);
    const store = new GameStore();
    await store.open();
    const d = {
      ...emptyDesign(),
      length: 640,
      laps: 1,
      name: 'Circuito de prueba para marcas y finales',
    };
    const course = mapCourse(d);
    const config = {
      ...course,
      mode: 'quick',
      player: store.state.profiles[0],
      bots: makeBots(5),
      difficulty: 'normal',
      seed: 1,
    };
    const race = createRace(config),
      replay = newRecording(config);
    for (let i = 0; i < 10000 && race.phase !== 'finished'; i++) {
      appendInput(replay, 1);
      stepRace(race, 1);
    }
    replay.result = raceResult(race);
    await store.commit(replay);
    await store.update((s: any) => {
      s.sessions.tournament = {
        id: 'visual-fixture',
        mode: 'tournament',
        players: [config.player],
        bots: config.bots,
        difficulty: 'normal',
        courses: [0, 1, 2].map((i) => ({ ...course, ref: { ...course.ref, id: `fixture-${i}` } })),
        courseIndex: 2,
        turnIndex: 0,
        phase: 'results',
        seed: 1,
        results: [0, 1, 2].map((i) => ({
          course: i,
          player: config.player.id,
          result: replay.result,
          replayId: s.records[0].replayId,
        })),
      };
    });
  });
  await page.reload();
  await expect(page.locator('#model-status')).toBeHidden();
  for (const [width, height] of [
    [1440, 900],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    await nav(page, 'records');
    await expect(page.locator('.record-row')).toHaveCount(1);
    await expect(page.locator('[data-action="record-watch"]')).toBeInViewport();
    await expect(page.locator('[data-action="record-race"]')).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`records-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator('[data-action="record-watch"]').click();
  await expect(page.locator('.race-ui')).toBeVisible();
  await page.screenshot({ path: info.outputPath('race-hud-1440.png') });
  await page.setViewportSize({ width: 640, height: 360 });
  await page.screenshot({ path: info.outputPath('race-hud-640.png') });
  for (const id of ['race-time', 'lap', 'position', 'speed', 'heat-label'])
    await expect(page.locator(`#${id}`)).toBeInViewport();
  await expect(
    page.getByRole('heading', { name: 'Repetición finalizada', exact: true }),
  ).toBeVisible({ timeout: 45000 });
  for (const [width, height] of [
    [1440, 900],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`results-${width}.png`) });
    await expect(page.locator('[data-action="leave-race"]')).toBeInViewport();
  }
  await page.locator('[data-action="leave-race"]').click();
  await nav(page, 'home');
  await page.locator('[data-action="resume-session"]').click();
  await page.locator('[data-action="advance"]').click();
  await expect(page.getByRole('heading', { name: 'Podio', exact: true })).toBeVisible();
  for (const [width, height] of [
    [1440, 900],
    [640, 360],
  ]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: info.outputPath(`podium-${width}.png`) });
    expect(
      await page.evaluate(() => [
        document.documentElement.scrollWidth,
        document.documentElement.scrollHeight,
      ]),
    ).toEqual([width, height]);
  }
  await context.close();
});
