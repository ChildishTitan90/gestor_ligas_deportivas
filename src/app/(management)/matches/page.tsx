import { getAssignedMatches } from "@/features/matches/server/eligibility";
import { ActionLink } from "@/components/ui/action-link";
export const metadata = { title: "Mis partidos · Alineación" };
export default async function Page() {
  const matches = await getAssignedMatches();
  return <section className="mx-auto max-w-5xl space-y-4"><h1 className="text-2xl font-semibold">Mis partidos · Alineación</h1>
    {!matches.length && <p>No tienes partidos designados con acceso a preparación de alineación.</p>}
    {matches.map(match => <article key={match.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-5">
      <h2>Partido {match.number}</h2><ActionLink href={`/matches/${match.id}/lineup`}>Consultar alineación</ActionLink>
    </article>)}
  </section>;
}
