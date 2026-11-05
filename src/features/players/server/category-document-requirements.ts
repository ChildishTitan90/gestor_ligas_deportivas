import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { playerPolicySchema } from "@/features/competitions/schemas";
import { documentCodes, documentPolicyIssues, type CategoryDocumentPolicy } from "@/features/competitions/document-policy";
import { minorDocumentCodes, minorDocumentRequirements, minorRequirementId } from "./minor-document-requirements";
import { optionalPlayerPhotoRequirement, requiredPlayerCurpRequirement, playerPhotoRequirementId, playerCurpRequirementId } from "./player-photo-requirement";
import {readIdentityDocumentEvidence} from "./identity-document-evidence";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type ResolvedRequirement = { id: string; season_category_id: string; document_type_id: string; quantity: number; is_required: boolean; document_types: { name: string; code: string } };
export type ResolvedDocumentGroup = { categoryName?: string; categoryId?: string; scope?: "ORIGIN"|"SUPERIOR"; key: string; typeIds: string[]; quantity: number; requiredForDossier: boolean; requiredForEligibility: boolean };
export type ResolvedDocuments = { requirements: ResolvedRequirement[]; groups: ResolvedDocumentGroup[]; issues: string[]; approved: boolean; fingerprint: string | null; activation: CategoryDocumentPolicy["activation"] };

