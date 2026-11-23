import Link from "next/link";
import { AuthorizationError } from "@/server/auth/authorization";
import { getAuditWorkspace, AuditInputError } from "@/features/audit/server/queries";
import { AuditWorkspaceView } from "@/features/audit/components/audit-workspace";

export const metadata={title:"Bitácora de operaciones"};
export default async function AuditPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  let workspace;
  try { workspace=await getAuditWorkspace(await searchParams); }
  catch(error) {
    if(error instanceof AuthorizationError) return <p role="alert" className="p-6">No tienes acceso a esta consulta de la bitácora.</p>;
    if(error instanceof AuditInputError) return <div className="space-y-4 p-6"><p role="alert">Los filtros o la página ya no son válidos. Vuelve al inicio de la consulta.</p><Link href="/audit" className="underline">Volver a la bitácora</Link></div>;
    throw error;
  }
  return <AuditWorkspaceView workspace={workspace} />;
}
