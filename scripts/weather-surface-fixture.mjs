/** Identical staged six-rider workload for both revisions; no gameplay changes. */
export async function surfaceFixture(page, base) {
  await page.route(base + '/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      },
      body: '<style>body{margin:0}canvas{display:block;width:100vw;height:100vh}</style><canvas></canvas>',
    }),
  );
  await page.goto(base);
  await page.evaluate(async () => {
    const source = (p) => import(/* @vite-ignore */ p);
    const [
      { World },
      { loadBikeAssets },
      { loadCrowdAssets },
      { defaultSettings, HZ },
      { createRace },
      { makeBots },
      { BUILTINS },
      { heightAt },
    ] = await Promise.all([
      source('/src/renderer.ts'),
      source('/src/bike-model.ts'),
      source('/src/crowd-assets.ts'),
      source('/src/core/types.ts'),
      source('/src/core/racing.ts'),
      source('/src/core/game.ts'),
      source('/src/core/maps.ts'),
      source('/src/core/tracks.ts'),
    ]);
    const world = new World(
      document.querySelector('canvas'),
      { ...structuredClone(defaultSettings), cameraShake: false },
      await loadBikeAssets(),
      await loadCrowdAssets(),
    );
    const race = createRace({
      ...BUILTINS[0],
      mode: 'quick',
      player: { id: 'one', name: 'Jugador', color: '#e05a3b' },
      bots: makeBots(5),
      difficulty: 'normal',
      seed: 19,
    });
    const f = (window.surfaceFixture = { world, race, HZ, heightAt, frame: 0 });
    f.reset = ({ quality, weather, timeOfDay, zoom = 1, surfaceDetail = 'detailed' }) => {
      world.settings.quality = quality;
      world.settings.surfaceDetail = surfaceDetail;
      world.applySettings();
      world.setTrack(race.track);
      world.mode = 'race';
      world.setTimeOfDay(timeOfDay);
      world.setWeather(weather);
      world.beginRace(race);
      world.camera.zoom = world.zoomTarget = zoom;
      world.last = 0;
      race.phase = 'racing';
      race.countdown = 0;
      race.frame = 0;
      race.elapsed = 0;
      race.events = [];
      f.frame = 0;
    };
    f.tick = (sequence = false) => {
      const i = f.frame++;
      world.capture(race);
      race.frame = i + 1;
      race.elapsed = i;
      race.events = [];
      race.riders.forEach((p, n) => {
        p.x = 850 + i * 2 + n * 10;
        p.lane = n % 4;
        p.speed = 3.25;
        p.previousA = true;
        p.turbo = n % 2 === 0;
        p.grounded = true;
        p.recovery = 0;
        p.height = heightAt(race.track, p.x, p.lane);
        p.tilt = 0;
        if (i % 60 === 30)
          race.events.push({
            type: 'land',
            rider: n,
            frame: race.frame,
            impactSpeed: 3.6,
            surface: 'dirt',
          });
        if (sequence && n === 0) {
          if (i >= 30 && i < 60) p.tilt = 0.38;
          if (i >= 60 && i < 100) {
            p.grounded = false;
            p.height += Math.sin(((i - 60) / 40) * Math.PI) * 42;
            p.tilt = 0.2 - (i - 60) * 0.008;
          }
          if (i === 60 || i === 100 || i === 160)
            race.events.push({
              type: i === 60 ? 'jump' : i === 100 ? 'land' : 'crash',
              rider: 0,
              frame: race.frame,
              impactSpeed: 4,
              surface: 'dirt',
              cause: 'impact',
            });
          if (i >= 160) {
            p.recovery = 50;
            p.speed = 0;
            p.tilt = -0.9;
          }
        }
      });
      world.onSimulationStep(race);
      world.render((i + 1) / HZ, race);
    };
    f.snapshot = () => {
      const model = world.vfx.model;
      const digest = (data) => {
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        let hash = 2166136261;
        for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
        return (hash >>> 0).toString(16);
      };
      const buffers = Object.fromEntries(
        [
          'origins',
          'velocities',
          'styles',
          'forces',
          'colors',
          'trackPositions',
          'trackBirth',
          'trackColors',
          'trackGroups',
        ].map((key) => [key, digest(model[key])]),
      );
      const gl = world.renderer.getContext(),
        ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        memory: { ...world.renderer.info.memory },
        draw: { ...world.renderer.info.render },
        vfx: world.vfx.diagnostics(),
        buffers,
        precipitation: world.weatherEffects.diagnostics(),
        timerResolution: crossOriginIsolated ? 'isolated' : 'reduced',
        device: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      };
    };
  });
}

export const surfaceCases = [false, true].flatMap((mobile) =>
  ['high', 'low'].flatMap((quality) =>
    ['morning', 'afternoon', 'night'].flatMap((timeOfDay) =>
      ['clear', 'rain', 'snow'].map((weather) => ({
        id: `${mobile ? 'mobile' : 'desktop'}-${quality}-${timeOfDay}-${weather}`,
        mobileEmulation: mobile,
        quality,
        timeOfDay,
        weather,
        viewport: mobile ? { width: 844, height: 390 } : { width: 1440, height: 900 },
      })),
    ),
  ),
);
