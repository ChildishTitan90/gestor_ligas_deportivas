"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Files, Fingerprint, RefreshCw, Search, ShieldCheck, UsersRound } from "lucide-react";
import { SelectField } from "@/components/ui/select-field";
import { ActionLink } from "@/components/ui/action-link";
import type { PlayerReviewItem, PlayerReviewKind } from "../review-workspace";

const groups = [
  { value: "ALL", label: "Todas las revisiones", icon: Files },
  { value: "IDENTITY", label: "Posibles coincidencias", icon: UsersRound },
  { value: "INE", label: "INE y selfie", icon: Fingerprint },
  { value: "DOCUMENTS", label: "Documentos y tutor", icon: ShieldCheck },
] as const;
const labels: Record<PlayerReviewKind, { name: string; action: string }> = {
  IDENTITY: { name: "Posible coincidencia", action: "Comparar identidades" },
  INE: { name: "INE y selfie", action: "Revisar evidencias" },
  DOCUMENTS: { name: "Documentos y tutor", action: "Revisar documentos" },
};
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" });
const secondary = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-primary hover:bg-soft disabled:opacity-50";

function ReviewAction({ item }: { item: PlayerReviewItem }) {
  const href = item.kind === "IDENTITY" ? `/players/review/${item.id}` : item.kind === "INE" ?
    `/players/registrations/${item.id}/documents` : `/players/review/${item.id}/documents`;
  return <ActionLink href={href} prefetch={false} aria-label={`${labels[item.kind].action} de ${item.name}`} className="w-full whitespace-nowrap lg:w-auto">{labels[item.kind].action}</ActionLink>;
}

function ReviewReason({ item }: { item: PlayerReviewItem }) {
  return <div className="space-y-2"><span className="inline-flex rounded-full border border-accent bg-soft px-3 py-1 text-xs font-semibold text-primary">{labels[item.kind].name}</span><p className="max-w-sm text-sm leading-6 text-muted">{item.reason}</p></div>;
}

