import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { getReportPage } from "@/features/match-reports/server/service";
import { ReportWorkspace } from "@/features/match-reports/components/report-workspace";
import { ReportError } from "@/features/match-reports/contract";
export const metadata = { title: "Cédula del partido" };
export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  const actor = await requireOperationalUser();
  let data;
  try { data = await getReportPage(actor.id, (await params).matchId); }
  catch (error) {
    if (!(error instanceof AuthorizationError) && !(error instanceof ReportError)) throw error;
    return <section><h1 className="text-2xl font-semibold">{error instanceof AuthorizationError ? "Acceso denegado" : "Cédula no disponible"}</h1><p>{error instanceof AuthorizationError ? "No tienes permiso vigente para este partido." : "No hay evidencia histórica disponible para esta cédula. No se reconstruye con datos actuales."}</p></section>;
  }
  return <ReportWorkspace data={data} live={{ actorId: actor.id }} />;
}
