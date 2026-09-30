import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  RATE,
  lowpass,
  normalize,
  edges,
  loop,
  mix,
  impact,
  friction,
  engine,
  texture,
  signal,
  wav,
} from './audio-dsp.mjs';

const out = 'public/audio',
  sources = 'assets/audio/sources';
await mkdir(out, { recursive: true });
const originals = new Map(),
  assets = [];
async function emitEngines() {
  for (const [id, hz] of [
    ['engine-idle', 32],
    ['engine-mid', 56],
    ['engine-high', 88],
  ])
    await emit(id, engine(hz), 'original', true, true);
}
// Rebuild only the motor while auditioning its timbre. No downloaded source
// recordings or browser are needed, and the rest of the sound bank is untouched.
if (process.argv.includes('--engines-only')) {
  await emitEngines();
  const path = 'assets/audio/manifest.json';
  try {
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    manifest.assets = manifest.assets.map(
      (asset) => assets.find((a) => a.id === asset.id) ?? asset,
    );
    await writeFile(path, JSON.stringify(manifest, null, 2) + '\n');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  console.log('Rebuilt engine-idle, engine-mid and engine-high (Motocross arcade).');
} else {
  await buildBank();
}
async function buildBank() {
  const { chromium } = await import('playwright');
  await mkdir(sources, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  async function decode(path, offset = 0, seconds = 1, cutoff = 3000, stereo = false, speed = 1) {
    const source = join(sources, basename(path));
    let bytes;
    try {
      bytes = await readFile(source);
    } catch {
      bytes = await readFile(path);
      await writeFile(source, bytes);
    }
    originals.set(basename(source), {
      file: basename(source),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const data = await page.evaluate(
      async ({ encoded, offset, seconds, cutoff, stereo, rate, speed }) => {
        const bytes = Uint8Array.from(atob(encoded), (x) => x.charCodeAt(0));
        const decoder = new OfflineAudioContext(1, 1, rate);
        const buffer = await decoder.decodeAudioData(bytes.buffer);
        seconds = Math.min(seconds, (buffer.duration - offset) / speed);
        if (seconds <= 0) throw new Error('Source shorter than requested excerpt');
        const ctx = new OfflineAudioContext(stereo ? 2 : 1, Math.ceil(seconds * rate), rate);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = speed;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = cutoff;
        src.connect(filter);
        filter.connect(ctx.destination);
        src.start(0, offset, seconds * speed);
        const result = await ctx.startRendering();
        return Array.from({ length: result.numberOfChannels }, (_, c) =>
          Array.from(result.getChannelData(c)),
        );
      },
      { encoded: bytes.toString('base64'), offset, seconds, cutoff, stereo, rate: RATE, speed },
    );
    return data.map((x) => Float32Array.from(x));
  }
  try {
    const generic = (
      await decode('tmp/audio-downloads/impact/Audio/impactGeneric_light_000.ogg', 0, 0.4, 1600)
    )[0];
    const metal = (
      await decode('tmp/audio-downloads/impact/Audio/impactMetal_light_001.ogg', 0, 0.5, 1300)
    )[0];
    const grass = (
      await decode('tmp/audio-downloads/impact/Audio/footstep_grass_000.ogg', 0, 0.4, 1800)
    )[0];
    const snow = (
      await decode('tmp/audio-downloads/impact/Audio/footstep_snow_000.ogg', 0, 0.4, 1800)
    )[0];
    for (let level = 0; level < 3; level++)
      for (let v = 0; v < 3; v++)
        await emit(
          `land-${level}-${v}`,
          mix(impact(level, v), generic, 0.22),
          'original + Kenney Impact Sounds',
        );
    for (let v = 0; v < 3; v++) {
      // Soft material recordings supply irregular physical contact, without the
      // pitched drum body or bright noise transient of the first candidate.
      const body = (
        await decode(
          `tmp/audio-downloads/impact/Audio/impactSoft_heavy_00${v}.ogg`,
          0,
          0.7,
          850,
          false,
          0.8,
        )
      )[0];
      const rebound = (
        await decode(
          `tmp/audio-downloads/impact/Audio/impactSoft_medium_00${v}.ogg`,
          0,
          0.35,
          950,
          false,
          0.88,
        )
      )[0];
      let a = mix(new Float32Array(RATE * 0.9), normalize(body, 0.8));
      a = mix(a, normalize(rebound, 0.8), 0.27, 0.14 + v * 0.021);
      a = mix(a, lowpass(metal, 620), 0.07, 0.25 + v * 0.027);
      a = mix(a, normalize(friction(v), 0.3), 0.3, 0.08);
      await emit(`crash-${v}`, a, 'Kenney Impact Sounds + original friction');
    }
    for (let v = 0; v < 2; v++) {
      await emit(`scrape-${v}`, friction(v), 'original');
    }
    await emitEngines();
    for (const [id, hz, seed] of [
      ['dirt', 1800, 10],
      ['mud', 550, 20],
      ['grass', 1200, 30],
      ['wet', 1900, 40],
      ['snow', 950, 50],
    ]) {
      let a = texture(hz, seed, true);
      if (id === 'grass' || id === 'snow')
        for (let i = 0; i < 6; i++) a = mix(a, id === 'grass' ? grass : snow, 0.2, i * 0.47);
      await emit(
        `roll-${id}`,
        a,
        id === 'grass' || id === 'snow' ? 'original + Kenney Impact Sounds' : 'original',
        true,
      );
      await emit(
        `touch-${id}`,
        a.slice(0, RATE * 0.15).map((x, i) => x * Math.exp((-i / RATE) * 25)),
        id === 'grass' || id === 'snow' ? 'original + Kenney Impact Sounds' : 'original',
      );
    }
    await emit('bump', mix(impact(0, 0), metal, 0.07), 'original + Kenney Impact Sounds');
    await emit('jump', lowpass(impact(0, 2), 700), 'original');
    await emit('wind', texture(600, 839), 'original', true);
    await emit('air', texture(1000, 421), 'original', true);
    const ui = {
      select: 'tick_001',
      confirm: 'select_001',
      back: 'back_001',
      error: 'error_001',
      open: 'open_001',
      close: 'close_001',
      place: 'click_001',
      move: 'tick_002',
      remove: 'drop_001',
      duplicate: 'select_002',
      undo: 'switch_001',
      redo: 'switch_002',
      saved: 'confirmation_001',
      imported: 'confirmation_002',
    };
    for (const [id, name] of Object.entries(ui)) {
      // Exact upstream filenames are retained for reproducible editing and attribution.
      const path = `tmp/audio-downloads/interface/Audio/${name}.ogg`;
      await emit(`ui-${id}`, await decode(path, 0, 0.6, 2400), 'Kenney Interface Sounds');
    }
    const cues = {
      countdown: [392],
      start: [392, 587],
      overheat: [220, 196],
      cool: [440, 587],
      recovered: [330, 440],
      recovery: [294, 392],
      turbo: [196, 294],
      lap: [392, 494],
      'last-lap': [392, 494, 587],
      finish: [392, 494, 587, 784],
      dnf: [294, 247],
      record: [587, 784, 988],
      victory: [392, 494, 587, 784, 988],
      podium: [392, 587, 784, 988],
    };
    for (const [id, notes] of Object.entries(cues)) await emit(id, signal(notes), 'original');
    const crowdDir = 'tmp/audio-downloads/crowd/Gregor Quendel - Free Crowd Cheering Sounds - MP3';
    for (const [id, number, seconds] of [
      ['crowd', '10', 12],
      ['cheer-0', '05', 2.5],
      ['cheer-1', '06', 2.8],
      ['cheer-2', '04', 3.5],
    ]) {
      let name;
      const existing = await readdir(sources);
      name = existing.find((f) => f.includes(` - ${number} - `));
      if (!name) name = (await readdir(crowdDir)).find((f) => f.includes(` - ${number} - `));
      await emit(
        id,
        await decode(join(crowdDir, name), 0, seconds, 2200, true),
        'Gregor Quendel CC-BY-4.0',
        id === 'crowd',
      );
    }
    await emit(
      'rain',
      await decode('tmp/audio-downloads/rain.mp3', 8, 10, 2900, true),
      'Kresiek The Furry CC0',
      true,
    );
    await writeFile(
      'assets/audio/manifest.json',
      JSON.stringify(
        {
          version: 1,
          status: 'audition-pending',
          sampleRate: RATE,
          originals: [...originals.values()],
          assets,
        },
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      `${out}/bank.json`,
      JSON.stringify(
        assets.map(({ id, file, loop }) => ({ id, file, loop })),
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      'src/audio/generated-bank.json',
      JSON.stringify(
        assets.map(({ id, file, loop }) => ({ id, file, loop })),
        null,
        2,
      ) + '\n',
    );
    console.log(
      `${assets.length} sounds, ${(assets.reduce((s, a) => s + a.bytes, 0) / 1048576).toFixed(2)} MiB`,
    );
  } finally {
    await browser.close();
  }
}
async function emit(id, input, provenance, looping = false, alreadyPrepared = false) {
  const channels = input instanceof Float32Array ? [input] : input;
  const prepared = channels.map((a) =>
    alreadyPrepared ? a : looping ? normalize(loop(a), 0.55) : edges(normalize(a, 0.65)),
  );
  const bytes = wav(prepared);
  await writeFile(`${out}/${id}.wav`, bytes);
  assets.push({
    id,
    file: `${id}.wav`,
    source: provenance,
    loop: looping,
    duration: prepared[0].length / RATE,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}
