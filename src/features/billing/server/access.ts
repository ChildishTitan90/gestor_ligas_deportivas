import "server-only";
import { Prisma } from "@prisma/client";
import { assertPermission, getActorPermissionGrants, grantCoversContext, AuthorizationError, type PermissionAction } from "@/server/auth/authorization";
import type { BillingSeason, ChargeRecipient } from "../types";
import type { CreateCharge } from "../schemas";

export class BillingError extends Error {}

export async function billingCatalog(tx: Prisma.TransactionClient, actorId: string, action: PermissionAction = "READ"): Promise<BillingSeason[]> {
  const grants = (await getActorPermissionGrants(tx, actorId)).filter(grant => grant.module === "billing" && grant.action === action);
  if (!grants.length) throw new AuthorizationError();
  const operationalClub = action === "READ" ? {} : { status: "ACTIVE" };
  const seasons = await tx.seasons.findMany({
    where: { leagues: { is_active: true }, OR: grants.map(grant => ({
      ...(grant.leagueId ? { league_id: grant.leagueId } : {}),
      ...(grant.clubId ? { club_affiliations: { some: { club_id: grant.clubId } } } : {}),
      ...(grant.contextOnly && !grant.leagueId && !grant.clubId ? { id: { in: [] } } : {}),
    })) },
    select: { id: true, name: true, league_id: true, leagues: { select: { name: true } },
      club_affiliations: { where: { clubs: operationalClub }, select: { club_id: true, clubs: { select: { name: true } } } },
    }, orderBy: [{ start_date: "desc" }, { id: "asc" }],
  });
  const teams = await tx.season_teams.findMany({
    where: { season_id: { in: seasons.map(season => season.id) }, teams: { clubs: operationalClub } },
    select: { id: true, season_id: true, club_id: true, teams: { select: { name: true, clubs: { select: { name: true } } } },
      season_categories: { select: { categories: { select: { name: true } } } },
      groups: { select: { season_categories: { select: { categories: { select: { name: true } } } } } },
    },
  });
  return seasons.map(season => {
    const covers = (clubId: string) => grants.some(grant => grantCoversContext(grant, {
      hasContext: true, leagueId: season.league_id, seasonId: season.id, clubIds: [clubId],
    }));
    const recipients: ChargeRecipient[] = [
      ...season.club_affiliations.filter(item => covers(item.club_id)).map(item => ({
        kind: "CLUB" as const, id: item.club_id, name: item.clubs.name, club: item.clubs.name,
      })),
      ...teams.filter(item => item.season_id === season.id && covers(item.club_id)).map(item => ({
        kind: "TEAM" as const, id: item.id, name: item.teams.name, club: item.teams.clubs.name,
        category: item.season_categories?.categories.name ?? item.groups?.season_categories.categories.name ?? "Categoría pendiente",
      })),
    ];
    return { id: season.id, name: season.name, league: season.leagues.name, recipients };
  });
}

export async function authorizeRecipient(tx: Prisma.TransactionClient, actorId: string, action: PermissionAction,
  seasonId: string, recipient: CreateCharge["recipient"]) {
  let clubId: string;
  let teamId: string | undefined;
  if (recipient.kind === "TEAM") {
    const team = await tx.season_teams.findUnique({ where: { id: recipient.seasonTeamId }, select: { season_id: true, team_id: true, club_id: true } });
    if (!team || team.season_id !== seasonId) throw new AuthorizationError();
    clubId = team.club_id;
    teamId = team.team_id;
  } else clubId = recipient.clubId;
  await assertPermission(tx, actorId, { module: "billing", action, context: { seasonId, clubId, teamId } });
}

export const recipientOf = (row: { club_id: string | null; season_team_id: string | null }): CreateCharge["recipient"] =>
  row.club_id ? { kind: "CLUB", clubId: row.club_id } : { kind: "TEAM", seasonTeamId: row.season_team_id! };
