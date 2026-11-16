import "server-only";
import type { Prisma } from "@prisma/client";
import { AuthorizationError, getPermissionGrants } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { venueLocalTime } from "../time";
import { windowSchema } from "./loans";
import { z } from "zod";

async function getScopes(tx: Prisma.TransactionClient, actorId: string) {
    const create = await getPermissionGrants(tx, actorId, "venues", "CREATE");
    const approve = await getPermissionGrants(tx, actorId, "venues", "APPROVE");
    const roles = await tx.roles.findMany({ where: { code: { in: ["CLUB_DELEGATE", "EXECUTIVE_PRESIDENT"] } }, select: { id: true, code: true } });
    const delegates = create.filter(g => g.clubId && g.leagueId && roles.some(r => r.id === g.roleId && r.code === "CLUB_DELEGATE"));
    const presidents = approve.filter(g => (g.leagueId || g.clubId || !g.contextOnly) && roles.some(r => r.id === g.roleId && r.code === "EXECUTIVE_PRESIDENT"));
    return { delegates, presidents };
}

export async function canAccessVenueLoans() {
  const actor = await requireOperationalUser();
  const { delegates, presidents } = await getPrisma().$transaction(tx => getScopes(tx, actor.id));
  return delegates.length + presidents.length > 0;
}

export async function getVenueLoanWorkspace() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async db => {
  const { delegates, presidents } = await getScopes(db, actor.id);
  if (!delegates.length && !presidents.length) throw new AuthorizationError();
  const contexts = delegates.length ? await db.club_affiliations.findMany({
    where: { status: "APPROVED", seasons: { status: { not: "CLOSED" } }, OR: delegates.map(g => ({ club_id: g.clubId!, league_id: g.leagueId! })) },
    select: { id: true, club_id: true, season_id: true, league_id: true, clubs: { select: { name: true } },
      seasons: { select: { name: true, leagues: { select: { timezone: true } } } } },
    orderBy: { id: "asc" },
  }) : [];
  const venues = contexts.length ? await db.venues.findMany({
    where: { is_active: true, is_league_sports_complex: false, OR: contexts.map(c => ({ league_id: c.league_id, OR: [{ owner_club_id: c.club_id }, { owner_club_id: null }] })) },
    select: { id: true, name: true, league_id: true, owner_club_id: true }, orderBy: { name: "asc" },
  }) : [];
  const scope = presidents.map(g => ({
    ...(g.leagueId ? { seasons: { league_id: g.leagueId } } : {}),
    ...(g.clubId ? { club_id: g.clubId } : {}),
  }));
  const rows = delegates.length + presidents.length ? await db.venue_loans.findMany({
    where: { requested_by: { not: null }, OR: [...scope, ...(delegates.length ? [{ requested_by: actor.id, OR: delegates.map(g => ({ club_id: g.clubId!, seasons: { league_id: g.leagueId! } })) }] : [])] },
    select: { id: true, status: true, requested_by: true, requested_windows: true, review_reason: true, club_id: true,
      venues: { select: { name: true } }, clubs: { select: { name: true } },
      seasons: { select: { name: true, status: true, league_id: true, leagues: { select: { timezone: true } } } } },
    orderBy: [{ status: "asc" }, { id: "asc" }],
  }) : [];
  return {
    actorId: actor.id,
    contexts: contexts.map(c => ({ id: c.id, clubId: c.club_id, seasonId: c.season_id, label: `${c.clubs.name} · ${c.seasons.name}`, zone: c.seasons.leagues.timezone,
      venues: venues.filter(v => v.league_id === c.league_id && (!v.owner_club_id || v.owner_club_id === c.club_id)).map(v => ({ value: v.id, label: v.name })) })),
    rows: rows.map(r => {
      const zone = r.seasons.leagues.timezone;
      const windows = z.array(windowSchema).safeParse(r.requested_windows);
      const format = (value: string) => venueLocalTime(new Date(value), zone).slice(0, 16).replace("T", " ");
      return { id: r.id, venue: r.venues.name, club: r.clubs.name, season: r.seasons.name, zone, status: r.status, reason: r.review_reason,
        windows: windows.success ? windows.data.map(w => `${format(w.startsAt)} – ${format(w.endsAt)}`) : [],
        review: r.status === "PENDING" && r.requested_by !== actor.id && r.seasons.status !== "CLOSED" &&
          presidents.some(g => (!g.leagueId || g.leagueId === r.seasons.league_id) && (!g.clubId || g.clubId === r.club_id)) };
    }),
  };
  }, { isolationLevel: "RepeatableRead" });
}

export type VenueLoanWorkspace = Awaited<ReturnType<typeof getVenueLoanWorkspace>>;
