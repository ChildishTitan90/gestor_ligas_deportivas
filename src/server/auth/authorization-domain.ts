import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { AuthorizationError, lockAuthorization } from "./authorization";

/** Additional RF22 ownership predicates; they never grant a permission on their own. */
export async function assertOwnRefereeAssignment(tx: Prisma.TransactionClient, actorId: string, matchId: string) {
  if (!z.uuid().safeParse(actorId).success || !z.uuid().safeParse(matchId).success) throw new AuthorizationError();
  await lockAuthorization(tx);
  const assignments = await tx.$queryRaw<{ id: string }[]>`
    SELECT ra.id FROM sports_management.referee_assignments ra
    JOIN sports_management.referees r ON r.id = ra.referee_id
    JOIN sports_management.users u ON u.person_id = r.person_id
    JOIN sports_management.matches m ON m.id = ra.match_id
    WHERE u.id = ${actorId}::uuid AND u.is_active AND NOT u.must_change_password
      AND (u.locked_until IS NULL OR u.locked_until <= clock_timestamp())
      AND ra.match_id = ${matchId}::uuid AND ra.status = 'APPROVED' AND r.is_active AND m.deleted_at IS NULL
    FOR SHARE OF ra, r, u, m
  `;
  if (!assignments.length) throw new AuthorizationError();
}

export async function assertOwnPlayerRegistration(
  tx: Prisma.TransactionClient, actorId: string, registrationId: string,
) {
  if (!z.uuid().safeParse(actorId).success || !z.uuid().safeParse(registrationId).success) throw new AuthorizationError();
  await lockAuthorization(tx);
  const registrations = await tx.$queryRaw<{ id: string }[]>`
    SELECT pr.id FROM sports_management.player_registrations pr
    JOIN sports_management.users u ON u.person_id = pr.person_id
    WHERE pr.id = ${registrationId}::uuid AND u.id = ${actorId}::uuid AND u.is_active
      AND NOT u.must_change_password AND (u.locked_until IS NULL OR u.locked_until <= clock_timestamp())
    FOR SHARE OF pr, u
  `;
  if (!registrations.length) throw new AuthorizationError();
}

export type SeparationOfDutiesRequest =
  | { kind: "schedule-publication"; proposalId: string }
  | { kind: "disciplinary-resolution"; caseId: string }
  | { kind: "charge-approval"; chargeId: string };

/**
 * The resource ID must be derived by the domain service from the operation being
 * performed. This check complements assertPermission in the same transaction.
 */
export async function assertSeparationOfDuties(
  tx: Prisma.TransactionClient, actorId: string, request: SeparationOfDutiesRequest,
) {
  const schema = z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("schedule-publication"), proposalId: z.uuid() }),
    z.strictObject({ kind: z.literal("disciplinary-resolution"), caseId: z.uuid() }),
    z.strictObject({ kind: z.literal("charge-approval"), chargeId: z.uuid() }),
  ]);
  if (!z.uuid().safeParse(actorId).success || !schema.safeParse(request).success) throw new AuthorizationError();
  await lockAuthorization(tx);
  const actor = await tx.$queryRaw<{ personId: string }[]>`
    SELECT person_id AS "personId" FROM sports_management.users
    WHERE id = ${actorId}::uuid AND is_active AND NOT must_change_password
      AND (locked_until IS NULL OR locked_until <= clock_timestamp()) FOR SHARE
  `;
  if (!actor.length) throw new AuthorizationError();
  let authors: { personId: string }[];
  if (request.kind === "schedule-publication") {
    authors = await tx.$queryRaw<{ personId: string }[]>`
      SELECT u.person_id AS "personId" FROM sports_management.schedule_proposals p
      JOIN sports_management.users u ON u.id = p.created_by
      WHERE p.id = ${request.proposalId}::uuid FOR SHARE OF p, u
    `;
  } else if (request.kind === "disciplinary-resolution") {
    authors = await tx.$queryRaw<{ personId: string }[]>`
      SELECT u.person_id AS "personId" FROM sports_management.disciplinary_cases dc
      JOIN sports_management.match_events me ON me.id = dc.event_id
      JOIN sports_management.match_reports mr ON mr.id = me.match_report_id
      JOIN sports_management.users u ON u.id = mr.captured_by
      WHERE dc.id = ${request.caseId}::uuid FOR SHARE OF dc, me, mr, u
    `;
  } else {
    // RF22.6 requires payment evidence; it does not categorically prohibit the
    // creator or payment recorder from acting once that evidence exists.
    const charge = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sports_management.charges
      WHERE id = ${request.chargeId}::uuid FOR UPDATE
    `;
    if (!charge.length) throw new AuthorizationError();
    // Lock referenced payments before checking voids in a fresh statement:
    // an in-progress void must finish first, and a new void waits for commit.
    await tx.$queryRaw`
      SELECT id FROM sports_management.payments WHERE charge_id = ${request.chargeId}::uuid FOR UPDATE
    `;
    const payments = await tx.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM sports_management.payments p
      WHERE p.charge_id = ${request.chargeId}::uuid
        AND NOT EXISTS (SELECT 1 FROM sports_management.payment_voids pv WHERE pv.payment_id = p.id)
    `;
    if (!payments.length) throw new AuthorizationError();
    return;
  }
  if (!authors.length || authors.some((author) => author.personId === actor[0].personId)) throw new AuthorizationError();
}
