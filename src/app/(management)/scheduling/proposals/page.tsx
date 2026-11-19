import { GeneratedEncounterDraft } from "@/features/scheduling/components/generated-encounter-draft";
import { ProposalReview } from "@/features/scheduling/components/proposal-review";
import { venueLocalTime } from "@/features/venues/time";
import { AdjustmentPreview } from "@/features/scheduling/components/adjustment-preview";
import { listScheduleProposals } from "@/features/scheduling/server/proposals";
import { AuthorizationError } from "@/server/auth/authorization";

export const metadata = { title: "Propuestas de programación" };

const statusLabels: Record<string, string> = {
  DRAFT: "Borrador",
  IN_REVIEW: "En revisión",
  APPROVED: "Aprobada para operación",
};

export default async function ScheduleProposalsPage() {
  let workspace;
  try {
    workspace = await listScheduleProposals();
  } catch (error) {
    if (error instanceof AuthorizationError) return <p role="alert">Tu cuenta no tiene acceso a las propuestas de programación.</p>;
    throw error;
  }

  const { actorId, proposals } = workspace;
  return <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
    <header>
      <p className="text-sm text-muted">Competencias</p>
      <h1 className="text-3xl font-semibold">Propuestas de programación</h1>
    </header>
    {proposals.length === 0 && <p className="rounded-2xl border border-border bg-surface p-5 text-muted">
      Todavía no hay propuestas en las ligas a las que tienes acceso.
    </p>}
    {proposals.map(proposal => {
      const league = proposal.seasons.leagues;
      const format = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: league.timezone });
      return <details key={proposal.id} className="rounded-2xl border border-border bg-surface p-5">
        <summary className="cursor-pointer font-semibold">
          {league.name} · {proposal.seasons.name} · {proposal.generated ? "Calendario del grupo" : `Jornada ${proposal.matchdays.number}`} · {statusLabels[proposal.status] ?? proposal.status}
        </summary>
        <p className="mt-3 text-sm text-muted">
          {format.format(proposal.created_at)} · Reglamento v{proposal.competition_rules.version_number} · Propuesta v{proposal.version}
        </p>
        {proposal.generated && <section className="mt-4 space-y-3" aria-label="Encuentros propuestos">
          <p className="text-sm text-muted">Versión de temporada {proposal.generated.seasonVersion}</p>
          <ul className="divide-y divide-border">
            {proposal.generated.matches.map(match => <li key={match.encounterIndex} className="space-y-1 py-3">
              <p className="font-medium">{match.home} vs. {match.away}</p>
              <p className="text-sm text-muted">Jornada {match.round} · {match.venue}</p>
              <p className="text-sm">{format.format(new Date(match.start))} – {format.format(new Date(match.end))}</p>
              <p className="text-sm text-muted">Cancha ocupada hasta {format.format(new Date(match.reservedUntil))}</p>
              {proposal.canEdit && <GeneratedEncounterDraft
                key={`${actorId}:${proposal.version}:${match.encounterIndex}`}
                actorId={actorId} proposalId={proposal.id} version={proposal.version}
                encounterIndex={match.encounterIndex} timeZone={league.timezone}
                initialVenueId={match.venueId}
                initialStart={venueLocalTime(new Date(match.start), league.timezone).slice(0, 16)}
                venues={league.venues.map(venue => ({ value: venue.id, label: venue.name }))} />}
            </li>)}
          </ul>
          {proposal.generated.byes.length > 0 && <ul aria-label="Descansos" className="space-y-1 text-sm">
            {proposal.generated.byes.map((bye, index) => <li key={index}>Jornada {bye.round} · Descansa {bye.team}</li>)}
          </ul>}
          <p className="text-sm text-muted">Los ajustes y el envío a revisión revalidan el calendario completo. La propuesta no reserva canchas ni publica partidos.</p>
        </section>}
        {!proposal.generated && (proposal.matches.length ? <ul className="mt-4 divide-y divide-border">
          {proposal.matches.map(match => <li key={match.id} className="space-y-1 py-3">
            <p className="font-medium">
              {match.season_teams_matches_home_team_id_season_idToseason_teams.teams.name} vs.{" "}
              {match.season_teams_matches_away_team_id_season_idToseason_teams.teams.name}
            </p>
            <p className="text-sm text-muted">Partido {match.number} · {match.groups.name} · {match.match_statuses.name}</p>
            <p className="text-sm">
              {match.starts_at ? format.format(match.starts_at) : "Horario por definir"} · {match.venues?.name ?? "Cancha por definir"}
            </p>
            {proposal.canEdit && match.match_statuses.code === "DRAFT" && <AdjustmentPreview
              key={`${actorId}:${match.version}`}
              actorId={actorId} proposalId={proposal.id} matchId={match.id} expectedVersion={match.version}
              timeZone={league.timezone} initialStart={match.starts_at ? venueLocalTime(match.starts_at, league.timezone).slice(0, 16) : ""} />}
          </li>)}
        </ul> : <p className="mt-4 text-sm text-muted">Esta propuesta no tiene partidos registrados.</p>)}
        {(proposal.canEdit || proposal.canReview) && <ProposalReview
          key={`${actorId}:${proposal.version}`}
          actorId={actorId} proposalId={proposal.id} version={proposal.version}
          operations={proposal.canReview ? ["approve", "return"] : ["submit"]}
          matches={Object.fromEntries(proposal.matches.map(match => [match.id, match.number]))} />}
      </details>;
    })}
  </div>;
}
