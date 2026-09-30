export const RATE = 24000;
export const tau = Math.PI * 2;
export function noise(seed = 1984) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2147483648 - 1;
  };
}
export function wave(seconds, sample) {
  return Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => sample(i / RATE, i));
}
export function lowpass(a, hz) {
  let y = 0;
  const k = 1 - Math.exp((-tau * hz) / RATE);
  return a.map((v) => (y += k * (v - y)));
}
export function normalize(a, peak = 0.7) {
  let max = 0;
  for (const v of a) max = Math.max(max, Math.abs(v));
  return a.map((v) => (v * peak) / (max || 1));
}
export function edges(a, seconds = 0.008) {
  const n = Math.min(Math.round(seconds * RATE), a.length / 2);
  return a.map((v, i) => v * Math.min(1, i / n, (a.length - 1 - i) / n));
}
// Overlap the tail with the beginning, returning one complete, continuous cycle.
export function loop(a, seconds = 0.12) {
  const n = Math.min(Math.round(seconds * RATE), Math.floor(a.length / 4));
  const out = a.slice(n);
  for (let i = 0; i < n; i++) {
    const f = i / n;
    out[out.length - n + i] = a[a.length - n + i] * (1 - f) + a[i] * f;
  }
  // Match the seam over four milliseconds instead of leaving a DC step at wrap.
  const seam = Math.min(96, out.length),
    delta = out[0] - out[out.length - 1];
  for (let i = 0; i < seam; i++) out[out.length - seam + i] += delta * (i / (seam - 1)) ** 2;
  return out;
}
export function mix(a, b, gain = 1, at = 0) {
  const out = a.slice();
  const offset = Math.round(at * RATE);
  for (let i = 0; i < b.length && i + offset < out.length; i++) out[i + offset] += b[i] * gain;
  return out;
}
export function impact(level, variation) {
  const random = noise(1200 + variation * 23 + level * 97);
  const duration = 0.16 + level * 0.065;
  const grit = lowpass(
    wave(duration, () => random()),
    1100,
  );
  return edges(
    wave(duration, (t, i) => {
      const body = Math.sin(tau * (78 + level * 5 + variation * 3) * t - 30 * t * t);
      return body * Math.exp(-t * (26 - level * 3)) + grit[i] * Math.exp(-t * 30) * 0.4;
    }),
    0.004,
  );
}
export function friction(variant) {
  const random = noise(9330 + variant * 43);
  const irregularity = lowpass(
    wave(0.85, () => random()),
    24,
  );
  const earth = lowpass(
    wave(0.85, () => random()),
    680,
  );
  return edges(
    wave(
      0.85,
      (t, i) =>
        earth[i] *
        (1 - Math.exp(-t * 22)) *
        Math.exp(-t * 4.5) *
        (0.6 + Math.abs(irregularity[i]) * 3),
    ),
    0.02,
  );
}
export function engine(hz, seed = 32) {
  const random = noise(seed);
  const rev = Math.max(0, Math.min(1, (hz - 32) / (88 - 32)));
  const rateScale = hz / 32;
  // All layers share the idle's firing clock, random sequence and loop phase.
  // Render the timbres on that common timeline, then resample to native RPM.
  // Runtime playback compensates their lengths so crossfades keep one rhythm.
  const seconds = 4.2;
  const hiss = lowpass(
    wave(seconds, () => random()),
    4200 / rateScale,
  );
  const hissBody = lowpass(hiss, 850 / rateScale);
  const jitter = 0.045;
  let phase = 0,
    cycleRate = 32,
    strength = 1,
    stroke = 0;
  const pulses = wave(seconds, (t, i) => {
    phase += cycleRate / RATE;
    if (phase >= 1) {
      phase -= 1;
      stroke++;
      cycleRate = 32 * (1 + random() * jitter + Math.sin(tau * 1.7 * t) * 0.008);
      strength = 1 + random() * 0.17 + (stroke % 2 ? -0.035 : 0.035);
    }
    const age = phase / (cycleRate * rateScale);
    const attack = 1 - Math.exp(-age * 7000);
    const envelope = attack * Math.exp(-age * (105 + rev * 10));
    const pressure = attack * Math.exp(-age * (240 + rev * 25));
    const body = Math.sin(tau * (180 + rev * 25) * age) * envelope;
    const bark = Math.sin(tau * (620 - rev * 80) * age) * envelope;
    const crack = Math.sin(tau * (1550 - rev * 250) * age) * attack * Math.exp(-age * 620);
    const grit = (hiss[i] - hissBody[i]) * envelope;
    return (
      strength *
      (pressure * 0.55 +
        body * (0.55 + rev * 0.12) +
        bark * (0.38 - rev * 0.14) +
        crack * (0.16 - rev * 0.1) +
        grit * (0.45 - rev * 0.13))
    );
  });
  // A short exhaust reflection and soft saturation give each firing a rough
  // edge. Remove the pulse train's DC/bass bias before and after saturation.
  const reflected = mix(pulses, pulses, -0.32, (0.0018 - rev * 0.00015) * rateScale);
  const bass = lowpass(reflected, 75 / rateScale);
  const driven = reflected.map((v, i) => Math.tanh((v - bass[i]) * (2.8 + rev * 0.1)));
  const softened = lowpass(driven, (2600 - rev * 400) / rateScale);
  const rumble = lowpass(softened, 65 / rateScale);
  const prepared = loop(
    softened.map((v, i) => v - rumble[i]),
    0.2,
  );
  const mean = prepared.reduce((sum, v) => sum + v, 0) / prepared.length;
  const centered = normalize(
    prepared.map((v) => v - mean),
    0.65,
  );
  // Prepare the seam before resampling, so every layer has the same loop phase.
  // This is byte-for-byte the existing idle preparation when rateScale is 1.
  const reference = normalize(loop(centered), 0.55);
  if (rateScale === 1) return reference;
  const length = Math.round(reference.length / rateScale);
  return normalize(
    Float32Array.from({ length }, (_, i) => {
      const position = (i * (reference.length - 1)) / (length - 1);
      const index = Math.floor(position),
        fraction = position - index;
      return (
        reference[index] * (1 - fraction) +
        reference[Math.min(index + 1, reference.length - 1)] * fraction
      );
    }),
    0.55,
  );
}
export function texture(hz, seed, pulses = false) {
  const random = noise(seed);
  const a = lowpass(
    wave(3.2, (t) => random() * (pulses ? 0.45 + 0.55 * Math.sin(t * 31) ** 2 : 1)),
    hz,
  );
  return normalize(loop(a), 0.5);
}
export function signal(notes, spacing = 0.105, duration = 0.15) {
  let a = new Float32Array(Math.ceil((notes.length * spacing + duration) * RATE));
  notes.forEach((hz, n) => {
    const note = wave(
      duration,
      (t) => (Math.sin(tau * hz * t) + 0.15 * Math.sin(tau * hz * 2 * t)) * Math.exp(-t * 19),
    );
    a = mix(a, edges(note), 0.45, n * spacing);
  });
  return edges(a);
}
export function wav(channels, rate = RATE) {
  const frames = channels[0].length,
    count = channels.length;
  const data = Buffer.alloc(44 + frames * count * 2);
  data.write('RIFF');
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(count, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * count * 2, 28);
  data.writeUInt16LE(count * 2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < count; c++)
      data.writeInt16LE(
        Math.round(Math.max(-1, Math.min(1, channels[c][i])) * 32767),
        44 + (i * count + c) * 2,
      );
  return data;
}
