import "server-only";
import type { Prisma } from "@prisma/client";
import { accountRoleCodes } from "../schemas";
import {
  assertRolePermissionCoverage, AuthorizationError, getActorPermissionGrants, grantCoversContext,
  type PermissionAction, type PermissionGrant, type ResolvedAuthorizationContext,
} from "@/server/auth/authorization";

/** actorId procede del servidor. Todas las lecturas y sus bloqueos pertenecen a tx. */
export async function readAccountCreationOptions(tx: Prisma.TransactionClient, actorId: string, leagueId?: string) {
  const grants = await getActorPermissionGrants(tx, actorId);
  const byPermission = new Map<string, PermissionGrant[]>();
  const key = (module: string, action: PermissionAction) => `${module}:${action}`;
  for (const grant of grants) {
    const id = key(grant.module, grant.action);
    const group = byPermission.get(id) ?? [];
    group.push(grant);
    byPermission.set(id, group);
  }
  const readGrants = (module: string, action: PermissionAction) => byPermission.get(key(module, action)) ?? [];
  const read = readGrants("users", "READ");
  if (!read.length) throw new AuthorizationError();
  const global = read.some((grant) => !grant.contextOnly && !grant.leagueId && !grant.clubId);
  const clubIds = [...new Set(read.flatMap((grant) => grant.clubId ? [grant.clubId] : []))];
  const clubScopes = clubIds.length ? await tx.$queryRaw<{ id: string; league_id: string }[]>`
    SELECT c.id, c.league_id FROM sports_management.clubs c
    JOIN sports_management.leagues l ON l.id = c.league_id
    WHERE c.id = ANY(${clubIds}::uuid[]) AND c.status = 'ACTIVE' AND l.is_active FOR SHARE OF c, l
  ` : [];
  const leagueIds = [...new Set([
    ...read.flatMap((grant) => grant.leagueId ? [grant.leagueId] : []),
    ...clubScopes.map((club) => club.league_id),
  ])];
  const leagues = await tx.$queryRaw<{ id: string; name: string }[]>`
    SELECT id, name FROM sports_management.leagues
    WHERE is_active AND (${global} OR id = ANY(${leagueIds}::uuid[])) ORDER BY name ASC FOR SHARE
  `;
  if (!global && !leagues.length) throw new AuthorizationError();
  if (leagueId && !leagues.some((league) => league.id === leagueId)) {
    // Conservar el contrato 400 para un ID inactivo/inexistente y 403 para liga ajena.
    const exists = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sports_management.leagues WHERE id = ${leagueId}::uuid AND is_active FOR SHARE
    `;
    return { invalidLeague: exists.length === 0 } as const;
  }
  const leagueWideRead = global || read.some((grant) => grant.leagueId === leagueId && !grant.clubId);
  const clubs = leagueId ? await tx.$queryRaw<{ id: string; name: string; reference_number: string }[]>`
    SELECT id, name, reference_number FROM sports_management.clubs
    WHERE league_id = ${leagueId}::uuid AND status = 'ACTIVE'
      AND (${leagueWideRead} OR id = ANY(${clubIds}::uuid[]))
    ORDER BY name ASC, id ASC LIMIT 100 FOR SHARE
  ` : [];
  const catalog = await tx.$queryRaw<{ id: string; code: string; name: string }[]>`
    SELECT id, code, name FROM sports_management.roles
    WHERE code = ANY(${[...accountRoleCodes]}::text[]) ORDER BY name ASC FOR SHARE
  `;
  const permissions = await tx.$queryRaw<{ roleId: string; module: string; action: PermissionAction }[]>`
    SELECT rp.role_id AS "roleId", p.module, p.action
    FROM sports_management.role_permissions rp JOIN sports_management.permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = ANY(${catalog.map((role) => role.id)}::uuid[]) FOR SHARE OF rp, p
  `;
  const byRole = new Map<string, typeof permissions>();
  for (const permission of permissions) {
    const group = byRole.get(permission.roleId) ?? [];
    group.push(permission);
    byRole.set(permission.roleId, group);
  }
  // Solo contextos procedentes de las relaciones activas leídas y bloqueadas arriba.
  const contexts = new Map<string, ResolvedAuthorizationContext>();
  const resolved = (league?: string, club?: string) => {
    const id = `${league ?? ""}:${club ?? ""}`;
    let context = contexts.get(id);
    if (!context) {
      context = { leagueId: league, clubIds: club ? [club] : [], hasContext: !!league || !!club };
      contexts.set(id, context);
    }
    return context;
  };
  const roles: { code: string; name: string }[] = [];
  for (const role of catalog) {
    const candidates = role.code === "SUPERADMIN" ? [resolved()]
      : (leagueId ? leagues.filter((league) => league.id === leagueId) : leagues).map((league) => resolved(league.id));
    if (role.code === "CLUB_DELEGATE") {
      candidates.push(...clubs.map((club) => resolved(leagueId, club.id)),
        ...(!leagueId ? clubScopes.map((club) => resolved(club.league_id, club.id)) : []));
    }
    for (const context of candidates) {
      if (!read.some((grant) => grantCoversContext(grant, context)) ||
          !readGrants("users", "CREATE").some((grant) => grantCoversContext(grant, context)) ||
          !readGrants("users", "UPDATE").some((grant) => grant.endsAt === null && grantCoversContext(grant, context))) continue;
      try {
        await assertRolePermissionCoverage(byRole.get(role.id) ?? [], context, readGrants);
        roles.push({ code: role.code, name: role.name });
        break;
      } catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
  }
  return { roles, leagues, clubs };
}
