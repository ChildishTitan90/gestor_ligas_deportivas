import "server-only";

import type { Prisma } from "@prisma/client";
import type { AccountPresentation, AuthIdentity, CurrentAccount } from "../types";
import { getPrisma } from "@/server/db/prisma";
import { getAuthSession } from "@/server/auth/session";
import { AuthorizationError, resolveAuthorizationContext } from "@/server/auth/authorization";

export async function getCurrentAccount({ includeAssignments = false } = {}): Promise<CurrentAccount | null> {
  const session = await getAuthSession();
  if (!session?.user) return null;
  const identity = session.user;
  const account = await getPrisma().$transaction((tx) =>
    readAccountPresentation(tx, identity, includeAssignments && !identity.mustChangePassword));
  return account ? { account, mustChangePassword: identity.mustChangePassword } : null;
}

/** Identidad obtenida del servidor. Sin caché, JWT ni consultas por permiso. */
export async function readAccountPresentation(
  tx: Prisma.TransactionClient, actor: AuthIdentity, includeAssignments: boolean,
): Promise<AccountPresentation | null> {
  const user = await tx.users.findUnique({
    where: { id: actor.id, is_active: true },
    select: { username: true, people: { select: { first_name: true, paternal_surname: true, maternal_surname: true } } },
  });
  if (!user) return null;
  const names = [user.people.first_name, user.people.paternal_surname, user.people.maternal_surname]
    .map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  const assignments: string[] = [];
  const roleNames = new Set<string>();
  if (includeAssignments && !actor.mustChangePassword) {
    // Una lectura agrupada evita consultas paralelas de relaciones sobre el mismo
    // cliente transaccional de pg. Vigencia calculada con el reloj del servidor.
    const roles = await tx.$queryRaw<{
      leagueId: string | null; clubId: string | null; roleName: string;
      leagueName: string | null; clubName: string | null;
    }[]>`
      SELECT ur.league_id AS "leagueId", ur.club_id AS "clubId", r.name AS "roleName",
        l.name AS "leagueName", c.name AS "clubName"
      FROM sports_management.user_roles ur
      JOIN sports_management.roles r ON r.id = ur.role_id
      LEFT JOIN sports_management.leagues l ON l.id = ur.league_id
      LEFT JOIN sports_management.clubs c ON c.id = ur.club_id
      WHERE ur.user_id = ${actor.id}::uuid AND ur.starts_at <= clock_timestamp()
        AND (ur.ends_at IS NULL OR ur.ends_at > clock_timestamp())
    `;
    const validScopes = new Map<string, boolean>();
    for (const role of roles) {
      const key = `${role.leagueId ?? ""}:${role.clubId ?? ""}`;
      if (!validScopes.has(key)) {
        try {
          await resolveAuthorizationContext(tx, {
            ...(role.leagueId ? { leagueId: role.leagueId } : {}), ...(role.clubId ? { clubId: role.clubId } : {}),
          });
          validScopes.set(key, true);
        } catch (error) {
          if (!(error instanceof AuthorizationError)) throw error;
          validScopes.set(key, false);
        }
      }
      if (validScopes.get(key)) {
        roleNames.add(role.roleName);
        assignments.push([role.roleName, role.clubName, role.leagueName].filter(Boolean).join(" · "));
      }
    }
  }
  return {
    name: names.join(" ") || "Mi cuenta",
    // Algunas cuentas heredadas usan el correo como username: no publicarlo.
    username: user.username.includes("@") ? null : user.username,
    initials: [names[0], names[1]].filter(Boolean).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("es") || "MC",
    roleNames: [...roleNames].sort((a, b) => a.localeCompare(b, "es")),
    assignments: [...new Set(assignments)].sort((a, b) => a.localeCompare(b, "es")),
  };
}
