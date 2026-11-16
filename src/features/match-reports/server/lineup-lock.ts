import "server-only";
import type { Prisma } from "@prisma/client";
import type { ReportDraft, ReportReceipt } from "../contract";
import { lineupFingerprint } from "../lineup-rules";

/** Acuse APPLIED existente, solo INSERT para el rol limitado. Ni draft_data ni
 * un booleano del navegador pueden retirar el bloqueo de la alineación. */
export async function readLineupLock(tx: Prisma.TransactionClient, reportId: string) {
  const row = await tx.match_report_syncs.findFirst({ where: { match_report_id: reportId, status: "APPLIED", private_payload: { path: ["command", "kind"], equals: "lock-lineups" } }, orderBy: [{ received_at: "asc" }, { id: "asc" }], select: { client_id: true, received_at: true, private_payload: true } });
  if (!row) return null;
  const payload = row.private_payload as unknown as { command: { draft: ReportDraft }; receipt: ReportReceipt };
  return { lock: payload.receipt.lineupsLock ?? { operationId: row.client_id, lockedAt: row.received_at.toISOString() }, fingerprint: lineupFingerprint(payload.command.draft) };
}
