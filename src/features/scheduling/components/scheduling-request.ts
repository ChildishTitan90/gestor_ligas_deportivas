export const actionButton = "primary-action min-h-12 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-50";
export const fieldClass = "mt-1 block min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2";

const feedback: Record<string, string> = {
  STALE_MATCH: "El partido cambió. Actualiza la propuesta antes de volver a intentarlo.",
  STALE_PROPOSAL: "La propuesta cambió. Actualízala antes de volver a intentarlo.",
  ADJUSTMENT_CONFLICT: "Otro cambio coincidió con este ajuste. Actualiza la propuesta y comprueba el horario.",
  PROPOSAL_CONFLICT: "Otra operación cambió la propuesta. Actualízala y revisa su estado.",
  INVALID_PROPOSAL_TRANSITION: "La propuesta cambió de estado. Actualízala para ver las acciones disponibles.",
  INVALID_TEAM_SWAP: "Elige dos equipos de partidos diferentes de la misma jornada.",
  MATCHUP_CHANGE_NOT_ALLOWED: "El calendario cambió. Actualiza la propuesta y vuelve a intentar.",
  MATCH_NOT_EDITABLE: "El partido ya no se puede ajustar como borrador.",
  MISSING_VENUE_POLICY: "El reglamento aprobado debe indicar cuántas jornadas se juegan en la unidad deportiva.",
  SCHEDULE_BREAK: "El horario coincide con un descanso de la temporada o de uno de los equipos.",
  TEAM_SANCTION: "Uno de los equipos tiene una sanción que impide disputar el partido en ese horario.",
  OUTSIDE_MATCHDAY: "Elige una fecha dentro de la jornada.",
  INVALID_LOCAL_TIME: "La hora indicada no es válida en la zona horaria de la liga.",
  NO_ELIGIBLE_VENUES: "No hay canchas elegibles y libres para ese horario.",
  VENUE_NOT_AVAILABLE: "La cancha o su disponibilidad cambió. Consulta las opciones de nuevo.",
  EMPTY_PROPOSAL: "La propuesta necesita al menos un partido.",
  INVALID_PROPOSAL_MATCH: "La propuesta contiene un partido de otra jornada o temporada.",
  INCOMPLETE_PROPOSAL_MATCH: "Falta completar la cancha o el horario del partido.",
  INVALID_PAYLOAD: "Revisa los datos y escribe un motivo de entre 8 y 500 caracteres.",
  FORBIDDEN: "Tu cuenta ya no tiene permiso para esta acción.",
  STALE_CONFIGURATION: "La configuración de la temporada cambió. Genera una propuesta con la versión vigente.",
  INVALID_SCHEDULE: "El calendario incumple una restricción vigente.",
  VENUE_BLOCK: "La cancha está bloqueada en ese horario.",
  NO_OPENING: "La cancha no tiene disponibilidad para toda la duración del partido y su holgura en esa fecha, o la fecha está fuera de la jornada.",
  LOAN_WINDOW: "El equipo local no cuenta con autorización vigente para usar esta cancha en ese horario.",
  VENUE_STAGE: "El reglamento no permite esta cancha en esta jornada.",
  FINAL_ROUNDS: "Esta jornada requiere una unidad deportiva autorizada.",
  DURATION: "La duración configurada de la cancha no coincide con la del reglamento.",
  SEASON_BREAK: "La fecha coincide con un descanso de la temporada.",
  SANCTION: "Uno de los equipos tiene una sanción que impide jugar en ese horario.",
  INVALID_VENUE: "La cancha ya no está disponible para esta liga.",
  SLOT_CONFLICT: "El horario coincide con otro encuentro o reserva.",
  HOME_ALTERNATION: "Revisa la alternancia de localías entre vueltas.",
};

export async function sendSchedulingRequest(path: string, actorId: string, body: object, expectedCode: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": actorId },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (response.ok && result.code === expectedCode) return { result };
  if (response.status >= 500 || typeof result?.code !== "string" || (response.ok && expectedCode !== "VENUE_OPTIONS")) throw new Error("Respuesta sin confirmar");
  const conflict = Array.isArray(result.conflicts) ? result.conflicts[0] : undefined;
  const text = conflict && typeof conflict.code === "string"
    ? `Jornada ${Number(conflict.round)}. ${feedback[conflict.code] ?? "Revisa cancha, horario y restricciones de los equipos."}`
    : feedback[result.code] ?? "No se pudo completar la operación.";
  return { error: text, code: result.code as string, matchId: typeof result.matchId === "string" ? result.matchId : undefined };
}
