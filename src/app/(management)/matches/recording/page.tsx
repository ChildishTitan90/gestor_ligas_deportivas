import { getRecorderWorkspace } from "@/features/matches/server/recorder-workspace";
import { MatchTransitionControls } from "@/features/matches/components/match-transition-controls";
import Link from "next/link";

export const metadata = { title: "Registro de partidos" };
export default async function Page({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  const { after } = await searchParams;
  const workspace = await getRecorderWorkspace(after);
  return <section className="mx-auto max-w-5xl space-y-5"><h1 className="text-2xl font-semibold">Registro de partidos</h1>
    <p>Consulta y administra los partidos disponibles según tus permisos.</p>
    {!workspace.items.length && <p>No hay partidos disponibles para registrar en tus ligas.</p>}
    {workspace.items.map(match => <article key={match.id} className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <h2 className="text-lg font-semibold">Partido {match.number}</h2><p>Temporada: {match.season}</p>
      {match.startsAt && <p>Inicio programado: {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(match.startsAt))}</p>}
      <MatchTransitionControls id={match.id} version={match.version} status={match.status} canRecordMatch={match.canRecordMatch} canSchedule={match.canSchedule} canCancel={match.canCancel} />
    </article>)}
    <nav aria-label="Paginación de partidos" className="flex gap-4">{after && <Link href="/matches/recording">Primera página</Link>}{workspace.nextAfter && <Link href={`/matches/recording?after=${workspace.nextAfter}`}>Siguientes partidos</Link>}</nav>
  </section>;
}
