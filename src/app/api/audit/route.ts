import { getAuditWorkspace } from "@/features/audit/server/queries";
import { auditHeaders, auditFailure, auditSearchParams } from "@/features/audit/server/http";

export async function GET(request:Request) {
  try { return Response.json(await getAuditWorkspace(auditSearchParams(request.url)),{headers:auditHeaders}); }
  catch(error) { return auditFailure(error); }
}
