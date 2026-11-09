import "server-only";
import {requireOperationalUser} from "@/server/auth/session";
import {getAgeExceptionQueueForActor} from "./age-exception-service";
import { getIdentityReviewQueue } from "./identity-review";
import { getIneReviewQueue } from "./ine-verification-service";
import { getDocumentReviewQueue } from "./document-review";
import type { PlayerReviewItem } from "../review-workspace";

export async function getPlayerReviewWorkspace(): Promise<PlayerReviewItem[]> {
  const ageExceptions = await getAgeExceptionQueueForActor((await requireOperationalUser()).id);
  const identities = await getIdentityReviewQueue();
  const ine = await getIneReviewQueue();
  const documents = await getDocumentReviewQueue();
  return [
    ...ageExceptions.map(row => ({ ...row, kind: "AGE_EXCEPTION" as const, reason: "Carta y motivo de excepción de edad pendientes de decisión por Secretaría." })),
    ...identities.map(row => ({ ...row, kind: "IDENTITY" as const, reason: "Nombre o fecha de nacimiento similares a otra identidad. Requiere comparación." })),
    ...ine.map(({ status, ...row }) => ({ ...row, kind: "INE" as const, reason: status === "ADMIN_REVIEW_REQUIRED" ? "Fotos o datos requieren revisión administrativa." : "La consulta no tiene un resultado vigente. Revisa el acuse antes de continuar." })),
    ...documents.map(({ pendingCount, guardianPending, ...row }) => ({ ...row, kind: "DOCUMENTS" as const, reason: `${pendingCount} ${pendingCount === 1 ? "documento vigente pendiente" : "documentos vigentes pendientes"} de revisión.${guardianPending ? " Incluye autorización del tutor por acreditar." : ""}` })),
  ].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt) || a.id.localeCompare(b.id) || a.kind.localeCompare(b.kind));
}
