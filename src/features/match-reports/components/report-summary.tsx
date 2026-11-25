import { effectiveCaptain } from "../captaincy";
import Image from "next/image";
import { Check, ClipboardCheck } from "lucide-react";
import type { MatchReportPresentation, ReportDemoData } from "../types";
import { participationPeriods } from "../tactics";
import { ReportEvents } from "./report-events";
import { ReportNotice, SectionHeading } from "./report-shared";
import { proposedNoShowScore } from "../no-show";

export function ReportSummary({ data, report, live = false, issues }: {
  data: ReportDemoData; report: MatchReportPresentation; live?: boolean; issues: string[];
}) {
  const confirmed = report.status === "CONFIRMED";
  if(report.noShow) {
    const score=proposedNoShowScore(report.noShow);
    const absent=report.noShow.absent==="BOTH" ? "Ambos equipos" : report.noShow.absent==="HOME" ? data.match.home.name : data.match.away.name;
    return <section aria-label="Incomparecencia registrada" className="space-y-4 rounded-2xl border border-border bg-surface p-5">
      <h2 className="text-xl font-semibold">Incomparecencia registrada</h2><p>Equipo ausente: {absent}.</p>
      <p>{score ? `Marcador propuesto: ${data.match.home.name} ${score.home} – ${score.away} ${data.match.away.name}. Pendiente de resolución; no es un resultado oficial.` : "Ambos equipos faltaron. Pendiente de reprogramación; no se asignó ganador."}</p>
      <p className="whitespace-pre-wrap">Observaciones: {report.noShow.notes}</p>
    </section>;
  }
  return <section aria-label={confirmed ? "Consulta de cédula confirmada" : "Resumen previo a confirmar"} className="space-y-5">
    <SectionHeading number={confirmed ? "✓" : "05"} title={confirmed ? "Cédula confirmada · Solo consulta" : "Revisa antes de confirmar"}>{confirmed ? "La edición normal está deshabilitada. Un ajuste posterior requerirá el procedimiento autorizado." : "Este resumen reúne la captura que se usará para solicitar la confirmación."}</SectionHeading>
    {confirmed && <div className="flex items-start gap-3 rounded-2xl border border-positive bg-positive-surface p-5 text-positive"><ClipboardCheck size={24} className="shrink-0" aria-hidden="true" /><div><p className="font-semibold">{live ? "Cédula confirmada" : "Confirmación simulada"}</p><p className="mt-1 text-sm">{report.confirmedAt ? new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" }).format(new Date(report.confirmedAt)) : "Fecha de ejemplo no disponible"} · Versión {report.version}. {!live && "No existe resultado oficial, expediente ni actualización de tabla."}</p></div></div>}
    {!confirmed && issues.length > 0 && <div role="status" className="rounded-2xl border border-danger bg-danger-surface p-5"><h3 className="font-semibold text-danger">Falta revisar antes de confirmar</h3><ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-danger">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
    {!confirmed && !issues.length && <p className="flex items-center gap-2 rounded-xl bg-positive-surface p-4 text-sm font-semibold text-positive"><Check size={18} aria-hidden="true" /> {live ? "Captura completa para solicitar confirmación. La disponibilidad depende de los receptores de cierre." : "Captura completa para probar la confirmación simulada."}</p>}
    <div className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold text-primary">Marcador capturado</h3><p className="mt-3 text-center text-lg font-semibold">{data.match.home.shortName} <span className="mx-2 text-3xl">{report.score.home ?? "–"} : {report.score.away ?? "–"}</span> {data.match.away.shortName}</p></div>
    <div className="grid items-start gap-5 xl:grid-cols-2">{[data.match.home, data.match.away].map(team => {
      const rows = report.lineups.filter(row => row.selected && data.players.some(player => player.id === row.playerId && player.teamId === team.id));
      const signature = report.signatures[team.id];
      return <article key={team.id} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface"><h3 className="border-b border-border bg-soft p-4 font-semibold text-primary">{team.name} · {rows.length} convocados</h3><p className="border-b border-border p-4 text-sm text-muted">Formación: {report.tactics?.[team.id]?.formation === "CUSTOM" ? "Personalizada" : report.tactics?.[team.id]?.formation ?? "Sin indicar"}</p><ul className="divide-y divide-border">{rows.map(row => <li key={row.playerId} className="p-4 text-sm"><div className="flex items-start gap-3"><span className="min-w-8 font-bold text-primary">#{row.matchJersey ?? "–"}</span><div><p className="font-semibold">{data.players.find(player => player.id === row.playerId)?.name}{effectiveCaptain(report.captains[team.id], report.events, team.id) === row.playerId ? " · Capitán en cancha" : report.captains[team.id] === row.playerId ? " · Capitán inicial" : ""}</p><p className="mt-1 text-muted">{row.starter ? "Titular" : "Suplente"}</p>{participationPeriods(row, report.events).length ? participationPeriods(row, report.events).map((p, index) => <p key={index} className="mt-1 text-muted">P{p.periodNumber} · Entrada: {p.entryMinute ?? "pendiente"} · Salida: {p.exitMinute ?? "pendiente"} min</p>) : <p className="mt-1 text-muted">Sin tiempos registrados</p>}</div></div></li>)}</ul>{!rows.length && <p className="p-5 text-sm text-muted">Sin jugadores seleccionados.</p>}<div className="border-t border-border p-4"><p className="mb-2 text-sm font-semibold">Firma del capitán: {signature ? "capturada" : "pendiente"}</p>{signature && <><p className="mb-2 text-sm text-muted">Firmante: {data.players.find(player => player.id === signature.captainId)?.name ?? "Identidad no disponible"}</p><Image src={signature.image} width={600} height={200} unoptimized alt={`Firma ${signature.source === "synthetic" ? "sintética" : "capturada"} del capitán de ${team.shortName}`} className="h-auto w-full rounded-xl border border-border bg-white" /><p className="mt-2 text-xs text-muted">{signature.source === "synthetic" ? "Trazo sintético de demostración." : (live ? "Firma capturada para esta cédula; consulta privada." : "Firma trazada en dispositivo; solo memoria de esta página.")}</p></>}</div></article>;
    })}</div>
    <div><h3 className="mb-3 text-lg font-semibold text-primary">Eventos y cambios ({report.events.length})</h3><ReportEvents data={data} report={report} locked /></div>
    <div className="grid gap-5 lg:grid-cols-2"><article className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold text-primary">Observaciones</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm">{report.remarks || "Sin observaciones."}</p></article><article className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold text-primary">Incidencias</h3><p className="mt-3 whitespace-pre-wrap break-words text-sm">{report.incidents || "Sin incidencias anotadas."}</p></article></div>
    <ReportNotice>Los minutos vacíos siguen pendientes; no equivalen a cero. Las reglas pendientes de periodos, cruces y reingresos no se consideran autorizadas. La futura confirmación deberá reevaluar permisos, elegibilidad, versiones y estado antes de producir un resultado oficial.</ReportNotice>
  </section>;
}
