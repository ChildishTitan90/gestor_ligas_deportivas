import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { teamEnrollmentSchema, canonicalTeamEnrollment } from "../team-enrollment";
import { assertEnrollmentDelegate, lockEnrollmentCategory, lockEnrollmentSeason, TeamEnrollmentError } from "./team-enrollment-access";

const enrollmentSelect = {
  id: true, team_id: true, club_id: true, season_id: true, group_id: true, status: true,
  groups: { select: { season_categories: { select: { category_id: true } } } },
} satisfies Prisma.season_teamsSelect;

type EnrollmentRow = Prisma.season_teamsGetPayload<{ select: typeof enrollmentSelect }>;
function result(row: EnrollmentRow, replayed: boolean) {
  return { id: row.id, teamId: row.team_id, clubId: row.club_id, seasonId: row.season_id,
    categoryId: row.groups.season_categories.category_id, groupId: row.group_id, status: row.status, replayed };
}

export async function enrollTeam(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = teamEnrollmentSchema.safeParse(input);
  if (!parsed.success) throw new TeamEnrollmentError("VALIDATION_ERROR");
  const data = parsed.data;
  const fingerprint = createHash("sha256").update(canonicalTeamEnrollment(data)).digest("hex");

  try {
    return await getPrisma().$transaction(async (tx) => {
      await assertEnrollmentDelegate(tx, actor.id, data.clubId);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-62:key:${actor.id}:${data.enrollmentKey}`}, 0))::text`;
      const season = await lockEnrollmentSeason(tx, data.clubId, data.seasonId);
      const prior = await tx.season_teams.findUnique({
        where: { enrolled_by_enrollment_key: { enrolled_by: actor.id, enrollment_key: data.enrollmentKey } },
        select: { ...enrollmentSelect, enrollment_hash: true },
      });
      if (prior) {
        if (prior.enrollment_hash !== fingerprint) throw new TeamEnrollmentError("IDEMPOTENCY_CONFLICT", 409);
        // Recuperar un resultado confirmado no escribe ni vuelve a habilitarlo.
        // Se exigen sesión, permiso y club vigentes incluso en este caso.
        return result(prior, true);
      }
      if (season.status === "CLOSED") throw new TeamEnrollmentError("SEASON_CLOSED", 409);
      await lockEnrollmentCategory(tx, data);
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
        const team = await tx.teams.create({ data: { club_id: data.clubId, name: data.team.name,
          reference_number: `TEAM-${randomUUID()}` }, select: { id: true } });
        teamId = team.id;
      }
      const enrollment = await tx.season_teams.create({
        data: { team_id: teamId, club_id: data.clubId, season_id: data.seasonId, group_id: data.groupId,
          status: "REGISTERED", enrolled_by: actor.id, enrolled_at: new Date(),
          enrollment_key: data.enrollmentKey, enrollment_hash: fingerprint },
        select: enrollmentSelect,
      });
      // El trigger de inscripción registra un solo evento, también dentro de ACID.
      return result(enrollment, false);
    }, { timeout: 15_000 });
  } catch (error) {
    // La restricción UNIQUE es la última defensa aunque escriba otro proceso.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
      throw new TeamEnrollmentError("TEAM_ALREADY_ENROLLED", 409);
    throw error;
  }
}
