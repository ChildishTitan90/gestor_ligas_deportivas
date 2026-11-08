import { z } from "zod";

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(1).max(1000);
export const admissionRuleSchema = z.object({ referenceYear: z.number().int(), minimumAge: z.number().int(), maximumAge: z.number().int().nullable(),
  exceptionMinimumAge: z.number().int().nullable(), registrationDays: z.array(z.number().int().min(1).max(7)), timezone: z.string() });
export type AdmissionRule = z.infer<typeof admissionRuleSchema>;
export function describeAdmissionRule(rule: AdmissionRule) {
  const days = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
  return `Regla vigente: año de referencia ${rule.referenceYear}; edad ordinaria desde ${rule.minimumAge}${rule.maximumAge === null ? " años, sin máximo" : ` hasta ${rule.maximumAge} años`}; altas: ${rule.registrationDays.map(day => days[day - 1]).join(", ")} (${rule.timezone}).${rule.exceptionMinimumAge === null ? " No hay margen excepcional configurado." : ` El mínimo excepcional es ${rule.exceptionMinimumAge} años y requiere decisión de Secretaría.`}`;
}
export const ageExceptionRequestSchema = z.strictObject({
  action: z.literal("REQUEST"), operationKey: z.uuid(), fingerprint,
  documentId: z.uuid(), reason,
});
export const ageExceptionDecisionSchema = z.strictObject({
  action: z.literal("DECIDE"), operationKey: z.uuid(), fingerprint,
  requestId: z.uuid(), decision: z.enum(["APPROVE", "REJECT"]), reason,
});
export const ageExceptionCommandSchema = z.discriminatedUnion("action", [ageExceptionRequestSchema, ageExceptionDecisionSchema]);
export const ageExceptionStateSchema = z.object({
  registrationId: z.uuid(), applicable: z.boolean(),
  status: z.enum(["NOT_REQUIRED", "DRAFT", "PENDING", "APPROVED", "REJECTED", "STALE", "UNAVAILABLE"]),
  fingerprint, requestId: z.uuid().nullable(), documentId: z.uuid().nullable(),
  requestReason: z.string().nullable(), decisionReason: z.string().nullable(),
  canRequest: z.boolean(), canReview: z.boolean(),
  rule: admissionRuleSchema.nullable(),
});
export type AgeExceptionState = z.infer<typeof ageExceptionStateSchema>;

export const ageExceptionMessages: Record<string, string> = {
  AGE_EXCEPTION_NOT_APPLICABLE: "La edad no corresponde al margen de excepción configurado. Revisa la categoría y el nacimiento.",
  AGE_EXCEPTION_DOCUMENT_REQUIRED: "Carga y confirma la carta de excepción de edad en este expediente antes de solicitar la revisión.",
  AGE_EXCEPTION_STALE: "Cambió la petición, la identidad, la carta o la política. Actualiza el estado antes de continuar.",
  AGE_EXCEPTION_CONFLICT: "Esta petición ya tiene una decisión o existe otro envío. Consulta su estado antes de continuar.",
};
