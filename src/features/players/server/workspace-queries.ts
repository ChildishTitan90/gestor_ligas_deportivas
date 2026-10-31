import "server-only";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError, getPermissionGrants, type PermissionGrant } from "@/server/auth/authorization";
import { assertPlayerRegistrationRead, lockPlayerTeamContext, PlayerRegistrationError } from "./access";
import { registerPlayerSchema } from "../schemas";
import { sameIdentity } from "../identity-rules";
import { identityFromPerson, personIdentitySelect } from "./identity-matches";
import type { PlayerListItem, PlayerTeamOption } from "../types";

function clubScope(grants: PermissionGrant[]): Prisma.clubsWhereInput {
  if (grants.some(grant => !grant.contextOnly && !grant.clubId && !grant.leagueId)) return {};
  const scopes = grants.flatMap((grant): Prisma.clubsWhereInput[] => {
    if (grant.clubId) return [{ id: grant.clubId, ...(grant.leagueId ? { league_id: grant.leagueId } : {}) }];
    if (grant.leagueId) return [{ league_id: grant.leagueId }];
    return grant.contextOnly ? [] : [{}];
  });
  return { OR: scopes };
}

export async function canAccessPlayerRegistration() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    const create = await getPermissionGrants(tx, actor.id, "players", "CREATE");
    const read = await getPermissionGrants(tx, actor.id, "players", "READ");
    return (await tx.clubs.count({ where: { AND: [clubScope(create), clubScope(read)], status: "ACTIVE", leagues: { is_active: true } } })) > 0;
  });
}

export async function getPlayerWorkspace() {
  const actor = await requireOperationalUser();
  const teams = await getPrisma().$transaction(async tx => {
    const create = await getPermissionGrants(tx, actor.id, "players", "CREATE");
    const read = await getPermissionGrants(tx, actor.id, "players", "READ");
    const scope: Prisma.clubsWhereInput = { AND: [clubScope(create), clubScope(read)], status: "ACTIVE", leagues: { is_active: true } };
    if (!await tx.clubs.count({ where: scope })) throw new AuthorizationError();
    const rows = await tx.season_teams.findMany({ where: { status: { not: "WITHDRAWN" }, teams: { clubs: scope },
      club_affiliations: { status: "APPROVED", seasons: { status: { not: "CLOSED" }, sports: { code: "SOCCER" } } } },
      select: { id: true, club_id: true, season_id: true, teams: { select: { name: true, clubs: { select: { name: true } } } },
        club_affiliations: { select: { id: true, seasons: { select: { name: true } },
          club_affiliation_categories: { where: { authorized_at: { not: null }, authorized_by: { not: null } }, select: { category_id: true } } } },
        groups: { select: { name: true, season_categories: { select: { category_id: true, categories: { select: { name: true } } } } } } },
      orderBy: { id: "asc" } });
    return rows.filter(row => row.club_affiliations.club_affiliation_categories.some(c => c.category_id === row.groups.season_categories.category_id))
      .map((row): PlayerTeamOption => ({ id: row.id, teamName: row.teams.name, clubId: row.club_id, clubName: row.teams.clubs.name,
        seasonId: row.season_id, seasonName: row.club_affiliations.seasons.name,
        categoryName: row.groups.season_categories.categories.name, groupName: row.groups.name }));
  });
  return { actorId: actor.id, teams, providerConfigured: Boolean(process.env.VMX_API_KEY?.trim()) };
}

export async function listRegisteredPlayers(seasonTeamId: string, expectedActorId?: string): Promise<PlayerListItem[]> {
  const actor = await requireOperationalUser();
  if (expectedActorId && actor.id !== expectedActorId.toLowerCase()) throw new AuthorizationError();
  if (!z.uuid().safeParse(seasonTeamId).success) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  return getPrisma().$transaction(async tx => {
    await lockPlayerTeamContext(tx, actor.id, seasonTeamId, "CREATE");
    await lockPlayerTeamContext(tx, actor.id, seasonTeamId, "READ");
    const rows = await tx.player_registrations.findMany({ where: { season_team_id: seasonTeamId },
      select: { id: true, status: true, identity_review_status: true,
        people: { select: { first_name: true, paternal_surname: true, maternal_surname: true } } },
      orderBy: [{ registered_at: "desc" }, { id: "asc" }] });
    return rows.map(row => ({ registrationId: row.id,
      displayName: [row.people.first_name, row.people.paternal_surname, row.people.maternal_surname].filter(Boolean).join(" "),
      status: row.status, identityReviewStatus: row.identity_review_status }));
  });
}

/** Lectura con payload privado para recuperar una respuesta perdida, sin reenviar el alta. */
export async function recoverPlayerRegistration(input: unknown, expectedActorId?: string) {
  const actor = await requireOperationalUser();
  if (expectedActorId && actor.id !== expectedActorId.toLowerCase()) throw new AuthorizationError();
  const parsed = registerPlayerSchema.safeParse(input);
  if (!parsed.success) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  return getPrisma().$transaction(async tx => {
    await lockPlayerTeamContext(tx, actor.id, parsed.data.seasonTeamId, "CREATE");
    const row = await tx.player_registrations.findFirst({ where: { season_team_id: parsed.data.seasonTeamId, withdrawn_at: null,
      people: { curp: parsed.data.identity.curp } }, select: { id: true, season_team_id: true, people: { select: personIdentitySelect } } });
    if (!row || !sameIdentity(parsed.data.identity, identityFromPerson(row.people))) return { status: "UNRESOLVED" as const };
    await assertPlayerRegistrationRead(tx, actor.id, row.id, row.season_team_id);
    return { status: "CONFIRMED" as const, registrationId: row.id };
  });
}
