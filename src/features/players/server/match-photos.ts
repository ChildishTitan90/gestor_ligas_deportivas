import "server-only";
import type { Prisma } from "@prisma/client";

/** Contrato de lectura para consumidores que ya autorizaron el partido y sus
 * inscripciones. Solo fotos aprobadas, confirmadas y de la identidad vigente;
 * nunca devuelve expedientes, CURP ni URLs de Storage al navegador. */
export async function currentPlayerPhotos(tx: Prisma.TransactionClient, registrationIds: string[]) {
  const result = new Map<string, { documentId: string; identityVersion: number; file: { id: string; storage_key: string; sha256: string | null; size_bytes: bigint; mime_type: string } }>();
  if (!registrationIds.length) return result;
  const documents = await tx.player_documents.findMany({ where: { registration_id: { in: registrationIds }, document_types: { code: "PHOTO" }, status: "VALIDATED" }, select: { id: true, registration_id: true, player_registrations: { select: { people: { select: { identity_version: true } } } }, files: { select: { id: true, storage_key: true, sha256: true, size_bytes: true, mime_type: true } } } });
  const receipts = await tx.audit_logs.findMany({ where: { entity_id: { in: registrationIds }, action: "PLAYER_DOCUMENT_CONFIRMED" }, select: { entity_id: true, new_data: true }, orderBy: [{ occurred_at: "desc" }, { id: "desc" }] });
  const replaced = new Set(receipts.map(r => (r.new_data as { replacesDocumentId?: string }).replacesDocumentId));
  for (const receipt of receipts) {
    const evidence = receipt.new_data as { documentId?: string; fileId?: string; identityVersion?: number };
    const doc = documents.find(d => d.registration_id === receipt.entity_id && d.id === evidence.documentId && d.files.id === evidence.fileId);
    if (!doc || result.has(doc.registration_id) || replaced.has(doc.id) || evidence.identityVersion !== doc.player_registrations.people.identity_version || !doc.files.sha256 || !["image/png", "image/jpeg"].includes(doc.files.mime_type)) continue;
    result.set(doc.registration_id, { documentId: doc.id, identityVersion: evidence.identityVersion, file: doc.files });
  }
  return result;
}
