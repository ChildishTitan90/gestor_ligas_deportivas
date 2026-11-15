import { CalendarDays, MapPin } from "lucide-react";
import type { ReactNode } from "react";
import type { MatchReportPresentation, ReportMatchPresentation } from "../types";

export const secondaryButton = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary disabled:opacity-50";
export const primaryButton = "primary-action inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50";
export const inputClass = "min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground disabled:opacity-60";

export function ReportNotice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return <div className={`rounded-2xl border p-4 text-sm leading-6 ${danger ? "border-danger bg-danger-surface text-danger" : "border-border bg-soft text-foreground"}`}>{children}</div>;
}

export function SectionHeading({ number, title, children }: { number: string; title: string; children?: ReactNode }) {
  return <header className="mb-5 flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-soft text-sm font-bold text-primary" aria-hidden="true">{number}</span><div><h2 className="text-xl font-semibold text-primary">{title}</h2>{children && <p className="mt-1 text-sm leading-6 text-muted">{children}</p>}</div></header>;
}

export function MatchHeader({ match, report, compact = false }: { match: ReportMatchPresentation; report: MatchReportPresentation; compact?: boolean }) {
  const schedule = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" }).format(new Date(match.startsAt));
  return <header className="overflow-hidden rounded-3xl border border-border bg-surface">
    <div className={`flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 text-sm sm:px-7 ${compact ? "py-3" : "py-4"}`}>
      <span className="font-semibold text-muted">{match.number} · {match.matchday}</span>
      <div className="flex flex-wrap gap-2"><span className="rounded-full border border-border px-3 py-1">Partido: {match.status.label}</span><span className={`rounded-full border px-3 py-1 font-semibold ${report.status === "CONFIRMED" ? "border-positive bg-positive-surface text-positive" : "border-accent text-primary"}`}>Cédula: {report.status === "CONFIRMED" ? "Confirmada" : "Borrador"}</span></div>
    </div>
    <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-8 ${compact ? "py-4" : "py-7"}`}>
      {[match.home, match.away].map((team, index) => <div key={team.id} className={`min-w-0 text-center ${index ? "col-start-3 row-start-1" : "col-start-1 row-start-1"}`}>{!compact && <span className={`mx-auto mb-3 grid size-12 place-items-center rounded-2xl text-lg font-bold text-primary sm:size-16 ${index ? "border border-accent bg-background" : "bg-soft"}`} aria-hidden="true">{team.initials}</span>}<p className="text-xs text-muted">{index ? "Visitante" : "Local"}</p><p className="mt-1 text-sm font-semibold leading-5 text-primary sm:text-xl">{team.name}</p></div>)}
      <div className="col-start-2 row-start-1 text-center"><p className={`whitespace-nowrap font-semibold tracking-tight text-primary ${compact ? "text-2xl sm:text-3xl" : "text-3xl sm:text-5xl"}`}>{report.score.home ?? "–"}<span className="mx-2 text-xl text-muted sm:mx-4">:</span>{report.score.away ?? "–"}</p>{!compact && <p className="mt-2 text-xs text-muted">{report.status === "CONFIRMED" ? "Resultado de ejemplo" : "Marcador capturado"}</p>}</div>
    </div>
    <details open={!compact} className="border-t border-border bg-background px-5 py-2 sm:px-7"><summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-muted">Datos del encuentro · Temporada, cancha y horario</summary><dl className="grid gap-3 pb-3 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted">Temporada · Categoría · Grupo</dt><dd className="mt-1 font-medium">{match.season} · {match.category} · {match.group}</dd></div>
      <div className="space-y-2"><div className="flex items-center gap-2"><CalendarDays size={16} aria-hidden="true" /><dt className="sr-only">Horario</dt><dd>{schedule} · Morelia</dd></div><div className="flex items-center gap-2"><MapPin size={16} aria-hidden="true" /><dt className="sr-only">Cancha</dt><dd>{match.venue}</dd></div></div>
    </dl></details>
  </header>;
}
