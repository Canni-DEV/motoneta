import { expect, test, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { musicFixture, nav } from './ui-helpers';

test('crowd reactions fade into the same stadium bed, including interrupted playback', async ({
  page,
}) => {
  await requireAudio(page);
  const timedOfflinePlayback = await page.evaluate(() =>
    typeof OfflineAudioContext.prototype.suspend === 'function' &&
    typeof OfflineAudioContext.prototype.resume === 'function',
  );
  test.skip(!timedOfflinePlayback, 'This browser lacks OfflineAudioContext suspend/resume; timed offline interruptions require those APIs.');
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [{ AudioMixer }, { AmbienceAudio }, { defaultSettings }] = await Promise.all([
      load('/src/audio/mixer.ts'),
      load('/src/audio/ambience.ts'),
      load('/src/core/types.ts'),
    ]);
    const results = [];
    for (const stopAt of [null, 3, 1]) {
      const rate = 24000,
        ctx = new OfflineAudioContext(2, rate * 7, rate);
      const buffer = (seconds: number) => {
        const b = ctx.createBuffer(2, seconds * rate, rate);
        for (let channel = 0; channel < 2; channel++) b.getChannelData(channel).fill(1);
        return b;
      };
      // Constant recordings expose the envelopes themselves: a hard edit,
      // restart or loss of the ambient bed cannot hide behind sample variation.
      const bank = {
        buffers: new Map([
          ['crowd', buffer(1)],
          ['cheer-0', buffer(2.5)],
        ]),
      };
      const mixer = new AudioMixer(ctx, bank),
        ambience = new AmbienceAudio(mixer);
      mixer.apply({ ...defaultSettings, volume: 1 });
      ambience.update('race', 'clear', null);
      const crowd = [...mixer.voices][0];
      const cheer = mixer.play({ id: 'cheer-0', gain: 0.08, priority: 0, delay: 2 });
      let stopped = false,
        minimumBed = 1,
        continuousBed = true;
      const updates = [];
      for (let step = 1; step < 140; step++) {
        updates.push(
          ctx.suspend(step * 0.05).then(() => {
            if (stopAt !== null && !stopped && step * 0.05 >= stopAt) {
              cheer.stop();
              stopped = true;
            }
            ambience.update('race', 'clear', null);
            minimumBed = Math.min(minimumBed, mixer.crowdBedGain());
            continuousBed &&= mixer.voices.has(crowd);
            return ctx.resume();
          }),
        );
      }
      const rendered = await ctx.startRendering();
      await Promise.all(updates);
      const pcm = rendered.getChannelData(0);
      const average = (from: number, to: number) => {
        let sum = 0;
        for (let i = Math.floor(from * rate); i < Math.floor(to * rate); i++) sum += pcm[i];
        return sum / ((to - from) * rate);
      };
      results.push({
        stopAt,
        continuousBed,
        minimumBed,
        restoredBed: mixer.crowdBedGain(),
        voices: mixer.voices.size,
        base: average(6, 6.1),
        attack: average(2.02, 2.08),
        body: average(2.6, 2.8),
        afterStop: average(3.04, 3.1),
        tail: average(4.4, 4.48),
      });
      mixer.dispose();
    }
    return results;
  });
  writeFileSync(
    test.info().outputPath('crowd-levels.json'),
    JSON.stringify(results, null, 2) + '\n',
  );
  for (const result of results) {
    expect(result.continuousBed).toBe(true);
    expect(result.minimumBed).toBeGreaterThanOrEqual(0.82 - 1e-6);
    expect(result.restoredBed).toBe(1);
    expect(result.voices).toBe(1);
    expect(result.attack).toBeLessThan(result.base * 1.1);
    // The bed's existing 300 ms smoothing may still be settling during the tail.
    expect(result.tail).toBeGreaterThan(result.base * 0.95);
    expect(result.tail).toBeLessThan(result.base * 1.1);
  }
  expect(results[0].body).toBeGreaterThan(results[0].base * 2);
  expect(results[1].afterStop).toBeGreaterThan(results[1].base * 1.3);
  // Cancelling a delayed reaction must not play or duck the ambience later.
  expect(results[2].minimumBed).toBe(1);
  expect(results[2].body).toBeCloseTo(results[2].base, 4);
});

async function requireAudio(page: Page) {
  const supported = await page.evaluate(
    () => typeof AudioContext !== 'undefined' && typeof OfflineAudioContext !== 'undefined',
  );
  test.skip(
    !supported,
    'This Playwright WebKit build on Windows exposes no Web Audio APIs; playback requires a Safari-capable test host.',
  );
}

test('unavailable audio never prevents starting a race', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: undefined });
    localStorage.setItem('motoneta.settings.v3', JSON.stringify({ quality: 'low' }));
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await nav(page, 'quick');
  await page.locator('[data-action="start"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.race.phase)).toBe('racing');
  expect(await page.evaluate(() => (window as any).__motoneta.audio.ready)).toBe(false);
  expect(errors).toEqual([]);
});

