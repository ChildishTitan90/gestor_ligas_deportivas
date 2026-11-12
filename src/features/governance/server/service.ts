import "server-only";

import { Prisma } from "@prisma/client";
import { assertPermission, AuthorizationError, getPermissionGrants, lockAuthorization } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { bodyNames, canFinishOn, dateInLeague, governanceMutation, periodFilters } from "../contract";

type Tx = Prisma.TransactionClient;
export class GovernanceError extends Error {}
const pathToLeague = (leagueId: string) => ({ governing_bodies: { league_id: leagueId } });
const nameFields = { id: true, first_name: true, paternal_surname: true, maternal_surname: true } satisfies Prisma.peopleSelect;
const isoDate = (value: Date | null) => value?.toISOString().slice(0, 10) ?? "";
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

async function readLeagues(tx: Tx, actorId: string) {
  const grants = (await getPermissionGrants(tx, actorId, "users", "READ"))
    .filter(grant => !grant.clubId && (grant.leagueId || !grant.contextOnly));
  const ids = grants.flatMap(grant => grant.leagueId ? [grant.leagueId] : []);
  return tx.leagues.findMany({
    where: { is_active: true, ...(grants.some(grant => !grant.leagueId) ? {} : { id: { in: ids } }) },
    select: { id: true, name: true, timezone: true },
    orderBy: [{ name: "asc" }, { id: "asc" }],
  });
}

export async function canReadGovernance() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => (await readLeagues(tx, actor.id)).length > 0);
}

function personInLeague(leagueId: string): Prisma.peopleWhereInput {
  return { OR: [
    { users: { user_roles: { some: { league_id: leagueId } } } },
    { player_registrations: { some: { season_teams: { club_affiliations: { league_id: leagueId } } } } },
    { club_officers: { some: { club_affiliations: { league_id: leagueId } } } },
    { appointments: { some: { positions: pathToLeague(leagueId) } } },
  ] };
}

type Filters = { league?: string; body?: string; period?: string; person?: string };

export async function getGovernanceWorkspace(filters: Filters) {
  return getGovernanceWorkspaceForActor((await requireOperationalUser()).id, filters);
}

