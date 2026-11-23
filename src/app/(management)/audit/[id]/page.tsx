import Link from "next/link";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuditInputError, getAuditDetail, parseAuditFilters } from "@/features/audit/server/queries";
import { AuditDetailView } from "@/features/audit/components/audit-workspace";

export const metadata={title:"Detalle de la operación"};
export default async function AuditDetailPage({params,searchParams}:{params:Promise<{id:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  let filters,entry;
  try {
    filters=parseAuditFilters(await searchParams);
    entry=await getAuditDetail((await params).id);
  } catch(error) {
    if(error instanceof AuthorizationError || error instanceof AuditInputError) return <div className="space-y-4 p-6"><p role="alert">Esta operación no está disponible para tu cuenta o el enlace no es válido.</p><Link href="/audit" className="underline">Volver a la bitácora</Link></div>;
    throw error;
  }
  return <AuditDetailView entry={entry} filters={filters} />;
}
