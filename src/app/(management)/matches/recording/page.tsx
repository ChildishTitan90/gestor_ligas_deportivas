import { getRecorderWorkspace } from "@/features/matches/server/recorder-workspace";
import { MatchTransitionControls } from "@/features/matches/components/match-transition-controls";
import { RescheduleControl } from "@/features/matches/components/reschedule-control";
import { ConfirmMatchdayControl } from "@/features/matches/components/confirm-matchday-control";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import Link from "next/link";

export const metadata = { title: "Registro de partidos" };
export default async function Page({ searchParams }: { searchParams: Promise<{ after?: string; jornada?: string }> }) {
  const { after, jornada } = await searchParams;
  const workspace = await getRecorderWorkspace(after, jornada);
  const selected = workspace.matchdays.find(day => day.id === jornada);
  const seasons = [...new Map(workspace.matchdays.map(day => [day.seasonId, {id:day.seasonId,name:day.season,league:day.league}])).values()];
  return <section className="mx-auto w-full max-w-5xl space-y-5">
    <ManagementPageHeader title="Registro de partidos"
      description={selected ? "Consulta los datos de cada partido y las acciones disponibles en esta jornada." : "Elige una temporada y una jornada para encontrar el partido que deseas consultar o modificar."}
      back={selected ? {href:"/matches/recording",label:"Elegir otra jornada"} : {href:"/access",label:"Volver al panel"}}
      context={selected ? [{label:"Liga",value:selected.league},{label:"Temporada",value:selected.season},{label:"Jornada",value:String(selected.number)}] : undefined} />
    {!selected ? <>
      {!workspace.matchdays.length && <p>No hay partidos disponibles para registrar en tus ligas.</p>}
      {seasons.map(season=><section key={season.id} className="space-y-3 rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold">{season.name}</h2><p className="text-sm text-muted">{season.league}</p>
        <nav aria-label={`Jornadas de ${season.name}, ${season.league}`} className="flex flex-wrap gap-2">
          {workspace.matchdays.filter(day=>day.seasonId===season.id).map(day=><Link key={day.id} href={`/matches/recording?jornada=${day.id}`} className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 font-semibold text-primary hover:border-accent">Jornada {day.number}</Link>)}
        </nav>
      </section>)}
    </> : <>
    {selected.canConfirm && <ConfirmMatchdayControl matchdayId={selected.id} number={selected.number}/>}
    {!workspace.items.length && <p>No hay partidos en esta página de la jornada.</p>}
    {workspace.items.map(match => <article key={match.id} className="space-y-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="min-w-0 wrap-anywhere text-lg font-semibold text-primary">{match.homeTeam} vs. {match.awayTeam}</h2>
        <p className="text-sm text-muted">Partido {match.number}</p>
      </header>
      <dl className="grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Fecha y hora</dt><dd>{match.startsAt ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: match.timezone }).format(new Date(match.startsAt)) : "Pendientes de asignar"}</dd></div>
        <div><dt className="text-muted">Cancha</dt><dd>{match.venueName ?? "Pendiente de asignar"}</dd></div>
        <div><dt className="text-muted">Programación de la jornada</dt><dd>{match.proposalStatus === "APPROVED" ? "Aprobada" : match.proposalStatus ? "Pendiente de aprobación" : "Sin propuesta vinculada"}</dd></div>
        <div><dt className="text-muted">Árbitro principal</dt><dd>{match.hasReferee ? "Designación aprobada" : "Pendiente de designación aprobada y vigente"}</dd></div>
      </dl>
      {match.schedulingNotice && <p className="rounded-xl border border-border bg-soft p-3 text-sm" role="note">{match.schedulingNotice}</p>}
      <MatchTransitionControls id={match.id} version={match.version} status={match.status} canRecordMatch={match.canRecordMatch} canSchedule={match.status === "DRAFT" ? false : match.canSchedule} canCancel={match.canCancel} canReview={match.canReview} canResolve={match.canResolve} />
      {match.canReschedule && <RescheduleControl matchId={match.id} matchLabel={`${match.homeTeam} vs. ${match.awayTeam} · Jornada ${match.matchday}`} initial={match.status === "DRAFT"} version={match.version} timezone={match.timezone} venues={match.venues} venueId={match.venueId} startsAt={match.startsAt} proposalId={match.proposalId} hasUpdatedPdf={match.hasUpdatedPdf} />}
    </article>)}
    <nav aria-label="Paginación de partidos de la jornada" className="flex gap-4">{after && <Link href={`/matches/recording?jornada=${selected.id}`}>Primeros partidos de la jornada</Link>}{workspace.nextAfter && <Link href={`/matches/recording?jornada=${selected.id}&after=${workspace.nextAfter}`}>Siguientes partidos de la jornada</Link>}</nav></>}
  </section>;
}
