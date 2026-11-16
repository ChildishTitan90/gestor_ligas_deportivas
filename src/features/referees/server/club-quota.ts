import "server-only";
import { Prisma } from "@prisma/client";
import type { ClubPresentation } from "../types";
/** Tras autorizar liga/temporada y todos los clubes consultados. No cuenta
 * solicitudes pendientes: solo relaciones incorporadas al padrón. */
export function readRefereeClubQuotas(tx:Prisma.TransactionClient,seasonId:string,clubIds?:string[]):Promise<(ClubPresentation&{presented:number})[]>{
  return tx.$queryRaw`SELECT c.id,c.name,c.reference_number AS code,ca.season_id AS "seasonId",
    (c.status='ACTIVE' AND ca.status='APPROVED') AS eligible,concat('Club: ',c.status,' · Afiliación: ',ca.status) AS context,
    (SELECT count(*)::int FROM sports_management.season_teams st JOIN sports_management.teams t ON t.id=st.team_id WHERE st.club_id=c.id AND st.season_id=ca.season_id AND st.status IN ('REGISTERED','ACTIVE') AND t.status='ACTIVE' AND c.status='ACTIVE' AND ca.status='APPROVED') AS "registeredTeams",
    (SELECT count(*)::int FROM sports_management.club_season_referees r WHERE r.club_id=c.id AND r.season_id=ca.season_id) AS presented
    FROM sports_management.clubs c JOIN sports_management.club_affiliations ca ON ca.club_id=c.id
    WHERE ca.season_id=${seasonId}::uuid ${clubIds?Prisma.sql`AND c.id=ANY(${clubIds}::uuid[])`:Prisma.empty} ORDER BY c.name,c.id`;
}
