"use client";
import { useEffect, useState } from "react";
import { ManagementShell } from "@/components/layout/management-shell";
import { readLocalReports, clearLocalReports, type LocalReport } from "../offline/store.client";
import { ReportDeviceWorkspace } from "./report-device-workspace";
import { primaryButton, secondaryButton } from "./report-shared";
import { FormDialog } from "@/components/ui/form-dialog";
import { useRouter } from "next/navigation";

export function OfflineReportApp() {
  const router = useRouter();
  const [reports, setReports] = useState<LocalReport[] | null>(null);
  const [matchId, setMatchId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [erase, setErase] = useState(false);
  useEffect(() => {
    void readLocalReports().then(rows => {
      setMatchId(new URL(location.href).searchParams.get("match")); setReports(rows);
    }).catch(() => setError("No se pudo abrir el almacenamiento de este navegador."));
  }, []);
  const selected = reports?.find(report => report.matchId === matchId);
  return <ManagementShell account={{ username: null, initials: "AR", roleNames: ["Cédulas en este dispositivo"] }}
    navigation={[{ label: "Arbitraje", items: [{ href: "/offline/report", label: "Mis partidos preparados", icon: "players" }] }]}>
    <div className="mx-auto max-w-6xl space-y-5">
      <p className="text-sm text-muted">Copia de trabajo del dispositivo · La sincronización vuelve a verificar tu cuenta y tu designación.</p>
      {selected ? <ReportDeviceWorkspace actorId={selected.actorId} restored={selected} /> : <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-primary">Mis cédulas en este dispositivo</h1>
        {error && <p role="alert">{error}</p>}
        {!reports && !error && <p role="status">Consultando borradores…</p>}
        {reports?.length === 0 && <p>No hay copias locales vigentes. Recupera conexión, inicia sesión y prepara un partido autorizado. Las copias vencidas requieren reautenticación y preparación para volver a abrirse.</p>}
        {reports?.map(report => <article key={report.draftId} className="space-y-3 rounded-2xl border border-border bg-surface p-5">
          <h2 className="font-semibold">{report.data.match.number} · {report.data.match.home.name} – {report.data.match.away.name}</h2>
          <p className="text-sm">{report.data.match.season} · {report.data.match.venue}</p>
          <p className="text-sm">Borrador {report.draftId.slice(0, 8)} · Revisión {report.revision} · Último acuse {report.acknowledgedRevision} · {report.prepared ? "Disponible sin conexión" : "Recursos de reapertura pendientes"}</p>
          <a className={primaryButton} href={`/offline/report?match=${report.matchId}`}>Retomar cédula</a>
        </article>)}
        <a className={secondaryButton} href="/matches">Consultar mis partidos con conexión</a>
      </section>}
      <button className={secondaryButton} type="button" onClick={() => setErase(true)}>Eliminar copias de este dispositivo</button>
      <FormDialog open={erase} title="Eliminar las copias locales" description="Se eliminarán también los borradores y operaciones pendientes de sincronizar de este navegador." onClose={() => setErase(false)}
        footer={<button className={primaryButton} type="button" onClick={() => void clearLocalReports().then(() => {
          setReports([]); setMatchId(null); setErase(false);
          if (navigator.onLine) router.replace("/login");
        }).catch(() => setError("No se pudieron eliminar las copias locales."))}>Eliminar copias locales</button>}>
        <p>Los acuses y borradores ya recibidos por el servidor permanecen en la base. Revisa tus pendientes antes de continuar.</p>
      </FormDialog>
    </div>
  </ManagementShell>;
}
