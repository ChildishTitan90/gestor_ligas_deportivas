import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError, getPermissionGrants, grantCoversContext, lockAuthorization, type PermissionGrant } from "@/server/auth/authorization";
import { maintenanceSchema, type MaintenanceRow } from "../maintenance";

export class MaintenanceError extends Error {
  constructor(public readonly code: string) { super(code); }
}

// Alcance obtenido de registros reales. Este servicio permite consultar/reactivar
// inactivos sin relajar la autorización operativa de los demás módulos.
function covers(grants: PermissionGrant[], club: { id: string; league_id: string }) {
  return grants.some(grant => grantCoversContext(grant, {
    leagueId: club.league_id, clubIds: [club.id], hasContext: true,
  }));
}
const listSchema = z.object({
  q: z.string().trim().max(160).default(""), kind: z.enum(["club", "team"]).default("club"),
  status: z.enum(["all", "ACTIVE", "INACTIVE"]).default("all"), after: z.uuid().optional(),
});

export async function getMaintenanceWorkspace(input: unknown = {}) {
  const actor = await requireOperationalUser();
  const parsed = listSchema.safeParse(input);
  if (!parsed.success) throw new MaintenanceError("INVALID_INPUT");
  const { q, kind, status, after } = parsed.data;
  return getPrisma().$transaction(async tx => {
    const read = await getPermissionGrants(tx, actor.id, "clubs", "READ");
    const scopes: Prisma.clubsWhereInput[] = read.flatMap(grant => {
      if (grant.contextOnly && !grant.clubId && !grant.leagueId) return [];
      return [{ ...(grant.clubId ? { id: grant.clubId } : {}), ...(grant.leagueId ? { league_id: grant.leagueId } : {}) }];
    });
    if (!scopes.length) throw new AuthorizationError();
    const edit = await getPermissionGrants(tx, actor.id, "clubs", "UPDATE");
    const change = await getPermissionGrants(tx, actor.id, "clubs", "APPROVE");
    const scope: Prisma.clubsWhereInput = { AND: [{ OR: scopes }, { leagues: { is_active: true } }] };
    const search = q ? { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { reference_number: { contains: q, mode: "insensitive" as const } }] } : {};
    let items: MaintenanceRow[];
    if (kind === "club") {
      const rows = await tx.clubs.findMany({ where: { AND: [scope, search,
        ...(status === "ACTIVE" ? [{ status }] : status === "INACTIVE" ? [{ status: { not: "ACTIVE" } }] : []), ...(after ? [{ id: { gt: after } }] : [])] },
        orderBy: { id: "asc" }, take: 51,
        select: { id: true, name: true, reference_number: true, status: true, version: true, league_id: true,
          leagues: { select: { name: true } }, _count: { select: { club_affiliations: true, teams: true } } } });
      items = rows.map(row => ({ kind, id: row.id, clubId: row.id, name: row.name, reference: row.reference_number,
        clubName: row.name, leagueName: row.leagues.name, status: row.status, clubStatus: row.status, version: row.version,
        canEdit: covers(edit, row), canChangeStatus: covers(change, row),
        hasHistory: row._count.club_affiliations > 0 || row._count.teams > 0 }));
    } else {
      const rows = await tx.teams.findMany({ where: { AND: [{ clubs: scope }, search,
        ...(status === "ACTIVE" ? [{ status: "ACTIVE", clubs: { status: "ACTIVE" } }] :
          status === "INACTIVE" ? [{ OR: [{ status: { not: "ACTIVE" } }, { clubs: { status: { not: "ACTIVE" } } }] }] : []),
        ...(after ? [{ id: { gt: after } }] : [])] }, orderBy: { id: "asc" }, take: 51,
        select: { id: true, name: true, reference_number: true, status: true, version: true,
          clubs: { select: { id: true, name: true, league_id: true, status: true, leagues: { select: { name: true } } } },
          _count: { select: { season_teams: true } } } });
      items = rows.map(row => ({ kind, id: row.id, clubId: row.clubs.id, name: row.name, reference: row.reference_number,
        clubName: row.clubs.name, leagueName: row.clubs.leagues.name, status: row.status, clubStatus: row.clubs.status, version: row.version,
        canEdit: covers(edit, row.clubs), canChangeStatus: covers(change, row.clubs), hasHistory: row._count.season_teams > 0 }));
    }
    return { items: items.slice(0, 50), nextAfter: items.length > 50 ? items[49].id : null };
  });
}

export async function maintainClubOrTeam(input: unknown) {
  const actor = await requireOperationalUser();
  return applyClubOrTeamMaintenance(actor.id, input);
}

