import { z } from "zod";

export const documentCodes = ["CURP", "PHOTO", "INE", "DRIVER_LICENSE", "PASSPORT", "BIRTH_CERTIFICATE", "STUDENT_ID", "STUDENT_CERTIFICATE", "GUARDIAN_CONSENT"] as const;
const keys = ["CURP", "PLAYER_PHOTO", "PHOTO_IDENTIFICATION", "BIRTH_EVIDENCE", "SCHOOL_EVIDENCE", "GUARDIAN_CONSENT"] as const;
export const categoryDocumentPolicySchema = z.strictObject({
  version: z.literal(1),
  profile: z.enum(["GENERAL", "CHILDREN", "YOUTH", "VETERANS", "PENDING"]),
  status: z.enum(["DRAFT", "APPROVED"]),
  pendingDecisions: z.array(z.enum(["BIRTH_EVIDENCE_TYPES", "ADULT_SIGNATURE_SCOPE", "CATEGORY_DOCUMENT_PROFILE"])).max(3).refine(items => new Set(items).size === items.length),
  activation: z.enum(["ADMINISTRATIVE", "VERIFIED_ADULT_CURP"]),
  requirements: z.array(z.strictObject({
    key: z.enum(keys), audience: z.enum(["ALL", "MINORS", "ADULTS"]),
    anyOf: z.array(z.enum(documentCodes)).max(documentCodes.length).refine(items => new Set(items).size === items.length),
    quantity: z.number().int().min(1).max(4),
    requiredForDossier: z.boolean(), requiredForEligibility: z.boolean(),
  })).min(1).max(18),
}).superRefine((policy, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (policy.status === "APPROVED" && policy.pendingDecisions.length) issue(["status"], "Resuelve las decisiones pendientes antes de aprobar la política.");
  if (policy.status === "APPROVED" && policy.profile === "PENDING") issue(["profile"], "Define el perfil documental de la categoría.");
  const seen = new Set<string>();
  policy.requirements.forEach((rule, index) => {
    const path = ["requirements", index];
    const identity = `${rule.key}:${rule.audience}`;
    if (seen.has(identity)) issue(path, "Requisito repetido para la misma población.");
    seen.add(identity);
    if (policy.requirements.some(other => other !== rule && other.key === rule.key && (other.audience === "ALL" || rule.audience === "ALL"))) issue(path, "Las poblaciones del requisito se superponen.");
    if (!rule.anyOf.length && !(policy.status === "DRAFT" && rule.key === "BIRTH_EVIDENCE" && policy.pendingDecisions.includes("BIRTH_EVIDENCE_TYPES"))) issue([...path, "anyOf"], "Indica los comprobantes aceptados.");
    if (rule.requiredForEligibility && !rule.requiredForDossier) issue(path, "Un requisito para jugar también debe formar parte del expediente.");
    const exact: Partial<Record<typeof keys[number], readonly string[]>> = { CURP: ["CURP"], PLAYER_PHOTO: ["PHOTO"], GUARDIAN_CONSENT: ["GUARDIAN_CONSENT"], SCHOOL_EVIDENCE: ["STUDENT_ID", "STUDENT_CERTIFICATE"] };
    if (exact[rule.key] && (rule.anyOf.length !== exact[rule.key]!.length || !rule.anyOf.every(code => exact[rule.key]!.includes(code)))) issue([...path, "anyOf"], "Los tipos no corresponden a este requisito.");
    if (["CURP", "PLAYER_PHOTO", "SCHOOL_EVIDENCE", "GUARDIAN_CONSENT"].includes(rule.key) && rule.quantity !== 1) issue([...path, "quantity"], "Este requisito utiliza un solo documento.");
    if (rule.key === "PHOTO_IDENTIFICATION" && rule.anyOf.some(code => !["INE", "DRIVER_LICENSE", "PASSPORT"].includes(code))) issue([...path, "anyOf"], "Selecciona identificaciones oficiales autorizadas.");
    if (rule.key === "BIRTH_EVIDENCE" && rule.anyOf.some(code => !["BIRTH_CERTIFICATE", "CURP"].includes(code))) issue([...path, "anyOf"], "Selecciona comprobantes de nacimiento expresamente autorizados.");
    if (["SCHOOL_EVIDENCE", "GUARDIAN_CONSENT"].includes(rule.key) && (rule.audience !== "MINORS" || !rule.requiredForDossier || !rule.requiredForEligibility)) issue(path, "El requisito del menor es obligatorio y requiere revisión.");
    if (rule.key === "PLAYER_PHOTO" && (rule.requiredForDossier || rule.requiredForEligibility)) issue(path, "La foto del jugador permanece opcional.");
    if (rule.key === "CURP" && !rule.requiredForDossier) issue(path, "La constancia CURP se solicita para completar el expediente.");
    if (rule.key === "CURP" && !rule.requiredForEligibility && (rule.audience !== "ADULTS" || policy.activation !== "VERIFIED_ADULT_CURP")) issue(path, "Solo el adulto con CURP verificada puede completar su constancia después de habilitarse.");
  });
});
export type CategoryDocumentPolicy = z.infer<typeof categoryDocumentPolicySchema>;

/** No deduce comprobantes de nacimiento ni edades de Veteranos por sus nombres. */
export function documentPolicyIssues(policy: CategoryDocumentPolicy, categoryType: string, minor: boolean | null) {
  const rules = policy.requirements.filter(rule => rule.audience === "ALL" || (minor === true ? rule.audience === "MINORS" : minor === false && rule.audience === "ADULTS"));
  const issues: string[] = [];
  if (policy.status !== "APPROVED") issues.push("DOCUMENT_POLICY_NOT_APPROVED");
  issues.push(...policy.pendingDecisions);
  if (minor === null) issues.push("UNKNOWN_AGE");
  if (!rules.some(rule => rule.key === "CURP" && rule.requiredForDossier)) issues.push("MISSING_CURP_REQUIREMENT");
  if (minor && !rules.some(rule => rule.key === "SCHOOL_EVIDENCE")) issues.push("MISSING_SCHOOL_REQUIREMENT");
  if (minor && !rules.some(rule => rule.key === "GUARDIAN_CONSENT")) issues.push("MISSING_GUARDIAN_REQUIREMENT");
  if ((categoryType === "OPEN" && policy.profile !== "GENERAL") || (categoryType === "VETERANS" && policy.profile !== "VETERANS") || (categoryType === "YOUTH" && !["CHILDREN", "YOUTH"].includes(policy.profile))) issues.push("CATEGORY_DOCUMENT_PROFILE_REQUIRED");
  if (["CHILDREN", "VETERANS"].includes(policy.profile) && !rules.some(rule => rule.key === "BIRTH_EVIDENCE" && rule.requiredForDossier && rule.requiredForEligibility && rule.anyOf.length)) issues.push("BIRTH_EVIDENCE_POLICY_PENDING");
  return [...new Set(issues)];
}
