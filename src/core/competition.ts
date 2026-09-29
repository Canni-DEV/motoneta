import type { CompetitionSession, Finish, RaceConfig, RaceResult } from './game';
export const POINTS = [10, 8, 6, 4, 2, 1];
export function placements(finishes: Finish[]) {
  return finishes
    .map((f) => ({
      ...f,
      rank:
        f.ticks === null
          ? null
          : 1 + finishes.filter((o) => o.ticks !== null && o.ticks < f.ticks!).length,
    }))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));
}
export function turnPlayer(s: CompetitionSession) {
  return s.players[(s.courseIndex + s.turnIndex) % s.players.length];
}
export function sessionConfig(s: CompetitionSession): RaceConfig {
  return {
    ...structuredClone(s.courses[s.courseIndex]),
    mode: s.mode,
    player: structuredClone(turnPlayer(s)),
    bots: structuredClone(s.bots),
    difficulty: s.difficulty,
    seed: (s.seed + s.courseIndex * 997) >>> 0,
  };
}
export function acceptResult(
  s: CompetitionSession,
  result: RaceResult,
  replayId: string,
): CompetitionSession {
  const next = structuredClone(s),
    p = turnPlayer(s);
  if (
    next.phase !== 'ready' ||
    next.results.some((r) => r.course === s.courseIndex && r.player === p.id)
  )
    return next;
  next.results.push({
    course: s.courseIndex,
    player: p.id,
    result: structuredClone(result),
    replayId,
  });
  next.phase = 'results';
  return next;
}
export function advanceSession(s: CompetitionSession): CompetitionSession {
  if (s.phase !== 'results') return s;
  const n = structuredClone(s);
  n.turnIndex++;
  if (n.mode === 'tournament' || n.turnIndex === n.players.length) {
    n.turnIndex = 0;
    n.courseIndex++;
  }
  n.phase = n.courseIndex === n.courses.length ? 'complete' : 'ready';
  return n;
}
export function standings(s: CompetitionSession) {
  const rows = [...s.players, ...s.bots].map((p) => ({
    ...p,
    points: 0,
    wins: 0,
    ticks: 0,
    completed: 0,
    rank: 0,
  }));
  for (let i = 0; i < s.courses.length; i++) {
    const runs = s.results.filter((r) => r.course === i);
    if (!runs.length || (s.mode === 'versus' && runs.length !== s.players.length)) continue;
    const ranked = placements(runs.flatMap((r) => r.result.finishes));
    for (const f of ranked) {
      const row = rows.find((p) => p.id === f.id)!;
      row.points += f.rank === null ? 0 : POINTS[f.rank - 1];
      row.wins += f.rank === 1 ? 1 : 0;
      row.ticks += f.ticks ?? runs[0].result.limitTicks;
      row.completed++;
    }
  }
  rows.sort((a, b) => b.points - a.points || b.wins - a.wins || a.ticks - b.ticks);
  rows.forEach(
    (r, i) =>
      (r.rank =
        i > 0 &&
        r.points === rows[i - 1].points &&
        r.wins === rows[i - 1].wins &&
        r.ticks === rows[i - 1].ticks
          ? rows[i - 1].rank
          : i + 1),
  );
  return rows;
}
