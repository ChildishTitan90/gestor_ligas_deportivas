import { z } from "zod";
import { playerIdentitySchema } from "./schemas";
export const correctionEvidenceKinds = ["CURP_CERTIFICATE", "CIVIL_RECORD", "LINK_DOCUMENT"] as const;
export const correctionRequestSchema = z.strictObject({ operationKey: z.uuid(), expectedIdentityVersion: z.number().int().positive(), identity: playerIdentitySchema,
    reason: z.string().trim().min(10).max(500), identityDoubt: z.boolean() });
export const correctionDecisionSchema = z.strictObject({ operationKey: z.uuid(), decision: z.enum(["APPLY", "RETURN"]), observations: z.string().trim().min(10).max(500),
    evidenceChecked: z.boolean(), samePersonChecked: z.boolean(), curpDiscrepancy: z.boolean() });
export type CorrectionIdentity = z.output<typeof playerIdentitySchema>;
export type CorrectionWorkspace = {
    registrationId: string;
    identity: CorrectionIdentity;
    identityVersion: number;
    canRequest: boolean;
    canReview: boolean;
    applyBlockedCode: string | null;
    requests: {
        id: string;
        status: string;
        own: boolean;
        identity: CorrectionIdentity;
        reason: string;
        observations: string | null;
        createdAt: string;
        reviewedAt: string | null;
        evidence: {
            id: string;
            kind: string;
            mimeType: string;
        }[];
    }[];
};
export function requiredCorrectionEvidence(before: CorrectionIdentity, after: CorrectionIdentity, doubt: boolean, discrepancy = false) {
    const kinds: string[] = [];
    if (before.curp !== after.curp || discrepancy)
        kinds.push("CURP_CERTIFICATE");
    if (before.firstName !== after.firstName || before.paternalSurname !== after.paternalSurname || before.maternalSurname !== after.maternalSurname || before.birthDate !== after.birthDate)
        kinds.push("CIVIL_RECORD");
    if (doubt)
        kinds.push("LINK_DOCUMENT");
    return kinds;
}
export const correctionMessages: Record<string, string> = { HISTORY_PROTECTION_UNAVAILABLE: "La protección del historial no está conectada. Puedes solicitar o devolver; aplicar permanece deshabilitado.", FORBIDDEN: "No tienes permiso sobre todas las referencias afectadas. Solicita revisión a una autoridad con alcance suficiente.",
    SELF_APPROVAL: "No puedes resolver tu propia solicitud.", EVIDENCE_INCOMPLETE: "La evidencia o su comprobación están incompletas. Devuelve la solicitud con observaciones.",
    HISTORICAL_IDENTITY_UNAVAILABLE: "La persona tiene referencias en temporadas cerradas sin identidad histórica acreditada. La corrección no se aplicó; requiere decisión del equipo.",
    IDENTITY_CHANGED: "La identidad cambió. Consulta el estado y prepara una solicitud nueva.", DUPLICATE_CURP: "La CURP propuesta no está disponible. No se modificó el expediente.",
    CORRECTION_CONFLICT: "La solicitud ya fue resuelta o la operación no coincide. Consulta el estado antes de volver a decidir.", PAYLOAD_TOO_LARGE: "Los documentos superan el tamaño permitido.", FILE_TOO_LARGE: "Cada documento admite hasta 10 MiB.", INVALID_FILE: "El archivo no es un PDF, PNG o JPEG válido.", VALIDATION_ERROR: "Revisa la identidad, motivo y documentos.", SERVICE_UNAVAILABLE: "No se pudo confirmar el resultado. Consulta la solicitud sin reenviar automáticamente." };
