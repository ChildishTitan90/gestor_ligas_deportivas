import "server-only";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuditInputError } from "./queries";

export const auditHeaders={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",Vary:"Cookie"};
export function auditFailure(error:unknown) {
  if(error instanceof AuthAccessError || error instanceof AuthorizationError || error instanceof AuditInputError)
    return Response.json({code:error.code},{status:error.status,headers:auditHeaders});
  return Response.json({code:"SERVICE_UNAVAILABLE"},{status:503,headers:auditHeaders});
}
export function auditSearchParams(url:string) {
  const query=new URL(url).searchParams;
  return Object.fromEntries([...new Set(query.keys())].map(key=>[key,query.getAll(key).length>1?query.getAll(key):query.get(key)]));
}
