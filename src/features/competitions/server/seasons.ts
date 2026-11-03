import "server-only";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization } from "@/server/auth/authorization";
import { createSeasonSchema } from "../schemas";

export class SeasonInputError extends Error {
  constructor(public readonly code: "INVALID_SEASON" | "DUPLICATE_SEASON" | "INVALID_CONTEXT") { super(code); }
}

export async function getSeasonWorkspace() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    const grants = (await getPermissionGrants(tx, actor.id, "competitions", "READ"))
      .filter(grant => !grant.clubId && (grant.leagueId || !grant.contextOnly));
    if (!grants.length) throw new AuthorizationError();
    const global = grants.some(grant => !grant.leagueId);
    const leagues = await tx.leagues.findMany({
      where: { is_active: true, ...(global ? {} : { id: { in: grants.map(grant => grant.leagueId!) } }) },
      select: { id: true, name: true }, orderBy: { name: "asc" },
    });
    const options = [];
    for (const league of leagues) {
      let canCreate = false;
      try {
        await assertPermission(tx, actor.id, { module: "competitions", action: "CREATE", context: { leagueId: league.id } });
        canCreate = true;
      } catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
      options.push({ ...league, canCreate });
    }
    const seasons = await tx.seasons.findMany({
      where: { league_id: { in: leagues.map(league => league.id) }, sports: { code: "SOCCER" } },
      select: { id: true, league_id: true, name: true, start_date: true, end_date: true, status: true, version: true },
      orderBy: [{ start_date: "desc" }, { id: "asc" }],
    });
    return { leagues: options, seasons: seasons.map(season => ({
      id: season.id, leagueId: season.league_id, name: season.name,
      startDate: season.start_date.toISOString().slice(0, 10), endDate: season.end_date.toISOString().slice(0, 10),
      status: season.status, version: season.version,
    })) };
  });
}

export async function createSeason(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = createSeasonSchema.safeParse(input);
  if (!parsed.success) throw new SeasonInputError("INVALID_SEASON");
  const data = parsed.data;
  try {
    return await getPrisma().$transaction(async tx => {
      await lockAuthorization(tx);
      await assertPermission(tx, actor.id, { module: "competitions", action: "CREATE", context: { leagueId: data.leagueId } });
      const leagues = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sports_management.leagues WHERE id = ${data.leagueId}::uuid AND is_active FOR SHARE
      `;
      const sport = await tx.sports.findUnique({ where: { code: "SOCCER" }, select: { id: true } });
      if (!leagues.length || !sport) throw new SeasonInputError("INVALID_CONTEXT");
      const season = await tx.seasons.create({ data: {
        league_id: data.leagueId, sport_id: sport.id, name: data.name,
        start_date: new Date(`${data.startDate}T00:00:00.000Z`),
        end_date: new Date(`${data.endDate}T00:00:00.000Z`), status: "PLANNED",
      }, select: { id: true, name: true } });
      // seasons no tiene record_audit en el baseline: registrar una sola vez.
      await tx.audit_logs.create({ data: { user_id: actor.id, action: "INSERT", table_name: "seasons", entity_id: season.id,
        reason: "PDGLD-38: creación de temporada planificada", new_data: {
          leagueId: data.leagueId, name: data.name, startDate: data.startDate, endDate: data.endDate, status: "PLANNED", version: 1,
        } } });
      return season;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new SeasonInputError("DUPLICATE_SEASON");
    throw error;
  }
}
