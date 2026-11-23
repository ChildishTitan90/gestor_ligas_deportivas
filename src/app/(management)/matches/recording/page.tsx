import { getRecorderWorkspace } from "@/features/matches/server/recorder-workspace";
import { MatchTransitionControls } from "@/features/matches/components/match-transition-controls";
import { RescheduleControl } from "@/features/matches/components/reschedule-control";
import { ConfirmMatchdayControl } from "@/features/matches/components/confirm-matchday-control";
import Link from "next/link";

export const metadata = { title: "Registro de partidos" };
export default async function Page({ searchParams }: { searchParams: Promise<{ after?: string; jornada?: string }> }) {
  const { after, jornada } = await searchParams;
  const workspace = await getRecorderWorkspace(after, jornada);
  const selected = workspace.matchdays.find(day => day.id === jornada);
  const seasons = [...new Map(workspace.matchdays.map(day => [day.seasonId, {id:day.seasonId,name:day.season,league:day.league}])).values()];
  return <section className="mx-auto max-w-5xl space-y-5"><h1 className="text-2xl font-semibold">Registro de partidos</h1>
    {!selected ? <><p>Elige una temporada y una jornada para encontrar el partido que deseas consultar o modificar.</p>
      {!workspace.matchdays.length && <p>No hay partidos disponibles para registrar en tus ligas.</p>}
      {seasons.map(season=><section key={season.id} className="space-y-3 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">{season.name}</h2><p className="text-sm text-muted">{season.league}</p>
        <nav aria-label={`Jornadas de ${season.name}, ${season.league}`} className="flex flex-wrap gap-2">
          {workspace.matchdays.filter(day=>day.seasonId===season.id).map(day=><Link key={day.id} href={`/matches/recording?jornada=${day.id}`} className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 font-semibold text-primary hover:border-accent">Jornada {day.number}</Link>)}
        </nav>
      </section>)}
    </> : <><p><Link href="/matches/recording" className="font-semibold text-primary underline underline-offset-4">← Elegir otra jornada</Link></p>
    <header><h2 className="text-xl font-semibold">Jornada {selected.number}</h2><p className="text-sm text-muted">{selected.season} · {selected.league}</p><p className="mt-2 text-sm text-muted">Elige el partido para consultar sus datos y acciones disponibles.</p></header>
    {selected.canConfirm && <ConfirmMatchdayControl matchdayId={selected.id} number={selected.number}/>}
    {!workspace.items.length && <p>No hay partidos en esta página de la jornada.</p>}
    {workspace.items.map(match => <article key={match.id} className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">{match.homeTeam} vs. {match.awayTeam}</h2>
      <p className="text-sm text-muted">Jornada {match.matchday} · Partido {match.number} · {match.season}</p>
      <p>Fecha y hora: {match.startsAt ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: match.timezone }).format(new Date(match.startsAt)) : "Pendientes de asignar"}</p>
      <p>Cancha: {match.venueName ?? "Pendiente de asignar"}</p>
      <p>Programación de la jornada: {match.proposalStatus === "APPROVED" ? "Aprobada" : match.proposalStatus ? "Pendiente de aprobación" : "Sin propuesta vinculada"}</p>
      <p>Árbitro principal: {match.hasReferee ? "Designación aprobada" : "Pendiente de designación aprobada y vigente"}</p>
      {match.schedulingNotice && <p className="rounded-xl border border-border bg-soft p-3 text-sm" role="note">{match.schedulingNotice}</p>}
      <MatchTransitionControls id={match.id} version={match.version} status={match.status} canRecordMatch={match.canRecordMatch} canSchedule={match.status === "DRAFT" ? false : match.canSchedule} canCancel={match.canCancel} canReview={match.canReview} canResolve={match.canResolve} />
      {match.canReschedule && <RescheduleControl matchId={match.id} matchLabel={`${match.homeTeam} vs. ${match.awayTeam} · Jornada ${match.matchday}`} initial={match.status === "DRAFT"} version={match.version} timezone={match.timezone} venues={match.venues} venueId={match.venueId} startsAt={match.startsAt} proposalId={match.proposalId} hasUpdatedPdf={match.hasUpdatedPdf} />}
    </article>)}
    <nav aria-label="Paginación de partidos de la jornada" className="flex gap-4">{after && <Link href={`/matches/recording?jornada=${selected.id}`}>Primeros partidos de la jornada</Link>}{workspace.nextAfter && <Link href={`/matches/recording?jornada=${selected.id}&after=${workspace.nextAfter}`}>Siguientes partidos de la jornada</Link>}</nav></>}
  </section>;
}