test('pending previews cancel, hidden audio suspends, returning has no queued effects', async ({ page }) => {
  await requireAudio(page);
  await page.addInitScript(() => localStorage.setItem('motoneta.settings.v3', JSON.stringify({ quality: 'low' })));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/audio/engine-idle.wav', async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('#model-status')).toBeHidden();
  await page.getByRole('button', { name: 'Ajustes', exact: true }).click();
  await page.locator('[data-action="audio-preview"]').click();
  await page.locator('[data-action="audio-stop"]').click();
  release();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.ready)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.voices)).toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBeNull();
  expect(await page.evaluate(() => (window as any).__motoneta.audio.history.filter((event: any) =>
    !event.id.startsWith('ui-')))).toEqual([]);
  await page.locator('[data-action="audio-preview"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBe('menu');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.state)).toBe('suspended');
  expect(await page.evaluate(() => (window as any).__motoneta.audio.voices)).toBe(0);
  expect(await page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBeNull();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.locator('[data-action="audio-preview"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.state)).toBe('running');
  await expect.poll(() => page.evaluate(() => (window as any).__motoneta.audio.previewStage)).toBe('menu');
  expect(await page.evaluate(() => (window as any).__motoneta.audio.engineVoices)).toBe(0);
  await page.locator('[data-action="audio-stop"]').click();
});

test('music loads only the current scene, fades out for racing, handles missing files', async ({ page }) => {
  await requireAudio(page);
  const wav = readFileSync('public/audio/start.wav');
  const track = { file: 'fixture.wav', loopStart: 0, loopEnd: 0.3, gain: 0.12 };
  await page.route('**/audio/music.json', (route) => route.fulfill({
    json: { menu: track, editor: track, results: { ...track, file: 'missing.wav' } },
  }));
  await page.route('**/audio/fixture.wav', (route) => route.fulfill({ contentType: 'audio/wav', body: wav }));
  await page.route('**/audio/missing.wav', (route) => route.fulfill({ status: 404, body: '' }));
  const fetched: string[] = [];
  page.on('request', (request) => {
    if (/\/(?:fixture|missing)\.wav$/.test(request.url())) fetched.push(request.url().split('/').at(-1)!);
  });
  await musicFixture(page);
  await page.evaluate(() => (window as any).__musicFixture.setScene('menu'));
  expect(await page.evaluate(() => (window as any).__musicFixture.status)).toBe('playing');
  expect(fetched).toEqual(['fixture.wav']);
  await page.evaluate(() => (window as any).__musicFixture.setScene('editor'));
  await expect.poll(() => page.evaluate(() => (window as any).__musicFixture.voices)).toBe(1);
  await page.evaluate(() => (window as any).__musicFixture.setScene('race'));
  await expect.poll(() => page.evaluate(() => (window as any).__musicFixture.voices)).toBe(0);
  await page.evaluate(() => (window as any).__musicFixture.setScene('results'));
  expect(await page.evaluate(() => (window as any).__musicFixture.status)).toBe('unavailable');
  expect(fetched).toEqual(['fixture.wav', 'fixture.wav', 'missing.wav']);
});

test('offline rendering of six bikes, rain and simultaneous impacts stays bounded in stereo and mono', async ({
  page,
}, info) => {
  await requireAudio(page);
  await page.goto('/');
  const measured = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const [
      { AudioBank },
      { AudioMixer },
      { EngineAudio },
      { AmbienceAudio },
      { testRace },
      { getTrack },
      { defaultSettings },
    ] = await Promise.all([
      load('/src/audio/bank.ts'),
      load('/src/audio/mixer.ts'),
      load('/src/audio/engines.ts'),
      load('/src/audio/ambience.ts'),
      load('/tests/race-fixture.ts'),
      load('/src/core/tracks.ts'),
      load('/src/core/types.ts'),
    ]);
    const ctx = new OfflineAudioContext(2, 48000 * 3, 48000),
      bank = new AudioBank(ctx);
    await bank.load();
    const mixer = new AudioMixer(ctx, bank),
      engines = new EngineAudio(mixer),
      ambience = new AmbienceAudio(mixer);
    mixer.apply({ ...defaultSettings, volume: 1 });
    const race = testRace(getTrack(0), 0);
    race.phase = 'racing';
    race.countdown = 0;
    race.riders = Array.from({ length: 6 }, (_, id) => ({
      ...race.riders[0],
      id,
      speed: 3,
      previousA: true,
      x: 100 + id * 3,
    }));
    engines.update(race, 'rain');
    ambience.update('race', 'rain', race);
    for (let i = 0; i < 30; i++) mixer.play({ id: 'crash-0', gain: 0.32, priority: 1, delay: 0.1 });
    mixer.play({ id: 'finish', gain: 0.25, priority: 3, delay: 0.1 });
    const voices = mixer.voices.size,
      highPriorityKept = mixer.history.at(-1).id === 'finish';
    const rendered = await ctx.startRendering(),
      left = rendered.getChannelData(0),
      right = rendered.getChannelData(1);
    let peak = 0,
      monoPeak = 0,
      power = 0;
    for (let i = 0; i < left.length; i++) {
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      monoPeak = Math.max(monoPeak, Math.abs((left[i] + right[i]) / 2));
      power += (left[i] ** 2 + right[i] ** 2) / 2;
    }
    mixer.dispose();
    bank.dispose();
    return {
      voices,
      highPriorityKept,
      peak,
      monoPeak,
      rms: Math.sqrt(power / left.length),
      frames: left.length,
    };
  });
  expect(measured.voices).toBeLessThanOrEqual(48);
  expect(measured.highPriorityKept).toBe(true);
  expect(measured.peak).toBeLessThan(0.98);
  expect(measured.monoPeak).toBeLessThan(0.98);
  expect(measured.rms).toBeGreaterThan(0.005);
  writeFileSync(info.outputPath('motoneta-mix.json'), JSON.stringify(measured, null, 2) + '\n');
});
