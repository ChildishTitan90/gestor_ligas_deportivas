"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Download, LoaderCircle, TriangleAlert } from "lucide-react";
import { ActionLink } from "@/components/ui/action-link";
import { createReportDemo } from "../demo-data";
import { captureCases, downloadCases, offlinePreviewPath, offlinePreviewReportPath, type PreviewDownloadCase } from "../offline-preview";
import { MatchReportList } from "./match-report-list";
import { primaryButton, ReportNotice } from "./report-shared";

const { match } = createReportDemo();
const fixture = {
  id: match.id, number: match.number, status: "Asignado · Simulación", statusCode: match.status.code,
  startsAt: match.startsAt, season: match.season, category: match.category, group: match.group,
  matchday: 7, venue: match.venue, home: match.home.name, away: match.away.name,
};

const downloadStatus = {
  initial: ["Por preparar", "Con conexión, prepara este encuentro para ensayar cómo lo abrirías después sin red."],
  downloading: ["Descargando partido · Simulación", "Espera a que se complete la preparación antes de continuar."],
  incomplete: ["Descarga incompleta · Simulación", "El partido aún no está listo. Recupera la conexión y vuelve a intentar la descarga."],
  space: ["Espacio insuficiente · Simulación", "Libera espacio en el dispositivo y vuelve a intentar la descarga."],
  ready: ["Disponible sin conexión · Simulación", "La preparación del partido terminó en este escenario. Ya puedes abrir la cédula de ejemplo."],
} as const;

export function OfflinePreviewList({ scenario }: { scenario: PreviewDownloadCase }) {
  const [status, setStatus] = useState<keyof typeof downloadStatus>("initial");
  const [attempted, setAttempted] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const action = useRef<HTMLButtonElement>(null);
  const openReport = useRef<HTMLDivElement>(null);
  const focusOrigin = useRef<HTMLButtonElement | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (status === "downloading") return;
    const origin = focusOrigin.current;
    focusOrigin.current = null;
    if (!origin || (document.activeElement !== document.body && document.activeElement !== origin)) return;
    const target = status === "ready" ? openReport.current?.querySelector("a") : action.current;
    target?.focus();
  }, [status]);
  const failed = status === "incomplete" || status === "space";
  const Icon = status === "downloading" ? LoaderCircle : status === "ready" ? Check : failed ? TriangleAlert : Download;

  function prepare() {
    focusOrigin.current = document.activeElement === action.current ? action.current : null;
    setStatus("downloading");
    timer.current = setTimeout(() => {
      const outcome = attempted || scenario === "prepare" ? "ready" : scenario;
      setStatus(outcome);
      setAttempted(true);
    }, 1000);
  }

  return <div className="mx-auto max-w-6xl space-y-6">
    <ReportNotice><strong>Vista previa offline · Datos sintéticos.</strong> La descarga, la red y el guardado se simulan. La captura vive en esta página y se pierde al recargar o salir.</ReportNotice>
    <MatchReportList matches={[fixture]} renderActions={() => <div className="w-full space-y-3">
      <div className="rounded-2xl border border-border bg-background p-4">
        <p role="status" aria-atomic="true" className="flex items-start gap-3 text-sm">
          <Icon size={20} className={`mt-0.5 shrink-0 ${status === "downloading" ? "motion-safe:animate-spin" : ""} ${failed ? "text-danger" : status === "ready" ? "text-positive" : "text-primary"}`} aria-hidden="true" />
          <span><strong className="block">{downloadStatus[status][0]}</strong><span className="mt-1 block leading-6 text-muted">{downloadStatus[status][1]}</span></span>
        </p>
      </div>
      {status === "ready" ? <div ref={openReport}><ActionLink href={offlinePreviewReportPath} className="w-full sm:w-auto">Abrir cédula</ActionLink></div>
        : <button ref={action} type="button" className={`${primaryButton} w-full sm:w-auto`} disabled={status === "downloading"} onClick={prepare}>{status === "downloading" ? "Preparando partido…" : failed ? "Reintentar descarga" : "Preparar para usar sin conexión"}</button>}
    </div>} />
    <nav aria-label="Escenarios de preparación" className="space-y-3">
      <h2 className="text-lg font-semibold text-primary">Probar la descarga</h2>
      <div className="flex flex-wrap gap-2">{downloadCases.map(item => <ActionLink key={item.value} href={`${offlinePreviewPath}?case=${item.value}`} aria-current={scenario === item.value ? "page" : undefined} variant="secondary" className={scenario === item.value ? "w-full border-accent sm:w-auto" : "w-full sm:w-auto"}>{item.label}</ActionLink>)}</div>
    </nav>
    <nav aria-label="Escenarios de captura" className="space-y-3">
      <h2 className="text-lg font-semibold text-primary">Probar la captura y recuperación</h2>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{captureCases.map(item => <ActionLink key={item.value} href={`${offlinePreviewReportPath}?case=${item.value}`} variant="secondary">{item.label}</ActionLink>)}</div>
    </nav>
  </div>;
}
