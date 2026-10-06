import { FILE_HEADER, FORMAT_VERSION, GAME_ID, GAME_NAME } from '../identity';
import type { Difficulty, RaceCourse } from './game';
import { readTimeOfDay } from './time-of-day';
import { PIECES, getTrack } from './tracks';
import type { Segment, TimeOfDay, Track, Weather } from './types';
import { readWeather } from './weather';
import { isFlatTerrain, withTerrainShape, terrainShape } from './terrain';
import { isLoop, loopGeometryMetadata, loopPlacementError, LOOP_APPROACH, LOOP_LENGTH, LOOP_RUNOUT, LOOP_SPACING, maximumLoops } from './loop-geometry';

export interface PlacedPiece extends Segment {
  id: string;
}
export interface MapDesign {
  game: typeof GAME_ID;
  version: 4;
  id: string;
  revision: string;
  name: string;
  length: number;
  laps: number;
  timeOfDay: TimeOfDay;
  weather: Weather;
  items: PlacedPiece[];
}
export function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
export function revision(d: Pick<MapDesign, 'items' | 'length'>) {
  return hash(
    JSON.stringify([
      d.length,
      [...d.items]
        .sort((a, b) => a.x - b.x || a.lanes - b.lanes)
        .map(({ x, length, profile, lanes, surface, boost, piece, terrainShape }) => [
          x,
          length,
          profile,
          lanes,
          surface,
          boost,
          piece,
          terrainShape,
        ]),
    ]),
  );
}
export function emptyDesign(): MapDesign {
  const d: MapDesign = {
    ...FILE_HEADER,
    id: crypto.randomUUID(),
    revision: '',
    name: 'Mi circuito',
    length: 4096,
    laps: 2,
    timeOfDay: 'morning',
    weather: 'clear',
    items: [],
  };
  d.revision = revision(d);
  return d;
}
export function designFromTrack(track: Track, id: string = crypto.randomUUID()): MapDesign {
  const d: MapDesign = {
    ...FILE_HEADER,
    id,
    revision: '',
    name: track.name,
    length: track.length,
    laps: track.laps,
    timeOfDay: 'morning',
    weather: 'clear',
    items: track.segments
      .filter((s) => s.piece !== 'flat')
      .map((s, i) => ({ ...structuredClone(s), id: `piece-${i}` })),
  };
  d.revision = revision(d);
  return d;
}
export function validateMap(value: unknown): MapDesign {
  const d = value as MapDesign;
  const version = (value as { version?: number } | null)?.version;
  if (!d || d.game !== GAME_ID || (version !== FORMAT_VERSION && version !== 3))
    throw new Error(`El archivo no es un mapa compatible con ${GAME_NAME}.`);
  const num = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (
    !d ||
    typeof d.id !== 'string' ||
    !d.id ||
    d.id.length > 100 ||
    typeof d.name !== 'string' ||
    !d.name.trim() ||
    d.name.length > 40 ||
    !num(d.length, 640, 30000) ||
    !Number.isInteger(d.laps) ||
    !num(d.laps, 1, 9) ||
    !Array.isArray(d.items) ||
    d.items.length > 2500
  )
    throw new Error('Nombre, longitud, vueltas o formato del mapa inválidos.');
  const ids = new Set<string>();
  const items = d.items
    .map((s) => {
      if (
        !s ||
        typeof s.id !== 'string' ||
        ids.has(s.id) ||
        !num(s.x, 0, d.length) ||
        !num(s.length, 1, 640) ||
        s.x + s.length > d.length ||
        !Number.isInteger(s.lanes) ||
        !num(s.lanes, 1, 15) ||
        !(version === 3 ? ['dirt', 'mud', 'grass', 'cool', 'bump'] : ['dirt', 'mud', 'grass', 'cool', 'bump', 'sand', 'gravel']).includes(s.surface) ||
        typeof s.boost !== 'boolean' ||
        typeof s.piece !== 'string' ||
        s.piece.length > 20 ||
        s.piece === 'flat' ||
        !Array.isArray(s.profile) ||
        s.profile.length < 2 ||
        s.profile.length > 32
      )
        throw new Error('La posición o las dimensiones de una pieza no son válidas.');
      ids.add(s.id);
      let prev = -1;
      for (const p of s.profile) {
        if (
          !Array.isArray(p) ||
          p.length !== 2 ||
          !num(p[0], 0, 1) ||
          p[0] <= prev ||
          !num(p[1], 0, 128)
        )
          throw new Error('Perfil de pieza inválido.');
        prev = p[0];
      }
      if (s.profile[0][0] !== 0 || s.profile.at(-1)![0] !== 1)
        throw new Error('Perfil incompleto.');
      if (s.terrainShape !== undefined && (!isFlatTerrain(s) || s.terrainShape === null ||
        s.terrainShape.version !== 1 || !Number.isInteger(s.terrainShape.variant) ||
        !num(s.terrainShape.variant, 0, 0xffffffff)))
        throw new Error('Contorno de terreno incompatible o inválido.');
      return withTerrainShape({
        id: s.id,
        x: s.x,
        length: s.length,
        lanes: s.lanes,
        surface: s.surface,
        boost: s.boost,
        piece: s.piece,
        profile: s.profile.map((p) => [p[0], p[1]] as [number, number]),
        ...(s.terrainShape ? { terrainShape: { ...s.terrainShape } } : {}),
      });
    })
    .sort((a, b) => a.x - b.x || a.lanes - b.lanes);
  for (let lane = 0; lane < 4; lane++) {
    let end = 0;
    for (const s of items.filter((s) => !isLoop(s) && s.lanes & (1 << lane))) {
      if (s.x < end) throw new Error(`Hay piezas superpuestas en el carril ${lane + 1}.`);
      end = s.x + s.length;
    }
  }
  for(const loop of items.filter(isLoop)) {
    const error=loopPlacementError(loop,items,d.length);
    if(error) throw new Error(error);
  }
  const result: MapDesign = {
    ...FILE_HEADER,
    id: d.id,
    name: d.name.trim(),
    length: d.length,
    laps: d.laps,
    timeOfDay: readTimeOfDay(d.timeOfDay),
    weather: readWeather(d.weather),
    items,
    revision: '',
  };
  result.revision = revision(result);
  return result;
}
export function mapTrack(d: MapDesign): Track {
  return {
    id: d.id,
    name: d.name,
    number: 0,
    subtitle: '',
    length: d.length,
    laps: d.laps,
    color: '#e9b56b',
    custom: true,
    segments: structuredClone(d.items),
  };
}
export function mapCourse(d: MapDesign): RaceCourse {
  const track = mapTrack(d);
  return {
    track,
    ...loopGeometryMetadata(track),
    ref: { id: d.id, revision: d.revision, name: d.name },
    timeOfDay: d.timeOfDay,
    weather: d.weather,
  };
}
export const BUILTINS: RaceCourse[] = Array.from({ length: 5 }, (_, i) => {
  const track = getTrack(i);
  track.subtitle = '';
  return {
    track,
    ref: {
      id: track.id,
      revision: revision({
        length: track.length,
        items: track.segments
          .filter((s) => s.piece !== 'flat')
          .map((s, j) => ({ ...s, id: String(j) })),
      }),
      name: track.name,
    },
    timeOfDay: 'morning',
    weather: 'clear',
  };
});
export function placedPiece(piece: string, x: number, lanes?: number): PlacedPiece {
  const p = PIECES.find((p) => p.id === piece)!;
  return withTerrainShape({
    id: crypto.randomUUID(),
    x,
    length: p.length,
    profile: structuredClone(p.profile),
    lanes: p.id==='T' ? 15 : lanes ?? p.lanes,
    surface: p.surface,
    boost: !!p.boost,
    piece: p.id,
  });
}
export interface GeneratorOptions {
  version: 3;
  seed: string;
  size: 'short' | 'medium' | 'long';
  difficulty: Difficulty;
  ramps: number;
  mud: number;
  cool: number;
  grass: number;
  sand: number;
  gravel: number;
  loops: number;
}
export const generatorDefaults: GeneratorOptions = {
  version: 3,
  seed: '1984',
  size: 'medium',
  difficulty: 'normal',
  ramps: 55,
  mud: 20,
  cool: 25,
  grass: 10,
  sand: 10,
  gravel: 10,
  loops: 1,
};
export function generateMap(options: GeneratorOptions): MapDesign {
  if (
    options.version !== 3 ||
    !['short', 'medium', 'long'].includes(options.size) ||
    !['easy', 'normal', 'hard'].includes(options.difficulty) ||
    typeof options.seed !== 'string' ||
    options.seed.length > 80 ||
    [options.ramps, options.mud, options.cool, options.grass, options.sand, options.gravel].some((v) => !Number.isFinite(v) || v < 0 || v > 100)
  )
    throw new Error('Parámetros del generador inválidos.');
  const mapLength={short:2048,medium:4096,long:6144}[options.size];
  const max=maximumLoops(mapLength);
  if(!Number.isInteger(options.loops) || options.loops<0 || options.loops>max)
    throw new Error(`En esta longitud caben hasta ${max} loops. Elegí una cantidad entre 0 y ${max}.`);
  const fingerprint = hash(
    JSON.stringify([
      options.version,
      options.seed,
      options.size,
      options.difficulty,
      options.ramps,
      options.mud,
      options.cool,
      options.grass,
      options.sand,
      options.gravel,
      options.loops,
    ]),
  );
  let seed = parseInt(fingerprint, 16);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const d = emptyDesign();
  d.id = `generated-${fingerprint}`;
  d.name = `Mapa ${options.seed || 'sin semilla'}`.slice(0, 40);
  d.length = mapLength;
  const reservations: [number,number][]=[];
  // Shuffle slots, then place the requested count before consuming any terrain RNG.
  const slots=Array.from({length:max},(_,i)=>LOOP_APPROACH+i*LOOP_SPACING);
  for(let i=slots.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [slots[i],slots[j]]=[slots[j],slots[i]]; }
  for(const x of slots.slice(0,options.loops).sort((a,b)=>a-b)) {
    const loop=placedPiece('T',x); loop.id=`generated-loop-${d.items.length}`; d.items.push(loop);
    reservations.push([x-LOOP_APPROACH,x+LOOP_LENGTH+LOOP_RUNOUT]);
  }
  const ramps =
    options.difficulty === 'easy'
      ? ['A', 'B', 'D']
      : options.difficulty === 'normal'
        ? ['A', 'B', 'C', 'D', 'F', 'G']
        : ['C', 'E', 'F', 'G', 'H', 'R', 'S'];
  let x = 320,
    index = 0;
  while (x < d.length - 640) {
    const reserved=reservations.find(([start,end])=>x>=start && x<end);
    if(reserved) { x=reserved[1]; continue; }
    const terrainWeights = [['K', options.mud], ['M', options.cool], ['P', options.grass], ['U', options.sand], ['V', options.gravel]] as const;
    const weight = options.ramps + terrainWeights.reduce((sum, [, w]) => sum + w, 0);
    if (!weight) break;
    let pick = random() * Math.max(100, weight);
    let code: string | null = null;
    if (pick < options.ramps) code = ramps[Math.floor(random() * ramps.length)];
    else {
      pick -= options.ramps;
      for (const [id, w] of terrainWeights) {
        if (pick < w) { code = id; break; }
        pick -= w;
      }
    }
    if (code) {
      const s = placedPiece(
        code,
        x,
        terrainWeights.some(([id]) => id === code) ? 1 << Math.floor(random() * 4) : 15,
      );
      s.id = `generated-piece-${index++}`;
      if (isFlatTerrain(s)) s.terrainShape = { ...terrainShape(s), variant: parseInt(hash(fingerprint + ':' + s.id), 16) };
      if(!reservations.some(([start,end])=>s.x<end && s.x+s.length>start)) d.items.push(s);
      x += s.length;
    }
    x += Math.round(
      (options.difficulty === 'easy' ? 144 : options.difficulty === 'normal' ? 88 : 48) +
        random() * 96,
    );
    x = Math.ceil(x / 8) * 8;
  }
  return validateMap(d);
}