/** Entrada interna: el llamador obtiene el actor desde la sesión. */
export async function getGovernanceWorkspaceForActor(actorId: string, filters: Filters) {
  return getPrisma().$transaction(async tx => {
    const leagues = await readLeagues(tx, actorId);
    const league = filters.league ? leagues.find(item => item.id === filters.league) : leagues[0];
    if (!league) throw new AuthorizationError();
    await assertPermission(tx, actorId, { module: "users", action: "READ", context: { leagueId: league.id } });
    let canEdit = true;
    try {
      await assertPermission(tx, actorId, { module: "users", action: "UPDATE", context: { leagueId: league.id } });
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      canEdit = false;
    }

    const bodies = await tx.governing_bodies.findMany({
      where: { league_id: league.id }, select: { id: true, name: true }, orderBy: { name: "asc" },
    });
    const body = bodies.find(item => item.id === filters.body);
    const period = periodFilters.find(item => item === filters.period) ?? "all";
    const today = dateInLeague(new Date(), league.timezone);
    const day = asDate(today);
    const periodWhere: Record<typeof period, Prisma.appointmentsWhereInput> = {
      all: {},
      current: { starts_at: { lte: day }, OR: [{ ends_at: null }, { ends_at: { gte: day } }] },
      past: { ends_at: { lt: day } },
      future: { starts_at: { gt: day } },
    };
    const positions = await tx.positions.findMany({
      where: { ...pathToLeague(league.id), ...(body ? { governing_body_id: body.id } : {}) },
      select: {
        id: true, name: true, governing_body_id: true, roles: { select: { name: true } },
        appointments: {
          where: periodWhere[period], orderBy: [{ starts_at: "desc" }, { id: "asc" }],
          select: { id: true, starts_at: true, ends_at: true, people: { select: nameFields } },
        },
      }, orderBy: [{ name: "asc" }, { id: "asc" }],
    });

    const query = typeof filters.person === "string" ? filters.person.trim().slice(0, 100) : "";
    const people = canEdit && query.length >= 2 ? await tx.people.findMany({
      where: { AND: [personInLeague(league.id), ...query.split(/\s+/).map(word => ({
        OR: (["first_name", "paternal_surname", "maternal_surname"] as const).map(field => ({
          [field]: { contains: word, mode: "insensitive" },
        })),
      }))] },
      select: nameFields, take: 31,
      orderBy: [{ paternal_surname: "asc" }, { first_name: "asc" }, { id: "asc" }],
    }) : [];
    const roles = canEdit ? await tx.roles.findMany({
      select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }],
    }) : [];
    return { leagues, league, bodies, body, period, today, canEdit, positions, people, query, roles };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

async function record(tx: Tx, actorId: string, table: string, id: string, reason: string,
  next: Prisma.InputJsonObject, previous?: Prisma.InputJsonObject) {
  await tx.audit_logs.create({ data: {
    user_id: actorId, action: previous ? "UPDATE" : "INSERT", table_name: table, entity_id: id,
    previous_data: previous, new_data: next, reason,
  }, select: { id: true } });
}

export async function changeGovernance(input: unknown) {
  return changeGovernanceForActor((await requireOperationalUser()).id, input);
}

/** Entrada interna: el llamador obtiene el actor desde la sesión. */
export async function changeGovernanceForActor(actorId: string, input: unknown) {
  const result = governanceMutation.safeParse(input);
  if (!result.success) throw new GovernanceError("INVALID");
  const data = result.data;
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    const context = { leagueId: data.leagueId };
    await assertPermission(tx, actorId, { module: "users", action: "READ", context });
    await assertPermission(tx, actorId, { module: "users", action: "UPDATE", context });

    if (data.operation === "initialize") {
      const rows = await tx.governing_bodies.createManyAndReturn({
        data: bodyNames.map(name => ({ league_id: data.leagueId, name })),
        skipDuplicates: true, select: { id: true, name: true },
      });
      for (const row of rows) await record(tx, actorId, "governing_bodies", row.id, data.reason,
        { leagueId: data.leagueId, name: row.name });
      return null;
    }

    if (data.operation === "position") {
      const body = await tx.governing_bodies.findFirst({ where: { id: data.bodyId, league_id: data.leagueId }, select: { id: true } });
      if (!body) throw new AuthorizationError();
      if (data.roleId && !await tx.roles.findUnique({ where: { id: data.roleId }, select: { id: true } })) {
        throw new GovernanceError("INVALID");
      }
      const position = await tx.positions.create({ data: { governing_body_id: body.id, name: data.name,
        role_id: data.roleId || null }, select: { id: true } });
      await record(tx, actorId, "positions", position.id, data.reason,
        { bodyId: body.id, name: data.name, roleId: data.roleId || null });
      return body.id;
    }

    if (data.operation === "appoint") {
      const position = await tx.positions.findFirst({ where: { id: data.positionId, ...pathToLeague(data.leagueId) },
        select: { id: true, governing_body_id: true } });
      if (!position) throw new AuthorizationError();
      const person = await tx.people.findFirst({ where: { id: data.personId, ...personInLeague(data.leagueId) }, select: { id: true } });
      if (!person) throw new AuthorizationError();
      const appointment = await tx.appointments.create({ data: {
        position_id: position.id, person_id: person.id, starts_at: asDate(data.startsAt),
        ends_at: data.endsAt ? asDate(data.endsAt) : null,
      }, select: { id: true } });
      await record(tx, actorId, "appointments", appointment.id, data.reason,
        { positionId: position.id, personId: person.id, startsAt: data.startsAt, endsAt: data.endsAt || null });
      return position.governing_body_id;
    }

    const appointment = await tx.appointments.findFirst({
      where: { id: data.appointmentId, positions: pathToLeague(data.leagueId) },
      select: { id: true, starts_at: true, ends_at: true, positions: { select: { governing_body_id: true } } },
    });
    if (!appointment) throw new AuthorizationError();
    const currentEnd = isoDate(appointment.ends_at);
    const league = await tx.leagues.findUniqueOrThrow({ where: { id: data.leagueId }, select: { timezone: true } });
    if (currentEnd !== data.expectedEnd) throw new GovernanceError("STALE");
    if (!canFinishOn(isoDate(appointment.starts_at), currentEnd, data.endsAt, dateInLeague(new Date(), league.timezone))) {
      throw new GovernanceError("INVALID_END");
    }
    const updated = await tx.appointments.updateMany({
      where: { id: appointment.id, ends_at: appointment.ends_at },
      data: { ends_at: asDate(data.endsAt) },
    });
    if (!updated.count) throw new GovernanceError("STALE");
    await record(tx, actorId, "appointments", appointment.id, data.reason,
      { endsAt: data.endsAt }, { endsAt: currentEnd || null });
    return appointment.positions.governing_body_id;
  });
}
