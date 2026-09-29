import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import tracks from '../public/audio/music.json';

describe('delivered Suno music', () => {
  for (const [scene, track] of Object.entries(tracks)) {
    it(`${scene} preserves the MP3 and has a bounded, continuous PCM loop`, () => {
      const source = readFileSync(`assets/audio/sources/${scene}.mp3`);
      expect(readFileSync(`assets/audio/music/${scene}.mp3`).equals(source)).toBe(true);
      const receipt = JSON.parse(readFileSync(`assets/audio/music/${scene}.json`, 'utf8'));
      expect(createHash('sha256').update(source).digest('hex')).toBe(receipt.sha256);
      const data = readFileSync(`public/audio/${track.file}`);
      expect(createHash('sha256').update(data).digest('hex')).toBe(receipt.derivedSha256);
      expect(receipt.derivedSha256.startsWith(track.revision)).toBe(true);
      const rate = data.readUInt32LE(24),
        channels = data.readUInt16LE(22),
        frames = (data.length - 44) / (channels * 2);
      expect(rate).toBe(44100);
      expect(channels).toBe(2);
      expect(track.loopEnd).toBeCloseTo(frames / rate, 6);
      expect(track.loopStart).toBeGreaterThan(0);
      expect(track.gain).toBeGreaterThan(0);
      expect(track.gain).toBeLessThanOrEqual(0.3);
      let peak = 0;
      for (let i = 44; i < data.length; i += 2)
        peak = Math.max(peak, Math.abs(data.readInt16LE(i)) / 32768);
      expect(peak).toBeLessThanOrEqual(0.751);
      const loopFrame = Math.round(track.loopStart * rate);
      for (let c = 0; c < channels; c++) {
        const sample = (frame: number) => data.readInt16LE(44 + (frame * channels + c) * 2) / 32768;
        expect(Math.abs(sample(loopFrame) - sample(frames - 1))).toBeLessThan(0.00004);
        let tail = 0,
          head = 0;
        for (let i = 0; i < rate / 4; i++) {
          tail += sample(frames - 1 - i) ** 2;
          head += sample(loopFrame + i) ** 2;
        }
        expect(Math.sqrt(tail / head)).toBeGreaterThan(0.3);
        expect(Math.sqrt(tail / head)).toBeLessThan(3);
      }
    });
  }
});
