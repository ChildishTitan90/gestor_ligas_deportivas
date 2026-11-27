import { auditEntities, type AuditChange } from "./contract";

// Lista positiva: nunca devolver JSON completo ni recorrer objetos privados.
const fields: Record<keyof typeof auditEntities, Record<string, string>> = {
  users: { is_active: "Cuenta activa", must_change_password: "Cambio de contraseña requerido", version: "Versión", maintenance_revision: "Revisión" },
  clubs: { name: "Nombre del club", status: "Estado", version: "Versión" },
  teams: { name: "Nombre del equipo", status: "Estado", version: "Versión" },
  leagues: { name: "Nombre de la liga", is_active: "Liga activa" },
  seasons: { name: "Temporada", status: "Estado", version: "Versión", start_date: "Inicio", end_date: "Fin" },
  club_affiliations: { status: "Estado", review_version: "Revisión" },
  player_registrations: { status: "Estado deportivo", identity_review_status: "Revisión de identidad", jersey_number: "Dorsal", identityVersion: "Versión de identidad" },
  player_identity_corrections: { status: "Estado", identityVersion: "Versión de identidad", registrations: "Registros reevaluados" },
  schedule_proposals: { status: "Estado", version: "Versión" },
  matches: { version: "Versión", starts_at: "Inicio", ends_at: "Fin", reserved_until: "Ocupación de cancha hasta" },
  match_results: { home_score: "Goles del local", away_score: "Goles del visitante", counts_in_standings: "Cuenta en clasificación", version: "Versión" },
  disciplinary_cases: { status: "Estado" }, sanctions: { blocks_participation: "Impide participación", quantity: "Cantidad", starts_at: "Inicio", ends_at: "Fin" },
  team_withdrawals: { type: "Tipo", effect: "Efecto" }, charges: { issued_on: "Emisión", due_on: "Vencimiento" },
};

const reserved = /password|contrase|token|secret|bearer|hash|api[_-]?key|curp|\bine\b|storage_key|domicilio|tel[eé]fono|postgres(?:ql)?:|https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b|\b[0-9a-f]{32,}\b|\b\d{10,}\b|eyJ[a-zA-Z0-9_-]+\./i;
export function visibleText(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim() || reserved.test(value)) return fallback;
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}
export function actorLabel(value: unknown) {
  if (value === null) return "Sistema";
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,60}$/.test(value)) return "Usuario registrado";
  return visibleText(`@${value}`, "Usuario registrado");
}
const actionLabels: Record<string, string> = {
  INSERT: "Alta", UPDATE: "Actualización", DELETE: "Baja",
  AFFILIATION_APPROVE: "Afiliación aprobada", AFFILIATION_REQUEST_CORRECTIONS: "Correcciones de afiliación solicitadas",
  AFFILIATION_RESUBMIT: "Correcciones de afiliación reenviadas",
  ACCOUNT_EMAIL_REQUESTED: "Cambio de correo solicitado", ACCOUNT_EMAIL_CONFIRMED: "Cambio de correo confirmado",
  PLAYER_CORRECTION_REQUESTED: "Corrección solicitada", PLAYER_CORRECTION_APPLIED: "Corrección aplicada",
  PLAYER_CORRECTION_RETURNED: "Corrección devuelta", PLAYER_CORRECTION_REASSESSED: "Elegibilidad reevaluada",
  PLAYER_REGISTERED: "Jugador registrado", PLAYER_IDENTITY_REVIEWED: "Identidad revisada",
  PLAYER_IDENTITY_CREATED: "Identidad registrada", PLAYER_AUTO_ACTIVATED: "Jugador habilitado automáticamente",
  PLAYER_MANUAL_ACTIVATED: "Habilitación de jugador revisada",
  PLAYER_AGE_EXCEPTION_CAPTURED: "Excepción de edad capturada", PLAYER_AGE_EXCEPTION_REQUESTED: "Excepción de edad solicitada",
  PLAYER_AGE_EXCEPTION_DECIDED: "Excepción de edad resuelta",
  PLAYER_INE_PREPARED: "Verificación de identificación preparada", PLAYER_INE_RESULT: "Resultado de verificación de identificación registrado",
  MATCH_SCHEDULED: "Partido programado", MATCH_RESCHEDULED: "Partido reprogramado",
  SCHEDULE_VERSION: "Versión de programación registrada", ACTIVATE_APPROVED_SCHEDULE: "Programación aprobada activada",
};
export function actionLabel(action: string) { return Object.hasOwn(actionLabels,action) ? actionLabels[action] : "Operación registrada"; }

// Solo literales emitidos por el servidor y revisados para cada tipo de evento.
// Un motivo libre no puede considerarse anónimo por no contener patrones conocidos.
const allowedReasons: Partial<Record<keyof typeof auditEntities, Record<string, readonly string[]>>> = {
  club_affiliations: {
    INSERT: ["PDGLD-57: solicitud de afiliación"],
    AFFILIATION_RESUBMIT: ["PDGLD-60: reenvío de correcciones"],
    AFFILIATION_APPROVE: ["PDGLD-60: revisión de afiliación"],
    AFFILIATION_REQUEST_CORRECTIONS: ["PDGLD-60: revisión de afiliación"],
  },
};
export function reasonLabel(table: keyof typeof auditEntities, action: string, reason: unknown): string {
  const reasons=allowedReasons[table];
  return typeof reason === "string" && reasons && Object.hasOwn(reasons,action) && reasons[action].includes(reason)
    ? reason : "Motivo reservado por privacidad.";
}

function visibleValue(value: unknown) {
  if (value === null || value === undefined) return "Sin valor registrado";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const labels:Record<string,string>={ACTIVE:"Activo",INACTIVE:"Inactivo",INELIGIBLE:"No habilitado",PENDING:"Pendiente",APPROVED:"Aprobado",REJECTED:"Rechazado",RETURNED:"Devuelto",DRAFT:"Borrador",IN_REVIEW:"En revisión",REQUIRED:"Requerida",NOT_REQUIRED:"No requerida",WITHDRAWN:"Retirado",OPEN:"Abierto",CLOSED:"Cerrado"};
    if(labels[value])return labels[value];
  }
  return visibleText(value, "Valor reservado");
}
export function projectChanges(table: keyof typeof auditEntities, before: unknown, after: unknown): AuditChange[] {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const old = record(before), next = record(after);
  return Object.entries(fields[table]).flatMap(([key, field]) => {
    if (!(key in old) && !(key in next)) return [];
    const previous = visibleValue(old[key]), current = visibleValue(next[key]);
    return previous === current ? [] : [{ field, before: previous, after: current }];
  });
}
