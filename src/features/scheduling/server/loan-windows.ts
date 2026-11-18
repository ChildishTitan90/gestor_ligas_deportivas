import "server-only";
import { Prisma } from "@prisma/client";
import { parseLoanWindows } from "../loan-windows";

/** Lectura acotada del contrato PDGLD-23 dentro de la transacción autorizada.
 * SQL explícito permite compilar antes de incorporar su cliente Prisma generado.
 * Requiere la migración 20261115010000_pdgld23_venue_loan_requests. */
export async function loadApprovedLoanWindows(tx: Prisma.TransactionClient, seasonId: string, clubIds: string[]) {
  const rows = await tx.$queryRaw<{ id: string; venue_id: string; club_id: string; requested_windows: unknown }[]>`
    SELECT id, venue_id, club_id, requested_windows
    FROM sports_management.venue_loans
    WHERE season_id = ${seasonId}::uuid AND club_id IN (${Prisma.join(clubIds.map(id => Prisma.sql`${id}::uuid`))})
      AND status = 'APPROVED' AND requested_by IS NOT NULL
      AND approved_by IS NOT NULL AND approved_at IS NOT NULL`;
  return rows.map(row => ({ id: row.id, venueId: row.venue_id, clubId: row.club_id,
    windows: parseLoanWindows(row.requested_windows) }));
}
