import "server-only";

import { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization, type PermissionAction } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { intervalSchema, venueIdSchema, venueSchema } from "../schemas";
import { assignmentOccurrences } from "../assignment-occurrences";
import { z } from "zod";

type Tx = Prisma.TransactionClient;
export class VenueInputError extends Error {}

async function authorized(tx: Tx, userId: string, leagueId: string, action: PermissionAction, module = "venues") {
  try {
    await assertPermission(tx, userId, { module, action, context: { leagueId } });
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

async function venueLeagues(tx: Tx, actorId: string) {
  const grants = (await getPermissionGrants(tx, actorId, "venues", "READ")).filter(grant => !grant.clubId && (grant.leagueId || !grant.contextOnly));
  const leagueIds = grants.flatMap(grant => grant.leagueId ? [grant.leagueId] : []);
  return tx.leagues.findMany({
    where: { is_active: true, ...(grants.some(grant => !grant.leagueId) ? {} : { id: { in: leagueIds } }) },
    select: { id: true, name: true, timezone: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export async function canReadVenues() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => (await venueLeagues(tx, actor.id)).length > 0);
}

type Conflict = { intervalId: string; matchId: string; number: string; startsAt: Date };

export async function getVenueWorkspace(requestedLeague?: string, requestedVenue?: string) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    const leagues = await venueLeagues(tx, actor.id);
    const league = requestedLeague ? leagues.find(item => item.id === requestedLeague) : leagues[0];
    if (!league) throw new AuthorizationError();
    await assertPermission(tx, actor.id, { module: "venues", action: "READ", context: { leagueId: league.id } });
    const canCreate = await authorized(tx, actor.id, league.id, "CREATE");
    const canUpdate = await authorized(tx, actor.id, league.id, "UPDATE");
    const clubs = await tx.clubs.findMany({
      where: { league_id: league.id }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const venues = await tx.venues.findMany({
      where: { league_id: league.id },
      select: { id: true, code: true, name: true, is_active: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    const selected = venues.find(item => item.id === requestedVenue);
    const venue = selected ? await tx.venues.findUnique({
      where: { id_league_id: { id: selected.id, league_id: league.id } },
      include: { venue_availability: { orderBy: [{ starts_at: "desc" }, { id: "asc" }] } },
    }) : null;
    const showConflicts = canUpdate && await authorized(tx, actor.id, league.id, "READ", "scheduling");
    const conflicts = venue && showConflicts ? await tx.$queryRaw<Conflict[]>`
      SELECT a.id AS "intervalId", m.id AS "matchId", m.number, m.starts_at AS "startsAt"
      FROM sports_management.venue_availability a
      JOIN sports_management.venue_reservations r ON r.venue_id = a.venue_id
        AND r.time_range && tstzrange(a.starts_at, a.ends_at, '[)')
      JOIN sports_management.matches m ON m.id = r.match_id
      JOIN sports_management.seasons s ON s.id = m.season_id
      WHERE a.venue_id = ${venue.id}::uuid AND s.league_id = ${league.id}::uuid AND a.type <> 'AVAILABLE'
      ORDER BY m.starts_at, m.id
    ` : [];
    const canAssign = await authorized(tx, actor.id, league.id, "UPDATE", "scheduling");
    const assignmentTeams = venue && (venue.is_league_sports_complex || venue.owner_club_id) && canAssign ? await tx.season_teams.findMany({
      where: { status: { in: ["ACTIVE", "REGISTERED"] }, ...(!venue.is_league_sports_complex ? {club_id:venue.owner_club_id!} : {}), club_affiliations: { seasons: { league_id: league.id, status: { not: "CLOSED" } } } },
      select: { id: true, teams: { select: { name: true } }, club_affiliations: { select: { seasons: { select: { name: true } } } } }, orderBy: { id: "asc" },
    }) : [];
    return { leagues, league, clubs, venues, venue, canCreate, canUpdate, conflicts, canAssign, assignmentTeams };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

const assignmentSchema = z.object({ venueId: z.uuid(), seasonTeamId: z.uuid(), from: z.iso.date(), through: z.iso.date(),
  weekday: z.coerce.number().int().min(1).max(7), time: z.string().regex(/^\d{2}:\d{2}$/) });

export async function assignLeagueVenue(input: unknown) {
  const data = assignmentSchema.parse(input);
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    const leagueId = await lockVenue(tx, data.venueId);
    const grants = await assertPermission(tx, actor.id, { module: "scheduling", action: "UPDATE", context: { leagueId } });
    if (!grants.some(grant => !grant.clubId)) throw new AuthorizationError();
    const venue = await tx.venues.findUniqueOrThrow({ where: { id: data.venueId }, include: { leagues: { select: { timezone: true } }, venue_availability: true } });
    const team = await tx.season_teams.findFirst({ where: { id: data.seasonTeamId, status: { in: ["ACTIVE", "REGISTERED"] }, club_affiliations: { seasons: { league_id: leagueId, status: { not: "CLOSED" } } } }, include: { club_affiliations: { include: { seasons: true } } } });
    if (!team || !venue.is_active || (venue.is_league_sports_complex ? !!venue.owner_club_id : !venue.owner_club_id || team.club_id !== venue.owner_club_id)) throw new VenueInputError("INVALID_ASSIGNMENT");
    if (data.from < team.club_affiliations.seasons.start_date.toISOString().slice(0, 10) || data.through > team.club_affiliations.seasons.end_date.toISOString().slice(0, 10)) throw new VenueInputError("INVALID_ASSIGNMENT");
    let dates: Date[];
    try { dates = assignmentOccurrences(data.from, data.through, data.weekday, data.time, venue.leagues.timezone); }
    catch { throw new VenueInputError("INVALID_ASSIGNMENT"); }
    for (const start of dates) {
      const end = new Date(start.getTime() + (venue.match_duration_minutes + venue.buffer_minutes) * 60000);
      if (!venue.venue_availability.some(w => w.type === "AVAILABLE" && w.starts_at <= start && w.ends_at >= end) ||
          venue.venue_availability.some(w => w.type !== "AVAILABLE" && w.starts_at < end && w.ends_at > start)) throw new VenueInputError("ASSIGNMENT_UNAVAILABLE");
      const conflicts = await tx.$queryRaw<{ match_id: string }[]>`SELECT match_id FROM sports_management.venue_reservations WHERE venue_id=${venue.id}::uuid AND time_range && tstzrange(${start},${end},'[)') LIMIT 1`;
      if (conflicts.length) throw new VenueInputError("ASSIGNMENT_UNAVAILABLE");
    }
    const overlap = await tx.home_venue_assignments.findFirst({ where: { venue_id: venue.id, weekday: data.weekday,
      starts_at: { lte: new Date(`${data.through}T00:00:00Z`) }, ends_at: { gte: new Date(`${data.from}T00:00:00Z`) } } });
    if (overlap) throw new VenueInputError("ASSIGNMENT_UNAVAILABLE");
    const result = await tx.home_venue_assignments.create({ data: { season_team_id: team.id, venue_id: venue.id, weekday: data.weekday,
      start_time: new Date(`1970-01-01T${data.time}:00Z`), starts_at: new Date(`${data.from}T00:00:00Z`), ends_at: new Date(`${data.through}T00:00:00Z`) } });
    await audit(tx, actor.id, "home_venue_assignments", result.id, null, result);
    return { leagueId, venueId: venue.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function lockVenue(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ league_id: string }[]>`
    SELECT league_id FROM sports_management.venues WHERE id = ${id}::uuid FOR UPDATE
  `;
  if (!rows[0]) throw new AuthorizationError();
  return rows[0].league_id;
}

async function audit(tx: Tx, userId: string, table: string, id: string, previous: object | null, next: object | null) {
  await tx.audit_logs.create({ data: {
    user_id: userId, table_name: table, entity_id: id,
    action: previous ? (next ? "UPDATE" : "DELETE") : "INSERT",
    reason: "PDGLD-22: administración de canchas y disponibilidad",
    previous_data: previous ? JSON.parse(JSON.stringify(previous)) : undefined,
    new_data: next ? JSON.parse(JSON.stringify(next)) : undefined,
  }, select: { id: true } });
}

export async function saveVenue(input: unknown) {
  const actor = await requireOperationalUser();
  const parsed = venueSchema.safeParse(input);
  if (!parsed.success) throw new VenueInputError("INVALID_VENUE");
  const data = parsed.data;
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await assertPermission(tx, actor.id, {
      module: "venues", action: data.venueId ? "UPDATE" : "CREATE", context: { leagueId: data.leagueId },
    });
    if (data.ownerClubId && !await tx.clubs.findFirst({ where: { id: data.ownerClubId, league_id: data.leagueId }, select: { id: true } }))
      throw new VenueInputError("INVALID_OWNER");
    const values = {
      code: data.code, name: data.name, address: data.address,
      is_league_sports_complex: data.kind === "complex",
      match_duration_minutes: data.duration, buffer_minutes: data.buffer,
    };
    let previous = null;
    if (data.venueId) {
      if (await lockVenue(tx, data.venueId) !== data.leagueId) throw new AuthorizationError();
      previous = await tx.venues.findUniqueOrThrow({ where: { id: data.venueId } });
      if ((previous.owner_club_id !== (data.ownerClubId || null) || previous.is_league_sports_complex !== (data.kind === "complex")) &&
          await tx.venue_loans.count({ where: { venue_id: previous.id } })) throw new VenueInputError("OWNER_HAS_LOANS");
    }
    const features = previous?.features;
    const extra = features && typeof features === "object" && !Array.isArray(features) ? features : {};
    const changes = { ...values, owner_club_id: data.ownerClubId || null, features: { ...extra, description: data.features } };
    const venue = previous
      ? await tx.venues.update({ where: { id: previous.id }, data: changes })
      : await tx.venues.create({ data: { ...changes, league_id: data.leagueId } });
    await audit(tx, actor.id, "venues", venue.id, previous, venue);
    return { leagueId: data.leagueId, venueId: venue.id };
  });
}

export async function getVenueTimeZone(value: unknown) {
  const id = venueIdSchema.safeParse(value);
  if (!id.success) throw new VenueInputError("INVALID_INTERVAL");
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    const venue = await tx.venues.findUnique({
      where: { id: id.data }, select: { league_id: true, leagues: { select: { timezone: true } } },
    });
    if (!venue) throw new AuthorizationError();
    await assertPermission(tx, actor.id, { module: "venues", action: "UPDATE", context: { leagueId: venue.league_id } });
    return venue.leagues.timezone;
  });
}

export async function saveInterval(input: unknown) {
  const parsed = intervalSchema.safeParse(input);
  if (!parsed.success) throw new VenueInputError("INVALID_INTERVAL");
  const data = parsed.data;
  return changeInterval(data.venueId, data.intervalId, {
    starts_at: data.start, ends_at: data.end, type: data.type, reason: data.reason || null,
  });
}

export async function removeInterval(venueId: unknown, intervalId: unknown) {
  const venue = venueIdSchema.safeParse(venueId);
  const interval = venueIdSchema.safeParse(intervalId);
  if (!venue.success || !interval.success) throw new VenueInputError("INVALID_INTERVAL");
  return changeInterval(venue.data, interval.data, null);
}

async function changeInterval(venueId: string, intervalId: string, changes: Pick<
  Prisma.venue_availabilityUncheckedCreateInput, "starts_at" | "ends_at" | "type" | "reason"
> | null) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    const venue = await tx.venues.findUnique({ where: { id: venueId }, select: { league_id: true } });
    if (!venue) throw new AuthorizationError();
    await assertPermission(tx, actor.id, { module: "venues", action: "UPDATE", context: { leagueId: venue.league_id } });
    const leagueId = await lockVenue(tx, venueId);
    if (leagueId !== venue.league_id) throw new AuthorizationError();
    const previous = intervalId ? await tx.venue_availability.findUnique({
      where: { id: intervalId, venue_id: venueId },
    }) : null;
    if (intervalId && !previous) throw new VenueInputError("INVALID_INTERVAL");
    const result = changes
      ? previous
        ? await tx.venue_availability.update({ where: { id: previous.id }, data: changes })
        : await tx.venue_availability.create({ data: { ...changes, venue_id: venueId } })
      : null;
    if (previous && !changes) await tx.venue_availability.delete({ where: { id: previous.id }, select: { id: true } });
    await audit(tx, actor.id, "venue_availability", (result ?? previous)!.id, previous, result);
    return { leagueId, venueId };
  });
}
