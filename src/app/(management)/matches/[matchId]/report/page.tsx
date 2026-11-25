import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { getReportPage } from "@/features/match-reports/server/service";
import { ReportDeviceWorkspace } from "@/features/match-reports/components/report-device-workspace";
import { ReportError } from "@/features/match-reports/contract";
export const metadata = { title: "Cédula del partido" };
export default async function Page({ params, searchParams }: { params: Promise<{ matchId: string }>; searchParams: Promise<{ modo?: string }> }) {
  const actor = await requireOperationalUser();
  let data;
  try { data = await getReportPage(actor.id, (await params).matchId); }
  catch (error) {
    if (!(error instanceof AuthorizationError) && !(error instanceof ReportError)) throw error;
    return <section><h1 className="text-2xl font-semibold">{error instanceof AuthorizationError ? "Acceso denegado" : "Cédula no disponible"}</h1><p>{error instanceof AuthorizationError ? "No tienes permiso vigente para este partido." : "No hay evidencia histórica disponible para esta cédula. No se reconstruye con datos actuales."}</p></section>;
  }
  return <ReportDeviceWorkspace key={actor.id + data.match.id} initialData={data} actorId={actor.id} onlineRequested={(await searchParams).modo === "en-linea"} />;
}
