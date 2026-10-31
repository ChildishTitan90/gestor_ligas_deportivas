"use client";

import { useId, useState, type FormEvent } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { SelectField } from "@/components/ui/select-field";
import { emptyReviewFilters, reviewSeasonKey, type ReviewFilters } from "../affiliation-review-filters";
import type { ReviewSummary } from "../affiliation-review-model";

export function AffiliationReviewFilters({ leagues, items, sourceLeague, sourceStatus, busy, onQuery }: {
  leagues: { id: string; name: string }[];
  items: readonly ReviewSummary[];
  sourceLeague: string;
  sourceStatus: ReviewSummary["status"];
  busy: boolean;
  onQuery: (leagueId: string, status: ReviewSummary["status"], filters: ReviewFilters) => void;
}) {
  const id = useId();
  const [league, setLeague] = useState(leagues.length === 1 ? leagues[0].id : "");
  const [status, setStatus] = useState<ReviewSummary["status"]>("PENDING");
  const [search, setSearch] = useState("");
  const [season, setSeason] = useState("");
  const [phase, setPhase] = useState<ReviewFilters["phase"]>("ALL");
  const [expanded, setExpanded] = useState(false);
  const contextItems = league === sourceLeague && status === sourceStatus ? items : [];
  const seasons = [...new Map(contextItems.map(item => [reviewSeasonKey(item), { value: reviewSeasonKey(item), label: item.seasonName }])).values()]
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const count = Number(status !== "PENDING") + Number(status === "PENDING" && phase !== "ALL") + Number(!!season);
  const secondary = "min-h-12 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary disabled:opacity-50";
  function query(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onQuery(league, status, { search: search.trim(), season, phase: status === "PENDING" ? phase : "ALL", page: 1 });
  }
  return <form onSubmit={query} className="space-y-4 rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-busy={busy}>
    <label htmlFor={`${id}-search`} className="block text-sm font-semibold">Buscar solicitud</label>
    <div className="flex flex-col gap-3 sm:flex-row">
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" size={19} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
        <input id={`${id}-search`} name="search" value={search} onChange={event => setSearch(event.target.value)} maxLength={200}
          disabled={busy} placeholder="Folio o nombre del club" className="min-h-12 w-full rounded-xl border border-border bg-surface py-3 pr-3 pl-11 text-base disabled:opacity-50" />
      </div>
      <button type="submit" disabled={busy || !league || !leagues.length} className="primary-action min-h-12 rounded-xl px-6 py-3 text-sm font-semibold disabled:opacity-50">{busy ? "Consultando…" : "Buscar"}</button>
    </div>
    <button type="button" aria-expanded={expanded} aria-controls={`${id}-filters`} disabled={busy} onClick={() => setExpanded(value => !value)}
      className={`${secondary} flex w-full items-center justify-center gap-2 lg:hidden`}><SlidersHorizontal size={18} aria-hidden="true" />Filtros{count ? ` (${count})` : ""}</button>
    <div id={`${id}-filters`} className={`${expanded ? "grid" : "hidden"} gap-4 lg:grid lg:grid-cols-2 xl:grid-cols-3`}>
      <div><label htmlFor={`${id}-league`} className="mb-2 block text-sm font-medium">Liga</label>
        <SelectField id={`${id}-league`} name="leagueId" required value={league} disabled={busy || !leagues.length}
          onValueChange={value => { setLeague(value); setSeason(""); }} options={leagues.map(item => ({ value: item.id, label: item.name }))} />
      </div>
      <fieldset disabled={busy} className="min-w-0"><legend className="mb-2 text-sm font-medium">Estado</legend>
        <div className="flex rounded-xl border border-border p-1">
          {([ ["PENDING", "Pendientes"], ["APPROVED", "Aprobadas"] ] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={status === value}
            className={`min-h-11 flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${status === value ? "bg-soft text-primary" : "text-muted"}`}
            onClick={() => { setStatus(value); setSeason(""); }}>{label}</button>)}
        </div>
      </fieldset>
      <div><label htmlFor={`${id}-phase`} className="mb-2 block text-sm font-medium">Fase (solo pendientes)</label>
        <SelectField id={`${id}-phase`} value={phase} disabled={busy || status !== "PENDING"} onValueChange={value => setPhase(value as ReviewFilters["phase"])}
          options={[{ value: "ALL", label: "Todas" }, { value: "AWAITING_REVIEW", label: "Por revisar" }, { value: "CORRECTIONS_REQUESTED", label: "Correcciones solicitadas" }]} />
      </div>
      <div><label htmlFor={`${id}-season`} className="mb-2 block text-sm font-medium">Temporada</label>
        <SelectField id={`${id}-season`} value={season} disabled={busy || !seasons.length} onValueChange={setSeason}
          options={[{ value: "", label: "Todas las temporadas" }, ...seasons]} />
      </div>
      <div className="flex items-end"><button type="button" disabled={busy} className={secondary} onClick={() => {
        setSearch(""); setSeason(""); setPhase("ALL"); setStatus("PENDING"); onQuery(league, "PENDING", { ...emptyReviewFilters });
      }}>Limpiar filtros</button></div>
    </div>
    <p className="text-xs leading-6 text-muted">{status === "APPROVED" ? "Aprobadas" : "Pendientes"} · {phase === "ALL" || status === "APPROVED" ? "Todas las fases" : phase === "AWAITING_REVIEW" ? "Por revisar" : "Correcciones solicitadas"} · {leagues.find(item => item.id === league)?.name ?? "Sin liga seleccionada"}. Aplica tu selección con Buscar.</p>
    {!league && leagues.length > 0 && <p className="text-sm text-muted">Selecciona una liga en Filtros para consultar sus solicitudes.</p>}
    {!leagues.length && <p>No tienes ligas disponibles para consultar esta bandeja.</p>}
  </form>;
}
