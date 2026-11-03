import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { seasonEditSchema } from "../schemas";
import { CompetitionError } from "./configuration";

export async function editSeason(seasonId: string, input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = seasonEditSchema.safeParse(input);
  if (!z.uuid().safeParse(seasonId).success || !parsed.success) throw new CompetitionError("INVALID_CONFIGURATION");
  const data = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR UPDATE`;
      await assertPermission(tx, actor.id, { module: "competitions", action: "UPDATE", context: { seasonId } });
      const previous = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId } });
      if (previous.status === "CLOSED") throw new CompetitionError("SEASON_CLOSED", 409);
      if (previous.status !== "PLANNED" || previous.competition_starts_at) throw new CompetitionError("COMPETITION_ALREADY_STARTED", 409);
      if (previous.version !== data.expectedSeasonVersion) throw new CompetitionError("STALE_CONFIGURATION", 409);
      const datesChanged = previous.start_date.toISOString().slice(0,10) !== data.startDate || previous.end_date.toISOString().slice(0,10) !== data.endDate;
      if (datesChanged) {
        // No mover el calendario de una edición que ya tiene configuración o actividad.
        const categories = await tx.season_categories.count({ where: { season_id: seasonId } });
        const affiliations = await tx.club_affiliations.count({ where: { season_id: seasonId } });
        const matchdays = await tx.matchdays.count({ where: { season_id: seasonId } });
        const breaks = await tx.season_breaks.count({ where: { season_id: seasonId } });
        if (categories || affiliations || matchdays || breaks) throw new CompetitionError("SEASON_DATES_IN_USE", 409);
      }
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actor.id}, true), set_config('app.reason', ${data.reason}, true)`;
      const result = await tx.seasons.update({ where: { id: seasonId }, data: { name: data.name,
        start_date: new Date(`${data.startDate}T00:00:00Z`), end_date: new Date(`${data.endDate}T00:00:00Z`), version: { increment: 1 } },
        select: { id: true, name: true, version: true } });
      // audit_season conserva valores anteriores y nuevos dentro de la transacción.
      return result;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new CompetitionError("DUPLICATE_SEASON", 409);
    throw error;
  }
}
