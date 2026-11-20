import { overlaps } from "./generator";

export type ParticipationBlock = {
  season_team_id: string | null;
  starts_at: Date;
  ends_at: Date | null;
};

/** Mismo contrato temporal que elegibilidad: inicio inclusivo y fin exclusivo.
 * Comprobar todo el partido evita iniciarlo antes de una suspensión que entra
 * en vigor mientras se disputa. No inferir resoluciones de apelaciones. */
export function participationBlocked(
  blocks: readonly ParticipationBlock[], teams: readonly string[], start: number, end: number,
) {
  return blocks.some(block => block.season_team_id !== null && teams.includes(block.season_team_id) &&
    overlaps(start, end, +block.starts_at, block.ends_at ? +block.ends_at : Infinity));
}

/** Las jornadas son de temporada; un grupo menor puede necesitar solo un prefijo. */
export function calendarMatchdays<T extends { number: number; start_date: Date; end_date: Date }>(
  days: readonly T[], required: number,
): T[] | null {
  if (!Number.isInteger(required) || required < 1 || days.length < required) return null;
  const selected = [...days].sort((a, b) => a.number - b.number).slice(0, required);
  if (selected.some((day, i) => day.number !== i + 1 || +day.start_date > +day.end_date ||
    (i > 0 && +day.start_date <= +selected[i - 1].end_date))) return null;
  return selected;
}

/** La cuadrícula parte de la apertura autorizada, no de medianoche UTC. */
export function firstCandidate(openingStart: number, lower: number, step: number) {
  return openingStart + Math.max(0, Math.ceil((lower - openingStart) / step)) * step;
}

/** Intercalar horarios autorizados que no caen en la cuadrícula de búsqueda. */
export function* candidateStarts(openingStart: number, lower: number, upper: number, step: number, fixed: number[]) {
  const extra = [...new Set(fixed.filter(value => Number.isFinite(value) && value >= lower && value < upper))].sort((a,b) => a-b);
  let grid = firstCandidate(openingStart, lower, step), index = 0;
  while (grid < upper || index < extra.length) {
    const next = Math.min(grid < upper ? grid : Infinity, extra[index] ?? Infinity);
    yield next;
    if (grid === next) grid += step;
    if (extra[index] === next) index++;
  }
}

type HomeAssignment = {
  season_team_id: string; venue_id: string; weekday: number; start_time: Date;
  starts_at: Date; ends_at: Date;
  venue_loans: null | {
    status: string; season_id: string; club_id: string; venue_id: string;
    approved_by: string | null; approved_at: Date | null;
  };
};

/** Una asignación del visitante no concede al local el préstamo de su club. */
export function authorizedHomeAssignment(assignments: readonly HomeAssignment[], context: {
  teamId: string; clubId: string; seasonId: string; venueId: string; localStart: string; localEnd: string; directAssignmentAllowed?: boolean;
}) {
  const date = context.localStart.slice(0, 10), lastDate = context.localEnd.slice(0, 10);
  return assignments.some(a => a.season_team_id === context.teamId && a.venue_id === context.venueId &&
    date >= a.starts_at.toISOString().slice(0, 10) && lastDate <= a.ends_at.toISOString().slice(0, 10) &&
    a.weekday === (new Date(`${date}T12:00:00Z`).getUTCDay() || 7) &&
    a.start_time.toISOString().slice(11, 19) === context.localStart.slice(11, 19) &&
    ((a.venue_loans === null && context.directAssignmentAllowed === true) || (a.venue_loans?.status === "APPROVED" && !!a.venue_loans.approved_by && !!a.venue_loans.approved_at &&
    a.venue_loans.season_id === context.seasonId && a.venue_loans.club_id === context.clubId &&
    a.venue_loans.venue_id === context.venueId)));
}
