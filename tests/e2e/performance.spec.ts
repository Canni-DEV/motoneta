import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
test('six riders and five ghosts in both qualities retain stable rendering resources', async ({
  page,
}, info) => {
  test.setTimeout(180000);
  await page.route('http://127.0.0.1:5173/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>',
    }),
  );
  await page.goto('/');
  const measurements = [];
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    const result = await page.evaluate(async () => {
      const source = (p: string) => import(/* @vite-ignore */ p);
      const [
        { World },
        { loadBikeAssets },
        { loadCrowdAssets },
        { defaultSettings },
        { createRace },
        { makeBots },
        { BUILTINS },
      ] = await Promise.all([
        source('/src/renderer.ts'),
        source('/src/bike-model.ts'),
        source('/src/crowd-assets.ts'),
        source('/src/core/types.ts'),
        source('/src/core/racing.ts'),
        source('/src/core/game.ts'),
        source('/src/core/maps.ts'),
      ]);
      const world =
        (window as any).benchmarkWorld ??
        new World(
          document.querySelector('canvas'),
          {
            ...defaultSettings,
            quality: 'low',
            vfx: { race: false, tracks: false, ambient: false, intensity: 'balanced' },
          },
          await loadBikeAssets(),
          await loadCrowdAssets(),
        );
      (window as any).benchmarkWorld = world;
      const r = createRace({
        ...BUILTINS[0],
        mode: 'quick',
        player: { id: 'one', name: 'Jugador', color: '#e05a3b' },
        bots: makeBots(5),
        difficulty: 'normal',
        seed: 1,
      });
      r.riders.forEach((p: any, i: number) => {
        p.x = 800 + i * 12;
        p.lane = i % 4;
        p.speed = 3;
      });
      world.setTrack(r.track);
      world.mode = 'race';
      let clock = 0;
      const render = () => {
        world.render((clock += 1 / 60), r, false);
        world.renderer.getContext().finish();
      };
      // Allocate all ghost material variants before checking repeated transitions.
      for (const ghost of [Infinity, 1]) {
        world.ghostStart = ghost;
        for (const q of ['low', 'high']) {
          world.settings.quality = q;
          world.applySettings();
          render();
        }
      }
      const values = [];
      for (const q of ['low', 'high'])
        for (const ghost of [false, true]) {
          world.settings.quality = q;
          world.applySettings();
          world.ghostStart = ghost ? 1 : Infinity;
          render();
          const times = [];
          for (let n = 0; n < 20; n++) {
            await new Promise(requestAnimationFrame);
            const start = performance.now();
            render();
            times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
          values.push({
            quality: q,
            scenario: ghost ? 'one-rider-five-ghosts' : 'six-riders',
            medianMs: times[10],
            p95Ms: times[18],
            drawCalls: world.renderer.info.render.calls,
          });
        }
      const allocations = [];
      for (let i = 0; i < 20; i++) {
        world.setTrack(structuredClone(r.track));
        world.ghostStart = i % 2 ? 1 : Infinity;
        render();
        allocations.push({ ...world.renderer.info.memory });
      }
      return {
        values,
        allocations,
        baseline: allocations[3],
        after: { ...world.renderer.info.memory },
        renderer: world.renderer.getContext().getParameter(world.renderer.getContext().RENDERER),
      };
    });
    expect(result.after).toEqual(result.baseline);
    for (const allocation of result.allocations.slice(4))
      expect(allocation).toEqual(result.baseline);
    measurements.push({ viewport, ...result });
  }
  await info.attach('performance.json', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  });
  await writeFile('test-results/new-modes-performance.json', JSON.stringify(measurements, null, 2));
});
