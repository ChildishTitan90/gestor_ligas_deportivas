import "server-only";
import type {Prisma} from "@prisma/client";
import type {PermissionGrant} from "@/server/auth/authorization";

export function playerClubScope(grants:readonly PermissionGrant[]):Prisma.clubsWhereInput{
  if(grants.some(g=>!g.contextOnly && !g.clubId && !g.leagueId))return {};
  const scopes=grants.flatMap((g):Prisma.clubsWhereInput[]=>g.clubId?[{id:g.clubId,...(g.leagueId?{league_id:g.leagueId}:{})}]:g.leagueId?[{league_id:g.leagueId}]:[]);
  return scopes.length?{OR:scopes}:{id:{in:[]}};
}
