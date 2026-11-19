import "server-only";
import type { Prisma } from "@prisma/client";
import { ReportError } from "@/features/match-reports/contract";
import { reportAccess } from "@/features/match-reports/server/access";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";

/** reportAccess ya revalidó sesión, permiso de cédula y designación del árbitro. */
export async function recordReportNoShowInTransaction(tx:Prisma.TransactionClient,actorId:string,
  match:Awaited<ReturnType<typeof reportAccess>>,operationId:string) {
  await reportAccess(tx,actorId,match.id,"UPDATE");
  if(match.match_statuses.code!=="CONFIRMED") throw new ReportError("NO_SHOW_STATE_INVALID");
  const status=await tx.match_statuses.findUniqueOrThrow({where:{code:"NO_SHOW"},select:{id:true,code:true,name:true}});
  const grants=await assertPermission(tx,actorId,{module:"match-reports",action:"UPDATE",context:{matchId:match.id}});
  const roles=await tx.roles.findMany({where:{id:{in:grants.map(grant=>grant.roleId)},code:{in:["DATA_ENTRY","REFEREE"]}},select:{id:true}});
  const allowed=await tx.match_status_transitions.findFirst({where:{from_status_id:match.status_id,to_status_id:status.id,role_id:{in:roles.map(role=>role.id)}},select:{id:true}});
  if(!allowed) throw new AuthorizationError();
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','Registro de incomparecencia en cédula',true)`;
  const changed=await tx.matches.updateMany({where:{id:match.id,version:match.version,status_id:match.status_id,deleted_at:null},
    data:{status_id:status.id,version:{increment:1}}});
  if(changed.count!==1) throw new ReportError("STALE_VERSION");
  await tx.match_status_history.create({data:{id:operationId,match_id:match.id,previous_status_id:match.status_id,
    new_status_id:status.id,user_id:actorId,reason:"Incomparecencia registrada en cédula; pendiente de resolución",expected_version:match.version}});
  return {status_id:status.id,version:match.version+1,match_statuses:{code:status.code,name:status.name}};
}
