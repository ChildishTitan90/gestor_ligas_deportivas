import { ProposalReview } from "@/features/scheduling/components/proposal-review";
import { venueLocalTime } from "@/features/venues/time";
import { TeamSwapBoard } from "@/features/scheduling/components/team-swap-board";
import { ProgressSteps } from "@/features/scheduling/components/progress-steps";
import { AdjustmentPreview } from "@/features/scheduling/components/adjustment-preview";
import { listScheduleProposals } from "@/features/scheduling/server/proposals";
import { AuthorizationError } from "@/server/auth/authorization";
import { ActivateApproved } from "@/features/scheduling/components/activate-approved";
import Link from "next/link";

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
    {proposals.length === 0 && <div className="space-y-3 rounded-2xl border border-border bg-surface p-5">
      <p>No hay propuestas guardadas en las ligas a las que tienes acceso.</p>
      <p className="text-sm text-muted">Primero genera una propuesta para la temporada y el grupo. Después podrás volver aquí para consultar y ajustar las jornadas.</p>
      <Link href="/competitions/scheduling" className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 font-semibold text-primary">Ir a generar calendario</Link>
    </div>}
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
        {(["DRAFT", "IN_REVIEW", "APPROVED"].includes(proposal.status)) && <div className="mt-4"><ProgressSteps label="Estado de la propuesta" current={proposal.status === "DRAFT" ? 0 : proposal.status === "IN_REVIEW" ? 1 : 2} steps={[
          {label:"Borrador",detail:"Prepara y ajusta los encuentros."},
          {label:"En revisión",detail:"La propuesta espera una decisión."},
          {label:"Aprobada",detail:"La programación autorizada queda lista para operar."},
        ]} /></div>}
        {proposal.status === "APPROVED" && proposal.generated && <p className="mt-4"><a
          href={`/api/scheduling/proposals/${proposal.id}/pdf`} download
          className="primary-action inline-flex min-h-12 items-center rounded-xl px-4 py-2 text-sm font-semibold">Descargar programación en PDF</a></p>}
        {proposal.canActivate && <ActivateApproved proposalId={proposal.id} version={proposal.version} />}
        {proposal.status === "APPROVED" && proposal.generated && proposal.operationalCount !== proposal.generated.matches.length && !proposal.canActivate && <p role="status" className="mt-4 text-sm text-muted">Esta propuesta no tiene todos sus partidos operativos registrados. La autoridad de la liga debe revisar su activación.</p>}
        {proposal.generated && <section className="mt-4 space-y-3" aria-label="Encuentros propuestos">
          <p className="text-sm text-muted">Versión de temporada {proposal.generated.seasonVersion}</p>
          <TeamSwapBoard key={`${proposal.id}:${proposal.version}`} matches={proposal.generated.matches} byes={proposal.generated.byes}
            actorId={actorId} proposalId={proposal.id} version={proposal.version} canEdit={proposal.canEdit} timeZone={league.timezone}
            venues={league.venues.map(venue=>({value:venue.id,label:venue.name}))} />
          <p className="text-sm text-muted">{proposal.status === "APPROVED"
            ? "Esta es la propuesta original aprobada. Los cambios posteriores se consultan desde el registro de partidos."
            : "Los ajustes y el envío a revisión revalidan el calendario completo. Mientras no se apruebe, la propuesta no reserva canchas."}</p>
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
          context={`${league.name} · ${proposal.seasons.name}`}
          operations={proposal.canReview ? ["approve", "return"] : ["submit"]}
          matches={Object.fromEntries(proposal.matches.map(match => [match.id, match.number]))} />}
      </details>;
    })}
  </div>;
}
