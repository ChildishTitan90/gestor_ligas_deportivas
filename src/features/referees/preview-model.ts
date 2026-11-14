import type { AssignmentAssessment, RefereePreviewData } from "./types";

export const assignmentLabels = { PROPOSED: "Pendiente", APPROVED: "Aprobada", REVOKED: "Revocada" };
export const viewLabels = { register: "Padrón", availability: "Disponibilidad", quota: "Cuota por club", assignments: "Designaciones", history: "Historial" };
export function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}
export function intervalLabel(startsAt: string, endsAt: string, timezone: string) {
  const formatter = new Intl.DateTimeFormat("es-MX", { timeZone: timezone, dateStyle: "medium", timeStyle: "short", hourCycle: "h23" });
  return `${formatter.format(new Date(startsAt))} → ${formatter.format(new Date(endsAt))}`;
}

/** Evaluación exclusivamente visual de fixtures. NO usar para autorizar operaciones.
 * El servicio futuro entregará AssignmentAssessment después de consultar datos
 * vigentes y comprobar permisos, grupo completo, intervalos y concurrencia. */
export function assessPreview(data: RefereePreviewData, matchId: string, refereeId: string, assignmentId?: string): AssignmentAssessment {
  const match = data.matches.find(item => item.id === matchId);
  const referee = data.referees.find(item => item.id === refereeId);
  if (!match || !referee) return { availability: "UNKNOWN", blockers: [{ code: "INCOMPLETE", message: "Selecciona partido y árbitro para revisar la propuesta." }] };
  const blockers: AssignmentAssessment["blockers"] = [];
  if (!referee.active) blockers.push({ code: "INACTIVE", message: "Árbitro inactivo. No se puede aprobar esta designación." });
  const link = data.links.find(item => item.refereeId === refereeId && item.seasonId === match.seasonId);
  if (!link) blockers.push({ code: "NO_PRESENTATION", message: "No hay presentación del árbitro para esta temporada." });
  const conflictingTeam = match.groupClubs.find(item => item.clubId === link?.clubId);
  if (conflictingTeam) blockers.push({ code: "CLUB_IN_GROUP", message: `El club que presenta tiene a ${conflictingTeam.team} en el grupo ${match.group}${[match.home, match.away].includes(conflictingTeam.team) ? " y participa en este encuentro." : ", aunque ese equipo no dispute el encuentro."}` });
  const overlaps = (start: string, end: string) => start < match.endsAt && end > match.startsAt;
  const intervals = data.availability.filter(item => item.refereeId === refereeId);
  const unavailable = intervals.some(item => !item.available && overlaps(item.startsAt, item.endsAt));
  const covered = intervals.some(item => item.available && item.startsAt <= match.startsAt && item.endsAt >= match.endsAt);
  if (unavailable) blockers.push({ code: "UNAVAILABLE", message: "Existe un intervalo de indisponibilidad que coincide con el partido." });
  else if (!covered) blockers.push({ code: "UNKNOWN_AVAILABILITY", message: "No hay un intervalo disponible que cubra todo el partido. Falta confirmar disponibilidad." });
  for (const assignment of data.assignments) {
    if (assignment.id === assignmentId || assignment.refereeId !== refereeId || assignment.status === "REVOKED") continue;
    const other = data.matches.find(item => item.id === assignment.matchId);
    if (assignment.matchId === matchId) blockers.push({ code: "DUPLICATE", message: "Ya existe una designación no revocada del mismo árbitro para este partido." });
    else if (other && overlaps(other.startsAt, other.endsAt)) blockers.push({ code: "OVERLAP", message: `Traslape con ${other.number} (${assignmentLabels[assignment.status].toLocaleLowerCase("es")}). Revisa ambas designaciones.` });
  }
  return { availability: unavailable ? "UNAVAILABLE" : covered ? "COVERED" : "UNKNOWN", blockers };
}
