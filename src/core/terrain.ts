import type { Segment, Surface, TerrainShape } from './types';

export type TerrainPoint = readonly [number, number];
export type TerrainPolygon = readonly TerrainPoint[];
export const TERRAIN_SURFACES = ['mud', 'grass', 'cool', 'sand', 'gravel'] as const;
export type TerrainSurface = (typeof TERRAIN_SURFACES)[number];
export const TERRAIN_INFO: Record<TerrainSurface, { name: string; effect: string; color: string }> = {
  mud: { name: 'Barro', effect: 'Velocidad 65 % · aceleración 70 %. El caballito reduce parte de la resistencia.', color: '#654733' },
  grass: { name: 'Césped', effect: 'Velocidad 90 % · aceleración 90 %. El caballito reduce parte de la resistencia.', color: '#678043' },
  cool: { name: 'Refrigeración', effect: 'Los aspersores llevan la temperatura a cero al entrar en contacto con el suelo.', color: '#658e99' },
  sand: { name: 'Arena', effect: 'Velocidad 80 % · aceleración 50 %. Cuesta recuperar velocidad; el caballito ayuda.', color: '#d3b777' },
  gravel: { name: 'Grava', effect: 'Velocidad normal · cambios de carril al 60 %. Anticipá la maniobra.', color: '#93938a' },
};
export const isTerrainSurface = (surface: Surface): surface is TerrainSurface =>
  (TERRAIN_SURFACES as readonly string[]).includes(surface);
export const isFlatTerrain = (s: Pick<Segment, 'surface' | 'profile'>) =>
  isTerrainSurface(s.surface) && s.profile.every((p) => p[1] === 0);

export function terrainSeed(s: Pick<Segment, 'piece' | 'x' | 'length' | 'lanes' | 'surface'>): number {
  let h = 2166136261;
  const key = [s.piece, s.x, s.length, s.lanes, s.surface].join(':');
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function terrainShape(s: Segment): TerrainShape {
  return s.terrainShape ?? { version: 1, variant: terrainSeed(s) };
}
export function withTerrainShape<T extends Segment>(s: T): T {
  return isFlatTerrain(s) ? { ...s, terrainShape: terrainShape(s) } : s;
}
const cache = new WeakMap<Segment, { variant: number; length: number; lanes: number; polygons: TerrainPolygon[] }>();

/** Local longitudinal units and continuous lane coordinates; shared with the renderer.
 * Version 1 is immutable: changes to this algorithm require a shape/rules version. */
export function terrainPolygons(s: Segment): TerrainPolygon[] {
  if (!isFlatTerrain(s)) return [];
  const variant = terrainShape(s).variant;
  const cached = cache.get(s);
  if (cached?.variant === variant && cached.length === s.length && cached.lanes === s.lanes) return cached.polygons;
  const polygons: TerrainPolygon[] = [];
  let seed = variant;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let first = 0; first < 4; first++) {
    if (!(s.lanes & (1 << first))) continue;
    let last = first;
    while (last < 3 && s.lanes & (1 << (last + 1))) last++;
    const center = (first + last) / 2, half = (last - first + 1) / 2;
    const polygon: TerrainPoint[] = [];
    const phase = random() * Math.PI * 2;
    for (let i = 0; i < 40; i++) {
      const a = i / 40 * Math.PI * 2, c = Math.cos(a), t = Math.sin(a);
      const radius = 0.91 - random() * 0.075 + Math.sin(a * 3 + phase) * 0.06 + Math.sin(a * 7 + phase * 0.7) * 0.018;
      // A rounded rectangle, with all vertices ordered radially: never self-intersects.
      polygon.push([
        Math.round((0.5 + Math.sign(c) * Math.sqrt(Math.abs(c)) * radius / 2) * s.length * 4096) / 4096,
        Math.round((center + Math.sign(t) * Math.sqrt(Math.abs(t)) * half * radius) * 65536) / 65536,
      ]);
    }
    polygons.push(polygon);
    first = last;
  }
  cache.set(s, { variant, length: s.length, lanes: s.lanes, polygons });
  return polygons;
}
export function pointInTerrain(polygon: TerrainPolygon, x: number, lane: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[j], [bx, by] = polygon[i];
    const cross = (x - ax) * (by - ay) - (lane - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-9 && x >= Math.min(ax, bx) - 1e-9 && x <= Math.max(ax, bx) + 1e-9 &&
      lane >= Math.min(ay, by) - 1e-9 && lane <= Math.max(ay, by) + 1e-9) return true;
    if ((ay > lane) !== (by > lane) && x < (bx - ax) * (lane - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export const terrainContains = (s: Segment, x: number, lane: number) =>
  terrainPolygons(s).some((polygon) => pointInTerrain(polygon, x, lane));

/** Exact path intervals, including tiny patches and concave exit/re-entry in one tick. */
export function terrainIntervals(polygon: TerrainPolygon, x0: number, lane0: number, x1: number, lane1: number) {
  const dx = x1 - x0, dy = lane1 - lane0, cuts = [0, 1];
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[(i + 1) % polygon.length];
    const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const t = ((ax - x0) * ey - (ay - lane0) * ex) / den;
    const u = ((ax - x0) * dy - (ay - lane0) * dx) / den;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  const intervals: [number, number][] = [];
  for (let i = 1; i < cuts.length; i++) {
    const a = cuts[i - 1], b = cuts[i], t = (a + b) / 2;
    if (b - a > 1e-10 && pointInTerrain(polygon, x0 + dx * t, lane0 + dy * t)) {
      const previous = intervals[intervals.length - 1];
      if (previous && Math.abs(previous[1] - a) < 1e-9) previous[1] = b;
      else intervals.push([a, b]);
    }
  }
  return intervals;
}
type Factors = Readonly<{ speed: number; acceleration: number; lateral: number }>;
const ordinary: Factors = Object.freeze({speed:1,acceleration:1,lateral:1});
const handling: Partial<Record<Surface, Factors>> = {
  mud: Object.freeze({speed:0.65,acceleration:0.70,lateral:1}),
  grass: Object.freeze({speed:0.90,acceleration:0.90,lateral:1}),
  sand: Object.freeze({speed:0.80,acceleration:0.50,lateral:1}),
  gravel: Object.freeze({speed:1,acceleration:1,lateral:0.60}),
};
const wheelieHandling: Partial<Record<Surface, Factors>> = Object.fromEntries(
  Object.entries(handling).map(([surface, factors]) => [surface, Object.freeze({
    speed:1-(1-factors.speed)*0.6,acceleration:1-(1-factors.acceleration)*0.6,lateral:factors.lateral,
  })]),
);
/** Immutable descriptors avoid allocations in simulation, AI and swept contacts. */
export function terrainFactors(surface: Surface = 'dirt', wheelie = false): Factors {
  return (wheelie ? wheelieHandling : handling)[surface] ?? ordinary;
}
