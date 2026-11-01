import "server-only";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { teamEnrollmentSchema } from "../team-enrollment";
import { assertEnrollmentActor, assertEnrollmentPermission, lockEnrollmentCategory, lockEnrollmentSeason, TeamEnrollmentError } from "./team-enrollment-access";

import { enrollmentFingerprint, enrollmentResult, enrollmentSelect, findEnrollmentOperation, lockEnrollmentOperation } from "./team-enrollment-record";

export async function enrollTeam(input: unknown, expectedActorId?: string) {
  const actor = await requireOperationalUser();
  assertEnrollmentActor(actor.id, expectedActorId);
  const parsed = teamEnrollmentSchema.safeParse(input);
  if (!parsed.success) throw new TeamEnrollmentError("VALIDATION_ERROR");
  const data = parsed.data;
  const fingerprint = enrollmentFingerprint(data);

  try {
    return await getPrisma().$transaction(async (tx) => {
      await assertEnrollmentPermission(tx, actor.id, data.clubId);
      await lockEnrollmentOperation(tx, actor.id, data.enrollmentKey);
      const prior = await findEnrollmentOperation(tx, actor.id, data.enrollmentKey);
      if (prior) {
        if ((prior.fingerprint && prior.fingerprint !== fingerprint) || prior.club_id !== data.clubId) throw new TeamEnrollmentError("IDEMPOTENCY_CONFLICT", 409);
        if (prior.outcome === "CANCELLED") throw new TeamEnrollmentError("OPERATION_CANCELLED", 409);
        // Recuperar un resultado confirmado no escribe ni vuelve a habilitarlo.
        // Se exigen sesión, permiso y club vigentes incluso en este caso.
        if (!prior.season_teams) throw new Error("Invalid enrollment operation");
        return enrollmentResult(prior.season_teams, true);
      }
      const season = await lockEnrollmentSeason(tx, data.clubId, data.seasonId);
      if (season.status === "CLOSED") throw new TeamEnrollmentError("SEASON_CLOSED", 409);
      if (season.team_registration_closed_at) throw new TeamEnrollmentError("TEAM_REGISTRATION_CLOSED", 409);
      const { groupId, participationId } = await lockEnrollmentCategory(tx, data);
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true),
        set_config('app.reason', 'PDGLD-62: inscripción de equipo', true)`;

      let teamId: string;
      if (data.team.mode === "existing") {
        teamId = data.team.teamId;
        const team = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM sports_management.teams WHERE id = ${teamId}::uuid AND club_id = ${data.clubId}::uuid FOR SHARE
        `;
        if (!team.length) throw new TeamEnrollmentError("INVALID_CONTEXT");
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-62:team:${teamId}:${data.seasonId}`}, 0))::text`;
        if (await tx.season_teams.findUnique({ where: { team_id_season_id: { team_id: teamId, season_id: data.seasonId } }, select: { id: true } }))
          throw new TeamEnrollmentError("TEAM_ALREADY_ENROLLED", 409);
      } else {
        // Dos equipos diferentes pueden compartir nombre en distintas categorías.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('team-name:' || ${data.clubId} || ':' || ${data.seasonId} || ':' || ${data.categoryId} || ':' || lower(regexp_replace(btrim(${data.team.name}), '[[:space:]]+', ' ', 'g')), 0))::text`;
        const duplicates = await tx.$queryRaw<{ id: string }[]>`
          SELECT t.id FROM sports_management.teams t
          JOIN sports_management.season_teams st ON st.team_id = t.id
          WHERE t.club_id = ${data.clubId}::uuid AND st.season_id = ${data.seasonId}::uuid AND st.season_category_id = ${participationId}::uuid
            AND lower(regexp_replace(btrim(t.name), '[[:space:]]+', ' ', 'g')) = lower(regexp_replace(btrim(${data.team.name}), '[[:space:]]+', ' ', 'g'))
          LIMIT 1`;
        if (duplicates.length) throw new TeamEnrollmentError("TEAM_ALREADY_ENROLLED", 409);
        const team = await tx.teams.create({ data: { club_id: data.clubId, name: data.team.name,
          reference_number: `TEAM-${randomUUID()}` }, select: { id: true } });
        teamId = team.id;
      }
      const enrollment = await tx.season_teams.create({
        data: { team_id: teamId, club_id: data.clubId, season_id: data.seasonId, group_id: groupId, season_category_id: participationId,
          status: "REGISTERED", enrolled_by: actor.id, enrolled_at: new Date(),
          enrollment_key: data.enrollmentKey, enrollment_hash: fingerprint },
        select: enrollmentSelect,
      });
      await tx.team_enrollment_operations.create({ data: { actor_id: actor.id, enrollment_key: data.enrollmentKey,
        club_id: data.clubId, fingerprint, outcome: "CONFIRMED", enrollment_id: enrollment.id } });
      // El trigger de inscripción registra un solo evento, también dentro de ACID.
      return enrollmentResult(enrollment, false);
    }, { timeout: 15_000 });
  } catch (error) {
    // La restricción UNIQUE es la última defensa aunque escriba otro proceso.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new TeamEnrollmentError("TEAM_ALREADY_ENROLLED", 409);
    throw error;
  }
}
