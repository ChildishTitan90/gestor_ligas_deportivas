import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError, getPermissionGrants } from "@/server/auth/authorization";
import {playerClubScope as clubScope} from "./player-scope";
import { assertPlayerRegistrationRead, lockPlayerTeamContext, PlayerRegistrationError } from "./access";
import { registerPlayerSchema } from "../schemas";
import { sameIdentity } from "../identity-rules";
import { identityFromPerson, personIdentitySelect } from "./identity-matches";
import type { PlayerListItem, PlayerTeamOption } from "../types";

export async function canAccessPlayerRegistration() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    const create = await getPermissionGrants(tx, actor.id, "players", "CREATE");
    const read = await getPermissionGrants(tx, actor.id, "players", "READ");
    if (!create.length || !read.length) return false;
    return (await tx.clubs.count({ where: { AND: [clubScope(create), clubScope(read)], status: "ACTIVE", leagues: { is_active: true } } })) > 0;
  });
}

export async function getPlayerWorkspace() {
  const actor = await requireOperationalUser();
  const teams = await getPlayerTeamOptionsForActor(actor.id);
  return { actorId: actor.id, teams, initialPlayers:await listRegisteredPlayers(undefined,actor.id),providerConfigured: Boolean(process.env.VMX_API_KEY?.trim()) };
}

/** actorId procede de la sesión; entrada separada para comprobar el mismo catálogo. */
export async function getPlayerTeamOptionsForActor(actorId: string) {
  return getPrisma().$transaction(async tx => {
    const create = await getPermissionGrants(tx, actorId, "players", "CREATE");
    const read = await getPermissionGrants(tx, actorId, "players", "READ");
    if (!create.length || !read.length) throw new AuthorizationError();
    const scope: Prisma.clubsWhereInput = { AND: [clubScope(create), clubScope(read)], status: "ACTIVE", leagues: { is_active: true } };
    if (!await tx.clubs.count({ where: scope })) throw new AuthorizationError();
    const rows = await tx.season_teams.findMany({ where: { status: { not: "WITHDRAWN" }, teams: { status: "ACTIVE", clubs: scope },
      club_affiliations: { status: "APPROVED", seasons: { status: { not: "CLOSED" }, sports: { code: "SOCCER" } } } },
      select: { id: true },
      orderBy: { id: "asc" } });
    if (!rows.length) return [];
    // La proyección unida evita las ramas paralelas de relaciones de Prisma
    // sobre una sola conexión pg. El filtro autorizado permanece en la lectura anterior.
    // GROUP_STAGE sin grupo aún no permite altas; se conserva ese requisito.
    return tx.$queryRaw<PlayerTeamOption[]>`
      SELECT st.id, t.name AS "teamName", st.club_id AS "clubId", c.name AS "clubName",
        st.season_id AS "seasonId", s.name AS "seasonName", cat.name AS "categoryName", g.name AS "groupName"
      FROM sports_management.season_teams st
      JOIN sports_management.teams t ON t.id=st.team_id
      JOIN sports_management.clubs c ON c.id=t.club_id
      JOIN sports_management.club_affiliations a ON a.club_id=st.club_id AND a.season_id=st.season_id
      JOIN sports_management.seasons s ON s.id=a.season_id
      JOIN sports_management.groups g ON g.id=st.group_id AND g.season_id=st.season_id
      JOIN sports_management.season_categories sc ON sc.id=g.season_category_id
      JOIN sports_management.categories cat ON cat.id=sc.category_id
      WHERE st.id IN (${Prisma.join(rows.map(row=>Prisma.sql`${row.id}::uuid`))})
        AND EXISTS (SELECT 1 FROM sports_management.club_affiliation_categories ac
          WHERE ac.affiliation_id=a.id AND ac.category_id=sc.category_id
            AND ac.authorized_at IS NOT NULL AND ac.authorized_by IS NOT NULL)
      ORDER BY st.id
    `;
  }, { isolationLevel: "RepeatableRead" });
}

export async function listRegisteredPlayers(seasonTeamId?: string, expectedActorId?: string): Promise<PlayerListItem[]> {
  const actor = await requireOperationalUser();
  if (expectedActorId && actor.id !== expectedActorId.toLowerCase()) throw new AuthorizationError();
  return listRegisteredPlayersForActor(actor.id,seasonTeamId);
}
export async function listRegisteredPlayersForActor(actorId:string,seasonTeamId?:string):Promise<PlayerListItem[]>{
  if (seasonTeamId!==undefined && !z.uuid().safeParse(seasonTeamId).success) throw new PlayerRegistrationError("VALIDATION_ERROR", 400);
  return getPrisma().$transaction(async tx => {
    const create=await getPermissionGrants(tx,actorId,"players","CREATE"),read=await getPermissionGrants(tx,actorId,"players","READ");
    if(!create.length || !read.length)throw new AuthorizationError();
    if(seasonTeamId){await lockPlayerTeamContext(tx, actorId, seasonTeamId, "CREATE");await lockPlayerTeamContext(tx, actorId, seasonTeamId, "READ");}
    const rows = await tx.player_registrations.findMany({ where: { ...(seasonTeamId?{season_team_id: seasonTeamId}:{}),season_teams:{teams:{clubs:{AND:[clubScope(create),clubScope(read)]}}} },
      select: { id: true },
      orderBy: [{ registered_at: "desc" }, { id: "asc" }] });
    if (!rows.length) return [];
    return tx.$queryRaw<PlayerListItem[]>`
      SELECT pr.id AS "registrationId", CASE WHEN s.status='CLOSED' THEN
        CASE WHEN h.person_id IS NULL THEN 'Información histórica no disponible'
          ELSE concat_ws(' ',h.first_name,h.paternal_surname,h.maternal_surname) END
        ELSE concat_ws(' ',p.first_name,p.paternal_surname,p.maternal_surname) END AS "displayName",
        pr.jersey_number AS "jerseyNumber", pr.status, pr.identity_review_status AS "identityReviewStatus", pr.season_team_id AS "seasonTeamId",
        t.name AS "teamName", c.name AS "clubName", s.name AS "seasonName"
      FROM sports_management.player_registrations pr
      JOIN sports_management.people p ON p.id=pr.person_id
      JOIN sports_management.season_teams st ON st.id=pr.season_team_id
      JOIN sports_management.teams t ON t.id=st.team_id
      JOIN sports_management.clubs c ON c.id=t.club_id
      JOIN sports_management.seasons s ON s.id=st.season_id
      LEFT JOIN sports_management.season_person_identity_snapshots h
        ON h.season_id=s.id AND h.person_id=pr.person_id
      WHERE pr.id IN (${Prisma.join(rows.map(row=>Prisma.sql`${row.id}::uuid`))})
      ORDER BY pr.registered_at DESC, pr.id
    `;
  }, { isolationLevel: "RepeatableRead" });
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
