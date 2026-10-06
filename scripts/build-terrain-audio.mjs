import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Original synthesis. Circular filtering and periodic envelopes make seamless loops.
const rate = 44100, count = rate * 2;
const manifest = [];
function wav(data) {
  const buffer = Buffer.alloc(44 + data.length * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(data.length * 2, 40);
  data.forEach((v,i) => buffer.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v)) * 32767),44 + i * 2));
  return buffer;
}
const bank = JSON.parse(await readFile('src/audio/generated-bank.json', 'utf8'));
for (const material of ['sand', 'gravel']) {
  let seed = material === 'sand' ? 4127 : 9281;
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
  const raw = Float32Array.from({ length: count }, random), data = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const smooth = (raw[i] + raw[(i + count - 1) % count] + raw[(i + count - 2) % count]) / 3;
    const t = i / rate;
    const texture = material === 'sand' ? smooth * 0.24 :
      (raw[i] - smooth * 0.4) * (0.08 + 0.15 * Math.max(0, Math.sin(t * Math.PI * 36)) ** 12);
    data[i] = texture * (0.85 + Math.sin(t * Math.PI * 4) * 0.15);
  }
  // Both ends fade through zero over 3 ms, avoiding a random-noise seam click.
  for (let i = 0; i < 132; i++) { data[i] *= i / 132; data[count-1-i] *= i / 132; }
  for (const kind of ['roll','touch']) {
    const id = kind + '-' + material, sound = kind === 'roll' ? data :
      data.slice(0,Math.round(rate * 0.18)).map((v,i) => v * Math.exp(-i / rate * 22));
    const buffer = wav(sound), file = id + '.wav';
    await writeFile('public/audio/' + file,buffer);
    manifest.push({ id, file, provenance: 'Original procedural synthesis', sampleRate: rate, channels: 1,
      loop: kind === 'roll', sha256: createHash('sha256').update(buffer).digest('hex') });
    const existing = bank.findIndex((item) => item.id === id);
    const entry = { id, file, loop: kind === 'roll' };
    if (existing < 0) bank.push(entry); else bank[existing] = entry;
  }
}
await writeFile('src/audio/generated-bank.json', JSON.stringify(bank,null,2) + '\n');
await writeFile('src/audio/terrain-manifest.json', JSON.stringify(manifest,null,2) + '\n');
console.log('Generated original sand/gravel rolling and contact sounds.');
