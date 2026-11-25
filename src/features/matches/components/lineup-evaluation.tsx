import type { LineupEvaluation } from "../eligibility";

export function LineupEvaluationView({ data }: { data: LineupEvaluation }) {
  return <section className="mx-auto max-w-6xl space-y-6">
    <header><h1 className="text-2xl font-semibold">Preparar alineación · Partido {data.number}</h1>
      <p>{data.startsAt ? new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", dateStyle: "medium", timeStyle: "short" }).format(new Date(data.startsAt)) : "Horario pendiente"}</p></header>
    <aside className="rounded-xl border border-border p-4" aria-label="Alcance de la evaluación">{data.notices.map(n => <p key={n}>{n}</p>)}</aside>
    {!data.players.length && <p>{data.historical ? "La evidencia histórica se conserva sin modificaciones." : "No hay jugadores registrados para evaluar."}</p>}
    <div className="grid gap-4 md:grid-cols-2">{data.players.map(player => <article key={`${player.registrationId}:${player.seasonTeamId}`} className="rounded-xl border border-border bg-[var(--surface)] p-5">
      <h2 className="text-lg font-semibold">{player.name}</h2><p>Origen: {player.team} · Alinear en: {player.targetTeam}</p><p>Dorsal habitual: {player.jerseyNumber ?? "Sin asignar"}</p>
      <p className="mt-3 font-semibold">{player.eligible ? "Elegible para este partido" : "No habilitado para alinear"}</p>
      {player.blockers.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{player.blockers.map((b, i) => <li key={`${b.code}:${i}`}>{b.message}</li>)}</ul>}
      <details className="mt-3"><summary className="cursor-pointer rounded py-1 focus-visible:outline-2 focus-visible:outline-[var(--accent)]">Tiempos registrados ({player.participation.length})</summary>
        {!player.participation.length ? <p>Sin tiempos registrados. No acredita ausencia de otras convocatorias.</p> : <ul>{player.participation.map((p, i) => <li key={i}>Partido {p.matchNumber}, periodo {p.period}: entrada {p.entry ?? "sin dato"}, salida {p.exit ?? "sin dato"} min.</li>)}</ul>}
      </details>
    </article>)}</div>
  </section>;
}
