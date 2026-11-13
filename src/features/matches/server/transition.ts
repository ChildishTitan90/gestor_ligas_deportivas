import "server-only";
import { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization } from "@/server/auth/authorization";
import { transitionSchema } from "../schemas";
import { assertReplay, assertTransition, MatchTransitionError, receiptDto, type TransitionReceipt } from "../transition-rules";

/** Interno: actorId procede de la sesión; el llamador proporciona una transacción. */
export async function transitionMatchInTransaction(tx: Prisma.TransactionClient, actorId: string, raw: unknown) {
  const parsed = transitionSchema.safeParse(raw);
  if (!parsed.success) throw new MatchTransitionError("INVALID_TRANSITION", 400);
  const input = parsed.data;
  await lockAuthorization(tx);
  // Bloquear actor/asignaciones antes del partido, como el resto de escritores RBAC.
  const refereeAction = input.toStatus === "IN_PROGRESS" || input.toStatus === "SUSPENDED";
  const permissionModule = refereeAction ? "match-reports" : "scheduling";
  const action = input.toStatus === "CANCELED" ? "APPROVE" : "UPDATE";
  await getPermissionGrants(tx, actorId, permissionModule, action);
  // Mismo orden que cierre de temporada: temporada antes de partido.
  const seasons = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT s.id, s.status FROM sports_management.seasons s
    JOIN sports_management.matches m ON m.season_id = s.id
    WHERE m.id = ${input.matchId}::uuid FOR SHARE OF s
  `;
  if (!seasons[0]) throw new AuthorizationError();
  const matches = await tx.$queryRaw<{
    id: string; season_id: string; status_id: string; version: number; deleted_at: Date | null;
    venue_id: string | null; starts_at: Date | null; ends_at: Date | null; reserved_until: Date | null;
  }[]>`
    SELECT m.id, m.season_id, m.status_id, m.version, m.deleted_at,
      m.venue_id, m.starts_at, m.ends_at, m.reserved_until
    FROM sports_management.matches m
    WHERE m.id = ${input.matchId}::uuid FOR UPDATE OF m
  `;
  const match = matches[0];
  if (!match || match.deleted_at || match.season_id !== seasons[0].id) throw new AuthorizationError();
  // Resolver el estado después de adquirir el bloqueo: un JOIN con el catálogo
  // puede desaparecer al esperar una actualización concurrente de status_id.
  const status = await tx.match_statuses.findUniqueOrThrow({ where: { id: match.status_id }, select: { code: true } });
  const grants = (await assertPermission(tx, actorId, {
    module: permissionModule, action, context: { matchId: match.id },
  })).filter(grant => !grant.clubId);
  if (!grants.length) throw new AuthorizationError();
  // La misma asignación debe conceder UPDATE y la transición, nunca combinar ligas/roles.
  const allowed = await tx.$queryRaw<{ id: string; from_code: string; to_id: string }[]>`
    SELECT t.id, f.code AS from_code, t.to_status_id AS to_id FROM sports_management.match_status_transitions t
    JOIN sports_management.match_statuses f ON f.id = t.from_status_id
    JOIN sports_management.match_statuses n ON n.id = t.to_status_id
    WHERE ((f.code = 'DRAFT' AND n.code = 'SCHEDULED') OR (f.code = 'SCHEDULED' AND n.code = 'CONFIRMED')
      OR (f.code = 'CONFIRMED' AND n.code = 'IN_PROGRESS') OR (f.code = 'IN_PROGRESS' AND n.code = 'SUSPENDED')
      OR (f.code IN ('SCHEDULED','CONFIRMED','SUSPENDED') AND n.code = 'CANCELED'))
      AND n.code = ${input.toStatus}
      AND t.role_id IN (${Prisma.join(grants.map(grant => grant.roleId))})
    FOR SHARE OF t, f, n
  `;
  if (!allowed[0]) throw new AuthorizationError();
  const receipts = await tx.$queryRaw<TransitionReceipt[]>`
    SELECT h.id, h.match_id AS "matchId", h.user_id AS "actorId", h.reason,
      h.expected_version AS "expectedVersion", h.created_at AS "createdAt",
      f.code AS "fromStatus", n.code AS "toStatus"
    FROM sports_management.match_status_history h
    JOIN sports_management.match_statuses f ON f.id = h.previous_status_id
    JOIN sports_management.match_statuses n ON n.id = h.new_status_id
    WHERE h.id = ${input.operationId}::uuid
  `;
  if (receipts[0]) {
    assertReplay(receipts[0], actorId, input);
    if (!allowed.some(row => row.from_code === receipts[0].fromStatus)) throw new AuthorizationError();
    return receiptDto(receipts[0], true);
  }
  assertTransition({
    status: status.code, version: match.version, deleted: false, seasonStatus: seasons[0].status,
    venueId: match.venue_id, startsAt: match.starts_at, endsAt: match.ends_at, reservedUntil: match.reserved_until,
  }, input);
  if (!allowed.some(row => row.from_code === status.code)) throw new AuthorizationError();
  if (input.toStatus === "CANCELED") {
    const report = await tx.match_reports.findUnique({ where: { match_id: match.id }, select: { id: true } });
    const result = await tx.match_results.findUnique({ where: { match_id: match.id }, select: { id: true } });
    if (report || result) throw new MatchTransitionError("MATCH_REPORT_EXISTS");
  }
  if (input.toStatus === "CONFIRMED") {
    const referees = await tx.$queryRaw<{ id: string }[]>`
      SELECT ra.id FROM sports_management.referee_assignments ra
      JOIN sports_management.referees r ON r.id = ra.referee_id
      WHERE ra.match_id = ${match.id}::uuid AND ra.assignment_role = 'MAIN'
        AND ra.status = 'APPROVED' AND r.is_active FOR SHARE OF ra, r`;
    if (referees.length !== 1) throw new MatchTransitionError("MAIN_REFEREE_REQUIRED");
  }
  await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true),
    set_config('app.reason', ${input.reason}, true), set_config('app.correlation_id', ${input.operationId}, true)`;
  // El trigger existente audita y reserva cancha/equipos. Si falla, todo revierte.
  await tx.matches.update({ where: { id: match.id }, data: { status_id: allowed[0].to_id, version: { increment: 1 } } });
  const history = await tx.$queryRaw<{ created_at: Date }[]>`
    INSERT INTO sports_management.match_status_history
      (id, match_id, previous_status_id, new_status_id, user_id, reason, expected_version)
    VALUES (${input.operationId}::uuid, ${match.id}::uuid, ${match.status_id}::uuid,
      ${allowed[0].to_id}::uuid, ${actorId}::uuid, ${input.reason}, ${input.expectedVersion})
    RETURNING created_at
  `;
  return receiptDto({ id: input.operationId, matchId: match.id, actorId, fromStatus: status.code,
    toStatus: input.toStatus, expectedVersion: input.expectedVersion, reason: input.reason, createdAt: history[0].created_at }, false);
}
