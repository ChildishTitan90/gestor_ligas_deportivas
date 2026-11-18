export type Pairing = { round: number; home: string; away: string };
export type Slot = { venueId: string; start: number; end: number; reservedUntil: number; preference: number };
export type Scheduled = Pairing & Slot;
export type Calendar = { pairings: Pairing[]; byes: { round: number; teamId: string }[] };

/** Una vuelta enfrenta cada pareja una vez; la siguiente invierte la localía. */
export function roundRobin(teamIds: string[], legs: number): Calendar {
  if (teamIds.length < 2 || teamIds.length > 64 || new Set(teamIds).size !== teamIds.length ||
      !Number.isInteger(legs) || legs < 1 || legs > 4) throw new Error("INVALID_CALENDAR");
  const ring: (string | null)[] = [...teamIds].sort();
  if (ring.length % 2) ring.push(null);
  const base: Calendar = { pairings: [], byes: [] };
  for (let round = 1; round < ring.length; round++) {
    for (let i = 0; i < ring.length / 2; i++) {
      const a = ring[i], b = ring[ring.length - 1 - i];
      if (a === null || b === null) { base.byes.push({ round, teamId: (a ?? b)! }); continue; }
      const reverse = i === 0 ? round % 2 === 0 : i % 2 === 0;
      base.pairings.push({ round, home: reverse ? b : a, away: reverse ? a : b });
    }
    ring.splice(1, 0, ring.pop()!);
  }
  const result: Calendar = { pairings: [], byes: [] };
  for (let leg = 0; leg < legs; leg++) {
    const offset = leg * (ring.length - 1);
    result.pairings.push(...base.pairings.map(p => ({ round: p.round + offset,
      home: leg % 2 ? p.away : p.home, away: leg % 2 ? p.home : p.away })));
    result.byes.push(...base.byes.map(b => ({ ...b, round: b.round + offset })));
  }
  return result;
}

export const overlaps = (a: number, b: number, c: number, d: number) => a < d && c < b;
export function clashes(a: Scheduled, b: Scheduled) {
  return (a.venueId === b.venueId && overlaps(a.start, a.reservedUntil, b.start, b.reservedUntil)) ||
    ([a.home, a.away].some(id => id === b.home || id === b.away) && overlaps(a.start, a.end, b.start, b.end));
}

/** Búsqueda acotada sobre candidatos ya autorizados. Nunca devuelve una solución parcial.
 * Ordena preferencias blandas, sin sacrificar las restricciones duras ni prometer óptimo global. */
export function assignSlots(jobs: { pairing: Pairing; slots: Slot[] }[], occupied: Scheduled[],
  limits = { milliseconds: 5000, nodes: 100000 }) {
  if (jobs.length > 1024 || jobs.reduce((total, job) => total + job.slots.length, 0) > 200000)
    return { ok: false as const, code: "INPUT_LIMIT", conflicts: [] as Pairing[] };
  const deadline = performance.now() + limits.milliseconds;
  let nodes = 0;
  const chosen: Scheduled[] = [];
  const candidates = jobs.map(job => ({ ...job, slots: job.slots.filter(s =>
    [s.start, s.end, s.reservedUntil, s.preference].every(Number.isFinite) && s.end > s.start && s.reservedUntil >= s.end &&
    !occupied.some(other => clashes({ ...job.pairing, ...s }, other)))
    .sort((a,b) => a.preference - b.preference || a.start - b.start || a.venueId.localeCompare(b.venueId)) }));
  const missing = candidates.filter(j => !j.slots.length).map(j => j.pairing);
  if (missing.length) return { ok: false as const, code: "NO_AVAILABLE_SLOT", conflicts: missing };
  let exhausted = false;
  function search(pending: typeof candidates): boolean {
    if (++nodes > limits.nodes || performance.now() > deadline) { exhausted = true; return false; }
    if (!pending.length) return true;
    // Los candidatos ya excluyen todas las decisiones anteriores. Filtrar solo
    // contra la nueva elección evita volver a recorrer el calendario completo.
    const remaining = [...pending].sort((a,b) => a.slots.length - b.slots.length);
    const [job, ...rest] = remaining;
    for (const slot of job.slots) {
      if (++nodes > limits.nodes || performance.now() > deadline) { exhausted = true; return false; }
      const match = { ...job.pairing, ...slot };
      const next = rest.map(j => ({ ...j, slots: j.slots.filter(s => !clashes({ ...j.pairing, ...s }, match)) }));
      if (next.some(j => !j.slots.length)) continue;
      chosen.push(match);
      if (search(next)) return true;
      chosen.pop();
      if (exhausted) return false;
    }
    return false;
  }
  if (!search(candidates)) return { ok: false as const, code: exhausted ? "SEARCH_LIMIT" : "NO_SOLUTION", conflicts: jobs.map(j => j.pairing) };
  return { ok: true as const, matches: chosen.sort((a,b) => a.round-b.round || a.start-b.start), nodes };
}
