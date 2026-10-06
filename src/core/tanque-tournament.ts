import { makeBots, raceProfile, type CompetitionSession, type LocalProfile, type RaceCourse } from './game';
import { generateMap, hash, mapCourse } from './maps';
import type { TimeOfDay, Weather } from './types';

export const TANQUE_TIME_ZONE = 'America/Argentina/Buenos_Aires';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TANQUE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
export function tanqueDay(now = new Date()): string {
  const parts = formatter.formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
function seedFor(day: string, purpose: string): number {
  return parseInt(hash(`tanque-v1:${day}:${purpose}`), 16);
}
function shuffle<T>(values: T[], seed: number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = Math.floor(seed / 4294967296 * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
/** Pure calendar: no profile, current settings or session state enter its seeds. */
export function tanqueCourses(day = tanqueDay()): RaceCourse[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(`${day}T12:00:00Z`)) || new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) !== day)
    throw new Error('Fecha del Torneo Tanque inválida.');
  const loops = shuffle([0, 1, 1, 2, 2], seedFor(day, 'loops'));
  const times = shuffle<TimeOfDay>(['morning', 'afternoon', 'morning', 'night', 'night'], seedFor(day, 'horarios'));
  const weathers = shuffle<Weather>(['clear', 'rain', 'snow', 'clear', 'rain'], seedFor(day, 'climas'));
  const revisions = new Set<string>();
  return loops.map((count, index) => {
    for (let retry = 0; retry < 100; retry++) {
      const map = generateMap({ version: 3, seed: `tanque-v2:${day}:pista-${index + 1}:${retry}`,
        size: 'long', difficulty: 'hard', ramps: 75, mud: 35, cool: 15, grass: 15, sand: 15, gravel: 15, loops: count });
      if (revisions.has(map.revision)) continue;
      revisions.add(map.revision);
      map.name = `Tanque · Pista ${index + 1}`;
      map.laps = 2;
      map.timeOfDay = times[index];
      map.weather = weathers[index];
      return mapCourse(map);
    }
    throw new Error('No se pudo generar el calendario del Torneo Tanque.');
  });
}
export function tanqueTournament(player: LocalProfile, now = new Date()): CompetitionSession {
  if (!player.unlockedMotoneta) throw new Error('Desbloqueá la Motoneta para participar.');
  const day = tanqueDay(now);
  return { id: crypto.randomUUID(), mode: 'tournament', presetId: 'tanque', calendarDate: day, calendarVersion: 2,
    players: [raceProfile(player)], bots: makeBots(3), difficulty: 'hard', courses: tanqueCourses(day),
    courseIndex: 0, turnIndex: 0, results: [], phase: 'ready', seed: seedFor(day, 'bots') };
}
