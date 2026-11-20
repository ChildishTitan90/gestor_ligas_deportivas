"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { FormDialog } from "@/components/ui/form-dialog";
import { MatchReportList, type ReportMatchCard } from "./match-report-list";
import { primaryButton, secondaryButton } from "./report-shared";
import { readLocalReports, subscribeReports, type LocalReport } from "../offline/store.client";
import { prepareLocalReport } from "../offline/prepare.client";
import { offlineSupport } from "../offline/resources.client";

const subscribeCapabilities = () => () => {};
export function MatchReportOfflineList({ matches, actorId }: { matches: ReportMatchCard[]; actorId: string }) {
  const [local, setLocal] = useState<LocalReport[]>([]);
  const [preparing, setPreparing] = useState<string | null>(null);
  const [consent, setConsent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const capabilities = useSyncExternalStore(subscribeCapabilities, offlineSupport, () => null);
  const supported = storageFailed ? false : capabilities;
  const [incomplete, setIncomplete] = useState<string | null>(null);
  useEffect(() => {
    if (!supported) return;
    const read = () => void readLocalReports(actorId).then(setLocal).catch(() => {
      setStorageFailed(true); setLocal([]); setError("No se pudo abrir el almacenamiento local.");
    });
    read();
    return subscribeReports(read);
  }, [actorId, supported]);
  async function prepare(matchId: string) {
    setPreparing(matchId); setError("");
    try {
      await prepareLocalReport(actorId, matchId);
      setIncomplete(null);
      setConsent(null);
    } catch {
      setIncomplete(matchId);
      setError("Preparación incompleta. Comprueba la conexión y el espacio disponible. Puedes reintentar o capturar con conexión.");
    } finally { setPreparing(null); }
  }
  return <div className="space-y-4">
    {error && <p role="alert" className="rounded-xl border border-danger p-4 text-sm text-danger">{error}</p>}
    <MatchReportList matches={matches} renderActions={match => {
      const saved = local.find(row => row.actorId === actorId && row.matchId === match.id);
      const editable = ["CONFIRMED", "IN_PROGRESS"].includes(match.statusCode);
      return <div className="w-full space-y-3">
        <p role="status" className="text-sm">{preparing === match.id ? "Preparando partido y recursos…" : saved?.prepared ? "Disponible sin conexión" : supported === false ? "Solo con conexión" : "Preparación offline pendiente"}</p>
        <div className="flex flex-wrap gap-2">
          {saved?.prepared ? <><ActionLink href={`/matches/${match.id}/report`}>Abrir cédula</ActionLink><a className={secondaryButton} href={`/offline/report?match=${match.id}`}>Abrir copia del dispositivo</a></>
            : editable ? <>
              {supported !== false && <button type="button" className={primaryButton} disabled={supported === null || preparing !== null} onClick={() => setConsent(match.id)}>Preparar para usar sin conexión</button>}
              {(supported === false || incomplete === match.id) && <ActionLink href={`/matches/${match.id}/report?modo=en-linea`}>Capturar con conexión</ActionLink>}
            </> : <ActionLink variant="secondary" href={`/matches/${match.id}/report`}>Consultar cédula</ActionLink>}
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
