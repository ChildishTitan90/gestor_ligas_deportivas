"use client";

import Image from "next/image";
import { effectiveCaptain } from "../captaincy";
import { useEffect, useRef } from "react";
import { DirectSignatureField } from "@/components/ui/direct-signature-field";
import type { CaptainSignature, MatchReportPresentation, ReportDemoData } from "../types";
import { inputClass, ReportNotice, SectionHeading } from "./report-shared";

function CaptainSignatureField({ captainId, label, disabled, onSignature }: {
  captainId: string; label: string; disabled: boolean;
  onSignature: (signature: CaptainSignature | null) => void;
}) {
  const revision = useRef(0);
  useEffect(() => () => { revision.current += 1; }, []);
  function change(file: File | null) {
    const current = ++revision.current;
    if (!file) { onSignature(null); return; }
    const reader = new FileReader();
    reader.onload = () => {
      if (revision.current === current && typeof reader.result === "string") onSignature({ captainId, image: reader.result, source: "device" });
    };
    reader.readAsDataURL(file);
  }
  return <DirectSignatureField label={label} disabled={disabled} onChange={change} />;
}

export function ReportClosing({ data, report, live = false, locked, signatureEpoch, onScore, onRemarks, onIncidents, onSignature }: {
  data: ReportDemoData; report: MatchReportPresentation; live?: boolean; locked: boolean; signatureEpoch: number;
  onScore: (side: "home" | "away", value: number | null) => void;
  onRemarks: (value: string) => void; onIncidents: (value: string) => void;
  onSignature: (teamId: string, signature: CaptainSignature | null) => void;
}) {
  return <section aria-label="Marcador, observaciones y firmas">
    <SectionHeading number="04" title="Cierre y firmas">Revisa el marcador y lo ocurrido antes de pedir la firma de los capitanes.</SectionHeading>
    <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6"><h3 className="mb-4 font-semibold text-primary">Marcador</h3><div className="grid grid-cols-2 gap-4">{(["home", "away"] as const).map(side => <label key={side} className="font-medium">{data.match[side].name}<input type="number" min="0" step="1" value={report.score[side] ?? ""} disabled={locked} onChange={event => onScore(side, event.target.value === "" ? null : Number(event.target.value))} className={`${inputClass} text-center text-3xl font-semibold`} /></label>)}</div><p className="mt-3 text-sm text-muted">El marcador se captura de forma explícita. {live ? "Debe coincidir con los goles registrados; el servidor comprueba esa consistencia." : "Los eventos no lo modifican automáticamente en esta demo."}</p></div>
    <div className="my-5 grid gap-5 lg:grid-cols-2"><label className="block font-medium">Observaciones generales<textarea rows={5} value={report.remarks} disabled={locked} onChange={event => onRemarks(event.target.value)} maxLength={8000} className={inputClass} placeholder="Describe lo necesario para el cierre del partido…" /></label><label className="block font-medium">Incidencias<textarea rows={5} value={report.incidents} disabled={locked} onChange={event => onIncidents(event.target.value)} maxLength={8000} className={inputClass} placeholder="Anota incidencias y registra como evento cualquier incidente grave…" /><span className="mt-2 block text-sm font-normal text-muted">Un incidente grave se registra también en Eventos. La cédula no impone sanciones.</span></label></div>
    <div className="mb-5"><ReportNotice><strong>Firmar esta captura.</strong> Si cambias alineaciones, tiempos, eventos, marcador u observaciones después de firmar, se retiran ambas firmas y deben capturarse otra vez. {live ? "Al guardar se envían a almacenamiento privado; requieren acuse." : "No se envían ni almacenan en esta demostración."}</ReportNotice></div>
    <div className="grid items-start gap-5 lg:grid-cols-2">{[data.match.home, data.match.away].map(team => {
      const captain = data.players.find(player => player.id === effectiveCaptain(report.captains[team.id],report.events,team.id));
      const signature = report.signatures[team.id];
      return <article key={team.id} className="min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-5 [&_button]:min-h-12"><h3 className="font-semibold text-primary">Capitán · {team.name}</h3><p className="mt-1 mb-4 text-sm text-muted">{captain?.name ?? "Selecciona al capitán en Alineaciones."}</p>
        {(report.status === "CONFIRMED" || (live && signature)) ? signature ? <><Image src={signature.image} width={600} height={200} unoptimized alt={`Firma ${signature.source === "synthetic" ? "sintética de ejemplo" : "capturada en este dispositivo"} del capitán de ${team.shortName}`} className="h-auto w-full rounded-xl border border-border bg-white" /><p className="mt-2 text-sm text-muted">{signature.source === "synthetic" ? "Firma sintética · No pertenece a una persona." : (live ? "Firma privada vinculada a la cédula." : "Captura en dispositivo · Solo memoria de esta demo.")}</p>{live && report.status !== "CONFIRMED" && <button type="button" disabled={locked} className="mt-3 rounded-xl border border-border px-4 py-3 text-sm font-semibold" onClick={() => onSignature(team.id, null)}>Volver a capturar firma</button>}</> : <p>Sin firma disponible.</p>
          : <CaptainSignatureField key={`${signatureEpoch}-${captain?.id ?? "none"}`} captainId={captain?.id ?? ""} label={`Firma del capitán de ${team.shortName}`} disabled={locked || !captain} onSignature={value => onSignature(team.id, value)} />}
        <p className={`mt-3 text-sm font-semibold ${signature ? "text-positive" : "text-muted"}`} role="status">{signature ? (live ? "Firma lista en esta captura" : "Firma lista en memoria · Sin envío") : "Firma pendiente"}</p>
      </article>;
    })}</div>
  </section>;
}