function requirementId(categoryId: string, code: string) {
  if (code === "PHOTO") return playerPhotoRequirementId(categoryId);
  if (code === "CURP") return playerCurpRequirementId(categoryId);
  if (minorDocumentCodes.includes(code)) return minorRequirementId(categoryId, code);
  const h = digest(["category-document:v1", categoryId, code]);
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

/** Única resolución para consulta, preparación, confirmación y habilitación.
 * El consumidor autoriza el contexto y mantiene su transacción abierta. */
export async function resolveCategoryDocuments(tx: Prisma.TransactionClient, categoryId: string, minor: boolean | null): Promise<ResolvedDocuments> {
  await tx.$queryRaw`SELECT id FROM sports_management.season_categories WHERE id=${categoryId}::uuid FOR SHARE`;
  const category = await tx.season_categories.findUniqueOrThrow({ where: { id: categoryId }, select: { type: true, eligibility_pending: true, player_policy: true } });
  const configured = await tx.document_requirements.findMany({ where: { season_category_id: categoryId }, select: { id: true, season_category_id: true, document_type_id: true, quantity: true, is_required: true, document_types: { select: { name: true, code: true } } }, orderBy: { id: "asc" } });
  const parsed = playerPolicySchema.safeParse(category.player_policy);
  if (!parsed.success || Array.isArray(parsed.data.documents)) {
    // Compatibilidad de cargas y sus IDs; esta configuración histórica no se
    // interpreta como aprobación de las reglas aclaradas por el profesor.
    const requirements: ResolvedRequirement[] = configured.filter(r => !minorDocumentCodes.includes(r.document_types.code) || minor === true);
    if (minor) requirements.push(...await minorDocumentRequirements(tx, categoryId));
    for (const [code, read] of [["CURP", requiredPlayerCurpRequirement], ["PHOTO", optionalPlayerPhotoRequirement]] as const) {
      if (!requirements.some(r => r.document_types.code === code)) { const row = await read(tx, categoryId); if (row) requirements.push(row); }
    }
    const groups = requirements.filter(r => !["STUDENT_ID", "STUDENT_CERTIFICATE"].includes(r.document_types.code)).map(r => ({ key: r.document_types.code, typeIds: [r.document_type_id], quantity: r.quantity, requiredForDossier: r.is_required, requiredForEligibility: r.is_required }));
    if (minor) groups.push({ key: "SCHOOL_EVIDENCE", typeIds: requirements.filter(r => ["STUDENT_ID", "STUDENT_CERTIFICATE"].includes(r.document_types.code)).map(r => r.document_type_id), quantity: 1, requiredForDossier: true, requiredForEligibility: true });
    const issues = ["DOCUMENT_POLICY_REVIEW_REQUIRED"];
    if (minor === null) issues.push("UNKNOWN_AGE");
    if (requirements.some(r => !(documentCodes as readonly string[]).includes(r.document_types.code))) issues.push("UNSUPPORTED_REQUIREMENT");
    if (requirements.some(r => r.document_types.code === "PHOTO" && (r.is_required || r.quantity !== 1))) issues.push("PHOTO_POLICY_REQUIRES_REVIEW");
    return { requirements, groups, issues, approved: false, fingerprint: null, activation: "ADMINISTRATIVE" };
  }
  const policy = parsed.data.documents;
  const issues = documentPolicyIssues(policy, category.type, minor);
  if (category.eligibility_pending) issues.push("CATEGORY_ELIGIBILITY_PENDING");
  const rules = policy.requirements.filter(r => r.audience === "ALL" || (minor === true ? r.audience === "MINORS" : minor === false && r.audience === "ADULTS"));
  const codes = [...new Set(rules.flatMap(r => r.anyOf))];
  const types = await tx.document_types.findMany({ where: { code: { in: codes } }, select: { id: true, code: true, name: true } });
  if (types.length !== codes.length) issues.push("DOCUMENT_TYPES_NOT_CONFIGURED");
  const requirements = types.map(type => {
    const relevant = rules.filter(r => r.anyOf.includes(type.code as typeof documentCodes[number]));
    return { id: configured.find(r => r.document_type_id === type.id)?.id ?? requirementId(categoryId, type.code), season_category_id: categoryId, document_type_id: type.id,
      quantity: Math.max(...relevant.map(r => r.quantity)), is_required: relevant.some(r => r.requiredForDossier && r.anyOf.length === 1), document_types: { code: type.code, name: type.name } };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const groups = rules.map(rule => ({ key: rule.key, typeIds: types.filter(t => rule.anyOf.includes(t.code as typeof documentCodes[number])).map(t => t.id), quantity: rule.quantity, requiredForDossier: rule.requiredForDossier, requiredForEligibility: rule.requiredForEligibility }));
  return { requirements, groups, issues: [...new Set(issues)], approved: issues.length === 0, fingerprint: digest([category.player_policy, category.type, category.eligibility_pending]), activation: policy.activation };
}

export async function readCategoryDocumentState(tx: Prisma.TransactionClient, registrationId: string, identityVersion: number, policy: ResolvedDocuments) {
  const identityEvidence=await readIdentityDocumentEvidence(tx,registrationId);
  const ineType=policy.requirements.find(r=>r.document_types.code==="INE")?.document_type_id;
  const documents = await tx.player_documents.findMany({ where: { registration_id: registrationId }, select: { id: true, document_type_id: true, status: true }, orderBy: { id: "asc" } });
  const events = await tx.audit_logs.findMany({ where: { entity_id: registrationId, action: "PLAYER_DOCUMENT_CONFIRMED" }, select: { new_data: true } });
  const revisions = events.map(e => e.new_data as { documentId: string; replacesDocumentId: string | null; identityVersion: number; requirementId?: string; slot?: number });
  const superseded = new Set(revisions.map(r => r.replacesDocumentId));
  const current = revisions.filter(r => r.identityVersion === identityVersion && !superseded.has(r.documentId));
  const confirmed = new Set(current.map(r => r.documentId));
  const reviews = await tx.audit_logs.findMany({ where: { entity_id: registrationId, action: "PLAYER_DOCUMENT_REVIEWED" }, select: { new_data: true } });
  const attestations = reviews.map(r => r.new_data as { documentId: string; identityVersion: number; guardianAccredited: boolean });
  const guardianType = policy.requirements.find(r => r.document_types.code === "GUARDIAN_CONSENT")?.document_type_id;
  const guardianAccredited = documents.some(d => d.document_type_id === guardianType && confirmed.has(d.id) && d.status === "VALIDATED" && attestations.some(a => a.documentId === d.id && a.identityVersion === identityVersion && a.guardianAccredited === true));
  const groups = policy.groups.map(rule => {
    const relevant = documents.filter(d => confirmed.has(d.id) && rule.typeIds.includes(d.document_type_id));
    const approved = relevant.filter(d => d.status === "VALIDATED").length;
    const verificationId=rule.quantity===1 && ["PHOTO_IDENTIFICATION","INE"].includes(rule.key) && ineType && rule.typeIds.includes(ineType) ? identityEvidence.ine?.attemptId ?? null : null;
    const ready = (approved >= rule.quantity || verificationId!==null) && (rule.key !== "GUARDIAN_CONSENT" || guardianAccredited);
    return { ...rule, recorded: relevant.filter(d => d.status !== "REJECTED").length, approved, ready, verificationId };
  });
  return { documents, revisions, confirmed, superseded, guardianAccredited, groups, identityEvidence,
    dossierComplete: policy.approved && groups.every(g => !g.requiredForDossier || g.ready),
    eligibilityDocumentsComplete: policy.approved && groups.every(g => !g.requiredForEligibility || g.ready) };
}
