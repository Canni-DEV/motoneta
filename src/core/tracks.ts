import raw from './track-layouts.json';
import type { PieceId, Segment, Surface, Track } from './types';

export interface Piece {
  id: PieceId;
  name: string;
  length: number;
  profile: [number, number][];
  lanes: number;
  surface: Surface;
  boost?: boolean;
}
const tri = (h: number): [number, number][] => [
  [0, 0],
  [0.5, h],
  [1, 0],
];
export const PIECES: Piece[] = [
  { id: 'A', name: 'Salto corto', length: 24, profile: tri(8), lanes: 15, surface: 'dirt' },
  { id: 'B', name: 'Salto medio', length: 40, profile: tri(16), lanes: 15, surface: 'dirt' },
  { id: 'C', name: 'Salto alto', length: 72, profile: tri(32), lanes: 15, surface: 'dirt' },
  { id: 'D', name: 'Loma ancha', length: 72, profile: tri(16), lanes: 15, surface: 'dirt' },
  {
    id: 'E',
    name: 'Salto vertical',
    length: 40,
    profile: [
      [0, 0],
      [0.4, 32],
      [0.6, 32],
      [1, 0],
    ],
    lanes: 15,
    surface: 'dirt',
  },
  {
    id: 'F',
    name: 'Rampa larga',
    length: 48,
    profile: [
      [0, 0],
      [0.75, 32],
      [1, 0],
    ],
    lanes: 15,
    surface: 'dirt',
  },
  {
    id: 'G',
    name: 'Rampa inversa',
    length: 48,
    profile: [
      [0, 0],
      [0.25, 32],
      [1, 0],
    ],
    lanes: 15,
    surface: 'dirt',
  },
  {
    id: 'H',
    name: 'Superrampa',
    length: 16,
    profile: [
      [0, 0],
      [1, 16],
    ],
    lanes: 3,
    surface: 'dirt',
    boost: true,
  },
  { id: 'I', name: 'Resalto superior', length: 8, profile: tri(3), lanes: 3, surface: 'bump' },
  { id: 'J', name: 'Resalto inferior', length: 8, profile: tri(3), lanes: 12, surface: 'bump' },
  {
    id: 'K',
    name: 'Barro · 1 y 3',
    length: 24,
    profile: [
      [0, 0],
      [1, 0],
    ],
    lanes: 5,
    surface: 'mud',
  },
  {
    id: 'L',
    name: 'Barro · 2 y 4',
    length: 24,
    profile: [
      [0, 0],
      [1, 0],
    ],
    lanes: 10,
    surface: 'mud',
  },
  {
    id: 'M',
    name: 'Enfriamiento · arriba',
    length: 16,
    profile: [
      [0, 0],
      [1, 0],
    ],
    lanes: 1,
    surface: 'cool',
  },
  {
    id: 'N',
    name: 'Enfriamiento · abajo',
    length: 16,
    profile: [
      [0, 0],
      [1, 0],
    ],
    lanes: 4,
    surface: 'cool',
  },
  {
    id: 'O',
    name: 'Corte inferior',
    length: 152,
    profile: [
      [0, 0],
      [1, 0],
    ],
    lanes: 12,
    surface: 'grass',
  },
  {
    id: 'P',
    name: 'Corte superior',
    length: 152,
    profile: [
      [0, 0],
      [1, 0],
    ],
    lanes: 3,
    surface: 'grass',
  },
  {
    id: 'Q',
    name: 'Corte completo',
    length: 96,
    profile: [
      [0, 0],
      [1, 0],
    ],
    lanes: 15,
    surface: 'grass',
  },
  {
    id: 'R',
    name: 'Doble meseta',
    length: 208,
    profile: [
      [0, 0],
      [0.08, 16],
      [0.31, 16],
      [0.39, 48],
      [0.7, 48],
      [0.92, 8],
      [1, 0],
    ],
    lanes: 15,
    surface: 'dirt',
  },
  {
    id: 'S',
    name: 'Pasarela',
    length: 224,
    profile: [
      [0, 0],
      [0.14, 48],
      [0.93, 48],
      [1, 0],
    ],
    lanes: 3,
    surface: 'dirt',
  },
];
export const pieceById = (id: PieceId) => PIECES.find((p) => p.id === id)!;
const codeLetters: Record<number, PieceId> = {
  1: 'D',
  2: 'I',
  3: 'I',
  4: 'J',
  5: 'C',
  6: 'F',
  7: 'B',
  8: 'A',
  10: 'G',
  11: 'E',
  12: 'K',
  13: 'L',
  14: 'H',
  15: 'M',
  16: 'N',
};
export function makeSegment(id: PieceId, x: number): Segment {
  const p = pieceById(id);
  return {
    x,
    length: p.length,
    profile: p.profile.map((v) => [...v]),
    lanes: p.lanes,
    surface: p.surface,
    boost: !!p.boost,
    piece: id,
  };
}
function fromCode(code: number, x: number, length: number): Segment {
  if (codeLetters[code]) return { ...makeSegment(codeLetters[code], x), length };
  const flat: Segment = {
    x,
    length,
    profile: [
      [0, 0],
      [1, 0],
    ],
    lanes: 15,
    surface: 'dirt',
    boost: false,
    piece: 'flat',
  };
  if (code === 9)
    return {
      ...flat,
      piece: 'finish',
      profile: [
        [0, 0],
        [0.2, 24],
        [0.8, 24],
        [1, 0],
      ],
    };
  if ([17, 18, 19, 22, 23, 24, 25, 26, 27].includes(code))
    return {
      ...flat,
      surface: 'grass',
      piece: 'gap',
      lanes:
        code === 18 || code === 24 || code === 25
          ? 12
          : code === 19 || code === 26 || code === 27
            ? 3
            : 15,
    };
  const profiles: Record<number, [number, number][]> = {
    20: [
      [0, 0],
      [0.375, 48],
      [1, 48],
    ],
    21: [
      [0, 0],
      [1, 16],
    ],
    28: [
      [0, 48],
      [1, 48],
    ],
    29: [
      [0, 48],
      [0.5, 32],
      [1, 48],
    ],
    30: [
      [0, 48],
      [0.5, 32],
      [1, 48],
    ],
    31: [
      [0, 48],
      [1, 48],
    ],
    32: [
      [0, 16],
      [1, 16],
    ],
    33: [
      [0, 16],
      [1, 48],
    ],
    34: [
      [0, 48],
      [1, 48],
    ],
    35: [
      [0, 48],
      [0.3, 48],
      [0.8, 8],
      [1, 0],
    ],
  };
  return {
    ...flat,
    profile: profiles[code] ?? flat.profile,
    piece: code >= 20 ? 'R' : 'flat',
    lanes: [20, 28, 29, 30, 31].includes(code) ? 3 : 15,
  };
}
const names = ['PRIMERA MARCHA', 'DOBLE O NADA', 'TIERRA BRAVA', 'AL LÍMITE', 'ÚLTIMA VUELTA'];
const subtitles = [
  'El comienzo de una buena rivalidad.',
  'Mesetas, saltos y decisiones rápidas.',
  'Encontrá tu línea entre los obstáculos.',
  'Técnica y velocidad, sin concesiones.',
  'El circuito que nunca se termina.',
];
const colors = ['#e6ae55', '#c8c998', '#a0b7ad', '#d18f77', '#c2afcc'];
export function getTrack(n: number): Track {
  const source = raw.tracks[n];
  let x = 0;
  const segments: Segment[] = [];
  for (const s of source.segments) {
    segments.push(fromCode(s.code, x, s.length));
    x += s.length;
  }
  return {
    id: `nes-${n + 1}-main`,
    number: n + 1,
    name: names[n],
    subtitle: subtitles[n],
    color: colors[n],
    length: x,
    segments,
    laps: 2,
  };
}
const laneIndices = new WeakMap<Track, Segment[][]>();
export function segmentAt(track: Track, x: number, lane: number): Segment | undefined {
  let index = laneIndices.get(track);
  if (!index) {
    index = Array.from({ length: 4 }, (_, n) =>
      track.segments.filter((s) => s.lanes & (1 << n)).sort((a, b) => a.x - b.x),
    );
    laneIndices.set(track, index);
  }
  const segments = index[Math.round(lane)] ?? [];
  const lx = ((x % track.length) + track.length) % track.length;
  let lo = 0,
    hi = segments.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1,
      s = segments[m];
    if (lx < s.x) hi = m - 1;
    else if (lx >= s.x + s.length) lo = m + 1;
    else return s.lanes & (1 << Math.round(lane)) ? s : undefined;
  }
}
export function profileHeight(s: Segment, t: number): number {
  const p = s.profile;
  for (let i = 1; i < p.length; i++)
    if (t <= p[i][0]) {
      const a = p[i - 1],
        b = p[i];
      return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0]);
    }
  return p[p.length - 1][1];
}
export function heightAt(track: Track, x: number, lane: number): number {
  if (lane < -0.3 || lane > 3.3) return 0;
  const s = segmentAt(track, x, lane);
  if (!s) return 0;
  const lx = ((x % track.length) + track.length) % track.length;
  return profileHeight(s, (lx - s.x) / s.length);
}
export function trackSvg(track: Track, width = 300, height = 46): string {
  const points = track.segments
    .filter((s) => s.profile.some((p) => p[1] > 0))
    .map((s) =>
      s.profile
        .map(
          ([t, h]) =>
            `${(((s.x + t * s.length) / track.length) * width).toFixed(1)},${height - 5 - h * 0.65}`,
        )
        .join(' '),
    );
  return `<svg viewBox="0 0 ${width} ${height}" fill="none" aria-hidden="true"><path d="M0 ${height - 4}H${width}" stroke="currentColor" opacity=".18"/>${points.map((p) => `<polyline points="${p}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>`).join('')}</svg>`;
}