/** Solo servidor: actorId debe proceder de la sesión, nunca del formulario. */
export async function applyClubOrTeamMaintenance(actorId: string, input: unknown) {
  const parsed = maintenanceSchema.safeParse(input);
  if (!parsed.success) throw new MaintenanceError("INVALID_INPUT");
  const data = parsed.data;
  return getPrisma().$transaction(async tx => {
    // Serializa bajas con las operaciones que ya adquieren el bloqueo RBAC compartido.
    await lockAuthorization(tx, "exclusive");
    const grants = await getPermissionGrants(tx, actorId, "clubs", data.operation === "edit" ? "UPDATE" : "APPROVE");
    const team = data.kind === "team" ? await tx.teams.findUnique({ where: { id: data.id } }) : null;
    const club = await tx.clubs.findUnique({ where: { id: data.kind === "club" ? data.id : team?.club_id ?? data.id },
      include: { leagues: { select: { is_active: true } } } });
    if (!club || !club.leagues.is_active || (data.kind === "team" && !team) || !covers(grants, club)) throw new AuthorizationError();
    const row = data.kind === "club" ? club : team!;
    if (row.version !== data.version) throw new MaintenanceError("CONFLICT");
    if (!["ACTIVE", "INACTIVE"].includes(row.status)) throw new MaintenanceError("INVALID_STATE");
    const update: { name?: string; status?: string; version: { increment: number } } = { version: { increment: 1 } };
    if (data.operation === "edit") {
      if (club.status !== "ACTIVE" || row.status !== "ACTIVE") throw new MaintenanceError("INVALID_STATE");
      const name = data.name!.replace(/\s+/g, " ");
      if (name === row.name) throw new MaintenanceError("INVALID_INPUT");
      const history = data.kind === "club"
        ? await tx.club_affiliations.count({ where: { club_id: club.id } }) + await tx.teams.count({ where: { club_id: club.id } })
        : await tx.season_teams.count({ where: { team_id: row.id } });
      if (history) throw new MaintenanceError("FORMAL_CHANGE_REQUIRED");
      const duplicate = data.kind === "club" ? await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sports_management.clubs WHERE league_id=${club.league_id}::uuid AND id<>${row.id}::uuid
          AND lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))=lower(${name}) LIMIT 1`
        : await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM sports_management.teams WHERE club_id=${club.id}::uuid AND id<>${row.id}::uuid
          AND lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))=lower(${name}) LIMIT 1`;
      if (duplicate.length) throw new MaintenanceError("DUPLICATE");
      update.name = name;
    } else {
      const target = data.operation === "deactivate" ? "INACTIVE" : "ACTIVE";
      if (row.status === target || (data.kind === "team" && club.status !== "ACTIVE")) throw new MaintenanceError("INVALID_STATE");
      update.status = target;
    }
    await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true), set_config('app.reason', ${data.reason}, true)`;
    const result = data.kind === "club"
      ? await tx.clubs.updateMany({ where: { id: row.id, version: data.version }, data: update })
      : await tx.teams.updateMany({ where: { id: row.id, version: data.version }, data: update });
    if (result.count !== 1) throw new MaintenanceError("CONFLICT");
    return { version: data.version + 1 };
  });
}

export async function getMaintenanceHistory(kind: "club" | "team", id: string) {
  const actor = await requireOperationalUser();
  if (!z.uuid().safeParse(id).success || !["club", "team"].includes(kind)) throw new MaintenanceError("INVALID_INPUT");
  return getPrisma().$transaction(async tx => {
    const grants = await getPermissionGrants(tx, actor.id, "clubs", "READ");
    const team = kind === "team" ? await tx.teams.findUnique({ where: { id }, select: { club_id: true } }) : null;
    const club = await tx.clubs.findUnique({ where: { id: kind === "club" ? id : team?.club_id ?? id },
      select: { id: true, league_id: true, leagues: { select: { is_active: true } } } });
    if (!club || !club.leagues.is_active || (kind === "team" && !team) || !covers(grants, club)) throw new AuthorizationError();
    const rows = await tx.audit_logs.findMany({ where: { entity_id: id, table_name: kind === "club" ? "clubs" : "teams", action: "UPDATE" },
      orderBy: [{ occurred_at: "desc" }, { id: "desc" }], take: 20,
      select: { id: true, occurred_at: true, reason: true } });
    return rows.map(row => ({ id: row.id, date: row.occurred_at.toISOString(), reason: row.reason }));
  });
}
