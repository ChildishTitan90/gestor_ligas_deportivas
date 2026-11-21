import "server-only";
import { z } from "zod";
import { AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { getVenueLoanScopes } from "./loan-workspace";
import { getPrisma } from "@/server/db/prisma";
import type { PrivateDocumentTransport } from "@/server/files/private-document-storage";
import { createVenueLoanLetterStorage, VENUE_LOAN_LETTER_PREFIX } from "./loan-storage";

const contextSchema = z.object({ leagueId: z.uuid(), seasonId: z.uuid(), clubId: z.uuid() }).strict();

/** Repite la limpieza de capturas canceladas. Las bajas se verifican en cada ejecución. */
export async function cleanCancelledVenueLoanFiles(storage?: PrivateDocumentTransport, actorId?: string) {
  const db = getPrisma();
  const transport = storage ?? createVenueLoanLetterStorage();
  if (!transport.remove) throw new Error("VENUE_LOAN_CLEANUP_UNAVAILABLE");
  if (actorId) {
    const allowed = await db.$transaction(async tx => {
      const { presidents } = await getVenueLoanScopes(tx, actorId);
      return presidents.length > 0;
    });
    if (!allowed) throw new AuthorizationError();
  }
  let cursor: string | undefined;
  let cleaned = 0;
  let failed = 0;
  do {
    const rows = await db.audit_logs.findMany({
      where: { action: "VENUE_LOAN_CLEANUP_SCHEDULED", table_name: "venue_loans" },
      orderBy: { id: "asc" }, take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, entity_id: true, user_id: true, new_data: true },
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    for (const row of rows) {
      const context = contextSchema.safeParse(row.new_data);
      const requestId = z.uuid().safeParse(row.entity_id);
      const requesterId = z.uuid().safeParse(row.user_id);
      if (!context.success || !requestId.success || !requesterId.success) { if (!actorId) failed++; continue; }
      try {
        const didClean = await db.$transaction(async tx => {
          if (actorId) {
            await lockAuthorization(tx);
            const { presidents } = await getVenueLoanScopes(tx, actorId);
            if (!presidents.some(grant => (!grant.leagueId || grant.leagueId === context.data.leagueId) &&
              (!grant.clubId || grant.clubId === context.data.clubId))) return false;
          }
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${requestId.data}, 2301))`;
          const cancelled = await tx.audit_logs.findFirst({ where: {
            action: "VENUE_LOAN_CAPTURE_CANCELLED", table_name: "venue_loans",
            entity_id: requestId.data, user_id: requesterId.data,
          }, select: { id: true } });
          const existing = await tx.venue_loans.findUnique({ where: { id: requestId.data }, select: { id: true } });
          const affiliation = await tx.club_affiliations.findFirst({ where: {
            league_id: context.data.leagueId, season_id: context.data.seasonId, club_id: context.data.clubId,
          }, select: { id: true } });
          if (!cancelled || existing || !affiliation) throw new Error("VENUE_LOAN_CLEANUP_CONTEXT_INVALID");
          const key = `${VENUE_LOAN_LETTER_PREFIX}/v1/${context.data.leagueId}/${context.data.seasonId}/${context.data.clubId}/${requesterId.data}/${requestId.data}`;
          await transport.remove!(key);
          return true;
        }, { timeout: 90000 });
        if (didClean) cleaned++;
      } catch {
        failed++;
      }
    }
  } while (true);
  return { cleaned, failed };
}
