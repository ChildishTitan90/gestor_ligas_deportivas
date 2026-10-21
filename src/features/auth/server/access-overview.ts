import "server-only";

import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import {
  AuthorizationError, getActorPermissionGrants, grantCoversContext, permissionActions, resolveAuthorizationContext,
  type AuthorizationContext, type PermissionAction, type PermissionGrant,
} from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";

// Etiquetas de presentación, no concesiones ni una segunda matriz de permisos.
const moduleLabels: Record<string, string> = {
  competitions: "Temporadas, categorías y reglas", clubs: "Clubes y equipos", players: "Jugadores",
  venues: "Canchas", scheduling: "Programación y partidos", "match-reports": "Cédulas",
  discipline: "Disciplina, recursos y bajas", billing: "Cobranza", refereeing: "Arbitraje",
  portal: "Publicación en el portal", users: "Usuarios y roles", audit: "Auditoría",
};
const actionLabels: Record<PermissionAction, string> = {
  CREATE: "Crear", READ: "Consultar", UPDATE: "Actualizar", APPROVE: "Aprobar", PUBLISH: "Publicar", IMPORT: "Importar",
};

export type AccessOverviewScope = {
  title: string;
  description: string;
  modules: { name: string; actions: { label: string; contextOnly: boolean }[] }[];
};

export async function getAccessOverview() {
  const actor = await requireOperationalUser();
  try {
    return await getPrisma().$transaction((tx) => readAccessOverview(tx, actor.id));
  } catch (error) {
    if (error instanceof AuthorizationError) throw error;
    // La página de error no recibe consultas, datos de cuentas ni conexiones.
    console.error("[access] OVERVIEW_UNAVAILABLE");
    throw new Error("No se pudo cargar el resumen de acceso.");
  }
}

/** actorId solo procede del servidor. El resumen no autoriza operaciones posteriores. */
export async function readAccessOverview(tx: Prisma.TransactionClient, actorId: string): Promise<AccessOverviewScope[]> {
  const grants = await getActorPermissionGrants(tx, actorId);
  const grouped = new Map<string, { context: AuthorizationContext; grants: PermissionGrant[] }>();
  for (const grant of grants) {
    if (!Object.hasOwn(moduleLabels, grant.module)) continue;
    const key = `${grant.leagueId ?? ""}:${grant.clubId ?? ""}`;
    const group = grouped.get(key) ?? { context: {
      ...(grant.leagueId ? { leagueId: grant.leagueId } : {}), ...(grant.clubId ? { clubId: grant.clubId } : {}),
    }, grants: [] };
    group.grants.push(grant);
    grouped.set(key, group);
  }

  const authorized = [];
  for (const group of grouped.values()) {
    try {
      const context = await resolveAuthorizationContext(tx, group.context);
      const covered = group.grants.filter((grant) => grantCoversContext(grant, context));
      if (covered.length) authorized.push({ context: group.context, leagueId: context.leagueId, grants: covered });
    } catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      // Un ámbito retirado/inactivo entre lecturas deja de aparecer; no amplía otro.
    }
  }
  if (!authorized.length) return [];

  const leagueIds = [...new Set(authorized.flatMap((group) => group.leagueId ? [group.leagueId] : []))];
  const clubIds = [...new Set(authorized.flatMap((group) => group.context.clubId ? [group.context.clubId] : []))];
  const leagues = await tx.leagues.findMany({ where: { id: { in: leagueIds } }, select: { id: true, name: true } });
  const clubs = await tx.clubs.findMany({ where: { id: { in: clubIds } }, select: { id: true, name: true } });
  const leagueNames = new Map(leagues.map((league) => [league.id, league.name]));
  const clubNames = new Map(clubs.map((club) => [club.id, club.name]));

  return authorized.map((group) => ({
    title: group.context.clubId ? clubNames.get(group.context.clubId)! : group.leagueId ? leagueNames.get(group.leagueId)! : "Gestión general",
    description: group.context.clubId ? leagueNames.get(group.leagueId!)! : group.leagueId ? "Permisos en esta liga" : "Permisos de alcance general",
    modules: Object.entries(moduleLabels).flatMap(([module, name]) => {
      const actions = permissionActions.flatMap((action) => {
        const matching = group.grants.filter((grant) => grant.module === module && grant.action === action);
        return matching.length ? [{ label: actionLabels[action], contextOnly: matching.every((grant) => grant.contextOnly) }] : [];
      });
      return actions.length ? [{ name, actions }] : [];
    }),
  })).sort((a, b) => a.title.localeCompare(b.title, "es") || a.description.localeCompare(b.description, "es"));
}
