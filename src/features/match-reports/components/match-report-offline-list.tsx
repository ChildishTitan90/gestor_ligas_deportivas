"use client";
import { useEffect, useState } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { FormDialog } from "@/components/ui/form-dialog";
import { MatchReportList, type ReportMatchCard } from "./match-report-list";
import { primaryButton, secondaryButton } from "./report-shared";
import { authorizeLocalAccount, readLocalReports, subscribeReports, type LocalReport } from "../offline/store.client";
import { prepareLocalReport } from "../offline/prepare.client";
import { offlineSupport } from "../offline/resources.client";

export function MatchReportOfflineList({ matches, actorId }: { matches: ReportMatchCard[]; actorId: string }) {
  const [local, setLocal] = useState<LocalReport[]>([]);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [consent, setConsent] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!offlineSupport()) return;
    const read = () => void readLocalReports().then(rows => setLocal(rows.filter(row => row.actorId === actorId))).catch(() => setError("No se pudo abrir el almacenamiento local."));
    read();
    return subscribeReports(read);
  }, [actorId]);
  async function prepare(matchId: string) {
    setPreparing(matchId); setError("");
    try {
      await authorizeLocalAccount(actorId);
      await prepareLocalReport(actorId, matchId);
      setConsent(null);
    } catch {
      setError("Preparación incompleta. Comprueba tu sesión, la designación y el espacio disponible. Para reabrir sin red se necesita la compilación de producción.");
    } finally { setPreparing(null); }
  }
  return <div className="space-y-4">
    {error && <p role="alert" className="rounded-xl border border-danger p-4 text-sm text-danger">{error}</p>}
    <MatchReportList matches={matches} renderActions={match => {
      const saved = local.find(row => row.matchId === match.id);
      return <div className="w-full space-y-3">
        <p role="status" className="text-sm">{preparing === match.id ? "Preparando partido y recursos…" : saved?.prepared ? "Disponible sin conexión" : "Preparación offline pendiente"}</p>
        <div className="flex flex-wrap gap-2">
          {saved?.prepared ? <><ActionLink href={`/matches/${match.id}/report`}>Abrir cédula</ActionLink><a className={secondaryButton} href={`/offline/report?match=${match.id}`}>Abrir copia del dispositivo</a></>
            : ["CONFIRMED", "IN_PROGRESS"].includes(match.statusCode) ? <button type="button" className={primaryButton} disabled={preparing !== null} onClick={() => {
              if (!offlineSupport()) { setError("Este navegador requiere HTTPS o localhost, IndexedDB, Service Worker y bloqueo entre pestañas."); return; }
              setConsent(match.id);
            }}>Preparar para usar sin conexión</button> : <ActionLink variant="secondary" href={`/matches/${match.id}/report`}>Consultar cédula</ActionLink>}
        </div>
      </div>;
    }} />
    <FormDialog open={consent !== null} title="Preparar en este dispositivo" description="Conservaremos el partido, las plantillas, su elegibilidad y tu borrador, incluidas las firmas, separados por cuenta." pending={preparing !== null} onClose={() => setConsent(null)}
      footer={<button className={primaryButton} type="button" disabled={preparing !== null} onClick={() => consent && void prepare(consent)}>{preparing ? "Descargando…" : "Aceptar y preparar"}</button>}>
      <p className="text-sm leading-6">La autorización local dura siete días. Usa un dispositivo personal protegido. El cierre de sesión explícito elimina las copias locales con advertencia si hay pendientes. La sesión vencida permite reautenticar con la misma cuenta y retomar.</p>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </FormDialog>
  </div>;
}
