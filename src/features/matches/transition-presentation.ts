import { allowedPair } from "./transition-rules";

/** Presentación de acciones ya implementadas; las capacidades proceden del servidor. */
export type MatchActionCapabilities = {
  canSchedule: boolean;
  canRecordMatch: boolean;
  canCancel: boolean;
  canReview?: boolean;
  canResolve?: boolean;
};

const actions = [
  { toStatus: "SCHEDULED", label: "Programar partido", capability: "canSchedule" },
  { toStatus: "CONFIRMED", label: "Confirmar partido con árbitro", capability: "canSchedule" },
  { toStatus: "IN_PROGRESS", label: "Iniciar partido", capability: "canRecordMatch" },
  { toStatus: "SUSPENDED", label: "Suspender partido", capability: "canRecordMatch" },
  { toStatus: "CANCELED", label: "Cancelar partido", capability: "canCancel" },
  { toStatus: "CANCELED", label: "Resolver y cancelar partido", capability: "canResolve" },
  { toStatus: "UNDER_REVIEW", label: "Pasar a revisión", capability: "canReview" },
  { toStatus: "UNSCHEDULED", label: "Dejar partido pendiente", capability: "canSchedule" },
] as const;

export function availableMatchActions(status: string, capabilities: MatchActionCapabilities) {
  return actions.filter(action => capabilities[action.capability] && allowedPair(status, action.toStatus) &&
    (action.capability === "canResolve" ? status === "UNDER_REVIEW" : action.capability !== "canCancel" || status !== "UNDER_REVIEW"));
}
