import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { playerPolicySchema } from "@/features/competitions/schemas";
import { evaluatePlayerAge } from "@/features/competitions/player-policy";
import type { AgeExceptionState } from "../age-exception";

export const ageExceptionDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function ageExceptionEventId(namespace: string, actor: string, key: string) {
  const hash = ageExceptionDigest([namespace, actor, key]);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
export async function isAgeExceptionCapture(tx: Prisma.TransactionClient, registrationId: string) {
  return !!await tx.audit_logs.findFirst({ where: { entity_id: registrationId, action: "PLAYER_AGE_EXCEPTION_CAPTURED" }, select: { id: true } });
}
const requestReceipt = z.object({ version: z.number().int().positive(), binding: z.string(), documentId: z.uuid(), fileId: z.uuid(), requestHash: z.string() });
const decisionReceipt = z.object({ requestId: z.uuid(), binding: z.string(), documentId: z.uuid(), fileId: z.uuid(), decision: z.enum(["APPROVE", "REJECT"]), requestHash: z.string() });

/** Lectura interna: el consumidor ya autorizó READ sobre este registro. */
export async function readAgeExceptionRecord(tx: Prisma.TransactionClient, registrationId: string, categoryId: string) {
  const registration = await tx.player_registrations.findUniqueOrThrow({ where: { id: registrationId }, select: {
    id: true, status: true, withdrawn_at: true, authorized_by: true, age_exception_file_id: true, age_exception_reason: true,
    people: { select: { identity_version: true, birth_date: true } },
  } });
  const category = await tx.season_categories.findUniqueOrThrow({ where: { id: categoryId }, select: { player_policy: true, eligibility_pending: true } });
  const parsed = playerPolicySchema.safeParse(category.player_policy);
  const age = parsed.success ? evaluatePlayerAge(parsed.data, registration.people.birth_date?.toISOString().slice(0, 10) ?? "") : null;
  const events = await tx.audit_logs.findMany({ where: { entity_id: registrationId,
    action: { in: ["PLAYER_DOCUMENT_CONFIRMED", "PLAYER_AGE_EXCEPTION_CAPTURED", "PLAYER_AGE_EXCEPTION_REQUESTED", "PLAYER_AGE_EXCEPTION_DECIDED"] } },
    select: { id: true, user_id: true, action: true, reason: true, new_data: true } });
  const captured = events.some(e => e.action === "PLAYER_AGE_EXCEPTION_CAPTURED");
  const revisions = events.filter(e => e.action === "PLAYER_DOCUMENT_CONFIRMED").map(e => e.new_data as {
    documentId: string; replacesDocumentId: string | null; identityVersion: number;
  });
  const replaced = new Set(revisions.map(r => r.replacesDocumentId));
  const current = revisions.filter(r => r.identityVersion === registration.people.identity_version && !replaced.has(r.documentId)).map(r => r.documentId);
  const documents = await tx.player_documents.findMany({ where: { registration_id: registrationId, id: { in: current }, document_types: { code: "AGE_EXCEPTION_LETTER" } },
    select: { id: true, file_id: true, status: true, files: { select: { sha256: true, size_bytes: true } } } });
  const document = documents.length === 1 && documents[0].files.sha256 ? documents[0] : null;
  const binding = ageExceptionDigest([registrationId, categoryId, category.player_policy, category.eligibility_pending,
    registration.people.identity_version, registration.people.birth_date?.toISOString(),
    document ? [document.id, document.file_id, document.files.sha256, document.files.size_bytes.toString()] : null]);
  const requests = events.filter(e => e.action === "PLAYER_AGE_EXCEPTION_REQUESTED").flatMap(e => {
    const parsed = requestReceipt.safeParse(e.new_data);
    return parsed.success ? [{ ...e, data: parsed.data }] : [];
  }).sort((a, b) => b.data.version - a.data.version);
  const request = requests[0] ?? null;
  const decisions = events.filter(e => e.action === "PLAYER_AGE_EXCEPTION_DECIDED").flatMap(e => {
    const parsed = decisionReceipt.safeParse(e.new_data);
    return parsed.success && parsed.data.requestId === request?.id ? [{ ...e, data: parsed.data }] : [];
  });
  const decision = decisions.length === 1 ? decisions[0] : null;
  const applicable = captured && age?.status === "REQUIRES_ADMIN_APPROVAL" && !category.eligibility_pending;
  const validApproval = !!(applicable && document && request && decision?.data.decision === "APPROVE" &&
    request.data.binding === binding && decision.data.binding === binding &&
    document.status === "VALIDATED" && registration.authorized_by === decision.user_id &&
    registration.age_exception_file_id === document.file_id && registration.age_exception_reason === decision.reason);
  let status: AgeExceptionState["status"] = !captured ? "NOT_REQUIRED" : !applicable ? "UNAVAILABLE" :
    !request ? "DRAFT" : request.data.binding !== binding ? "STALE" :
    decision?.data.decision === "REJECT" ? "REJECTED" : validApproval ? "APPROVED" : decision ? "STALE" : "PENDING";
  if (captured && (registration.withdrawn_at || registration.status !== "INELIGIBLE" && registration.status !== "ACTIVE")) status = "UNAVAILABLE";
  const fingerprint = ageExceptionDigest([binding, request?.id, decision?.id, status]);
  return { registration, applicable, captured, binding, fingerprint, document, request, decision, status,
    version: request?.data.version ?? 0, validApproval,
    rule: parsed.success ? { referenceYear: parsed.data.referenceYear, minimumAge: parsed.data.minimumAge, maximumAge: parsed.data.maximumAge,
      exceptionMinimumAge: parsed.data.exceptionMinimumAge, registrationDays: parsed.data.registrationDays, timezone: parsed.data.timezone } : null };
}

export async function ageExceptionDocumentRequirement(tx: Prisma.TransactionClient, registrationId: string, categoryId: string) {
  if (!await isAgeExceptionCapture(tx, registrationId)) return null;
  const type = await tx.document_types.findUnique({ where: { code: "AGE_EXCEPTION_LETTER" }, select: { id: true, code: true, name: true } });
  if (!type) return null;
  return { id: ageExceptionEventId("age-exception-requirement:v1", categoryId, type.id), season_category_id: categoryId,
    document_type_id: type.id, quantity: 1, is_required: true, document_types: { name: type.name, code: type.code } };
}
