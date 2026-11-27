import { getAuditDetail } from "@/features/audit/server/queries";
import { auditHeaders, auditFailure } from "@/features/audit/server/http";

export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  try { return Response.json(await getAuditDetail((await params).id),{headers:auditHeaders}); }
  catch(error) { return auditFailure(error); }
}
