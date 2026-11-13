import { allowedPair } from "./transition-rules";

/** Presentación de acciones ya implementadas; las capacidades proceden del servidor. */
export type MatchActionCapabilities = {
  canSchedule: boolean;
  canRecordMatch: boolean;
  canCancel: boolean;
};

const actions = [
  { toStatus: "SCHEDULED", label: "Programar partido", capability: "canSchedule" },
  { toStatus: "CONFIRMED", label: "Confirmar partido", capability: "canSchedule" },
  { toStatus: "IN_PROGRESS", label: "Iniciar partido", capability: "canRecordMatch" },
  { toStatus: "SUSPENDED", label: "Suspender partido", capability: "canRecordMatch" },
  { toStatus: "CANCELED", label: "Cancelar partido", capability: "canCancel" },
] as const;

export function availableMatchActions(status: string, capabilities: MatchActionCapabilities) {
  return actions.filter(action => capabilities[action.capability] && allowedPair(status, action.toStatus));
}