export function PlayerReviewWorkspace({ items }: { items: readonly PlayerReviewItem[] }) {
  const prefix = useId();
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const [kind, setKind] = useState<"ALL" | PlayerReviewKind>("ALL");
  const [search, setSearch] = useState("");
  const [clubId, setClubId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const clubOptions = [...new Map(items.map(item => [item.clubId, { value: item.clubId, label: item.club }])).values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
  const seasonOptions = [...new Map(items.map(item => [item.seasonId, { value: item.seasonId, label: item.season }])).values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
  // Una opción retirada tras refrescar deja de filtrar; nunca se elige otra automáticamente.
  const selectedClub = clubOptions.some(option => option.value === clubId) ? clubId : "";
  const selectedSeason = seasonOptions.some(option => option.value === seasonId) ? seasonId : "";
  const query = normalize(search);
  const visible = items.filter(item => (kind === "ALL" || item.kind === kind) && (!selectedClub || item.clubId === selectedClub) &&
    (!selectedSeason || item.seasonId === selectedSeason) && normalize(`${item.name} ${item.team} ${item.club} ${item.season} ${item.category}`).includes(query));
  const filtered = kind !== "ALL" || !!query || !!selectedClub || !!selectedSeason;
  function clearFilters() { setSearch(""); setKind("ALL"); setClubId(""); setSeasonId(""); }

  return <div className="space-y-6" aria-busy={refreshing}>
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold text-primary">Revisión de identidad</h1><p className="mt-2 max-w-2xl leading-7 text-muted">Encuentra al jugador y abre el caso que necesita tu revisión.</p></div>
      <button type="button" className={secondary} disabled={refreshing} onClick={() => startTransition(() => router.refresh())}><RefreshCw aria-hidden="true" size={18} className={refreshing ? "motion-safe:animate-spin" : ""} />{refreshing ? "Actualizando…" : "Actualizar bandeja"}</button>
    </header>

    <div role="group" aria-label="Tipo de revisión" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {groups.map(group => <button key={group.value} type="button" aria-pressed={kind === group.value} onClick={() => setKind(group.value)}
        className={`flex min-h-24 flex-col items-start gap-2 rounded-2xl border p-4 text-left motion-safe:transition-colors sm:flex-row sm:items-center sm:gap-4 ${kind === group.value ? "border-accent bg-soft ring-1 ring-accent" : "border-border bg-surface hover:bg-soft"}`}>
        <group.icon size={24} aria-hidden="true" className="shrink-0 text-primary" /><span className="min-w-0"><span className="block text-2xl font-semibold text-primary">{group.value === "ALL" ? items.length : items.filter(item => item.kind === group.value).length}</span><span className="block text-xs font-medium text-muted sm:text-sm">{group.label}</span></span>
      </button>)}
    </div>

    <section aria-label="Filtros de revisión" className="rounded-2xl border border-border bg-surface p-5">
      <div className="grid items-end gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="space-y-2 sm:col-span-2"><label htmlFor={`${prefix}-search`} className="block text-sm font-medium text-primary">Buscar jugador, equipo o categoría</label><div className="relative"><Search size={18} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-muted" /><input id={`${prefix}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Escribe un nombre o equipo" className="min-h-12 w-full rounded-xl border border-border bg-background py-3 pr-4 pl-11 text-primary" /></div></div>
        <div className="space-y-2"><label htmlFor={`${prefix}-club`} className="block text-sm font-medium text-primary">Club</label><SelectField id={`${prefix}-club`} options={[{ value: "", label: "Todos los clubes" }, ...clubOptions]} value={selectedClub} onValueChange={setClubId} /></div>
        <div className="space-y-2"><label htmlFor={`${prefix}-season`} className="block text-sm font-medium text-primary">Temporada</label><SelectField id={`${prefix}-season`} options={[{ value: "", label: "Todas las temporadas" }, ...seasonOptions]} value={selectedSeason} onValueChange={setSeasonId} /></div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p role="status" className="text-sm text-muted">{refreshing ? "Consultando casos autorizados…" : `${visible.length} de ${items.length} casos en tu alcance`}</p><button type="button" disabled={!filtered} onClick={clearFilters} className={`${secondary} min-h-11 px-3 py-2`}>Limpiar filtros</button></div>
    </section>

    {!visible.length ? <section className="rounded-2xl border border-border bg-surface p-8 text-center" aria-label="Resultado de revisión">
      <CheckCircle2 size={36} aria-hidden="true" className="mx-auto mb-4 text-muted" />
      <h2 className="text-lg font-semibold text-primary">{items.length ? "No hay casos que coincidan con los filtros" : "No hay revisiones pendientes"}</h2>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">{items.length ? "Prueba otro nombre, club o temporada, o limpia los filtros para ver todos los casos." : "Aquí aparecerán las posibles coincidencias, las verificaciones que necesitan revisión y los documentos vigentes por revisar."}</p>
      {items.length > 0 && <button type="button" className={`${secondary} mt-5`} onClick={clearFilters}>Ver todos los casos</button>}
    </section> : <>
      <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface lg:block"><table aria-label="Casos pendientes de revisión" className="w-full text-left text-sm">
        <thead className="border-b border-border bg-soft text-muted"><tr>{["Jugador", "Equipo y club", "Motivo de revisión", "Acción"].map(label => <th key={label} scope="col" className="px-5 py-4 font-semibold">{label}</th>)}</tr></thead>
        <tbody>{visible.map(item => <tr key={`${item.kind}:${item.id}`} className="border-b border-border last:border-b-0 hover:bg-soft/40">
          <td className="px-5 py-5"><p className="font-semibold text-primary">{item.name}</p><p className="mt-1 text-muted">{item.category} · {item.season}</p><p className="mt-1 text-xs text-muted">Registro: {date.format(new Date(item.registeredAt))}</p></td>
          <td className="px-5 py-5"><p className="font-medium text-primary">{item.team}</p><p className="mt-1 text-muted">{item.club}</p></td>
          <td className="px-5 py-5"><ReviewReason item={item} /></td><td className="px-5 py-5"><ReviewAction item={item} /></td>
        </tr>)}</tbody>
      </table></div>
      <ul aria-label="Casos pendientes de revisión" className="space-y-4 lg:hidden">{visible.map(item => <li key={`${item.kind}:${item.id}`} className="space-y-4 rounded-2xl border border-border bg-surface p-5">
        <div><h2 className="wrap-break-word text-lg font-semibold text-primary">{item.name}</h2><p className="mt-1 text-sm text-muted">{item.team} · {item.club}</p><p className="mt-1 text-sm text-muted">{item.category} · {item.season}</p></div><ReviewReason item={item} /><ReviewAction item={item} />
      </li>)}</ul>
    </>}

    <details className="rounded-2xl border border-border bg-surface p-5 text-sm"><summary className="cursor-pointer font-semibold text-primary">¿Qué se revisa en esta bandeja?</summary><div className="mt-4 space-y-3 leading-6 text-muted">
      <p><strong className="text-primary">Posibles coincidencias:</strong> compara identidades con nombres o fechas similares. Una coincidencia no significa que sean la misma persona.</p>
      <p><strong className="text-primary">INE y selfie:</strong> consulta fotos y acuses con diferencias, datos incompletos o resultados inciertos.</p>
      <p><strong className="text-primary">Documentos y tutor:</strong> revisa archivos vigentes y acredita la autorización del tutor cuando corresponda.</p>
      <p>Un jugador puede tener más de un caso. Resolver una revisión no sustituye las condiciones de habilitación deportiva.</p>
    </div></details>
  </div>;
}
