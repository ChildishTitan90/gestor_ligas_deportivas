import { ProposalReview } from "@/features/scheduling/components/proposal-review";
import { venueLocalTime } from "@/features/venues/time";
import { TeamSwapBoard } from "@/features/scheduling/components/team-swap-board";
import { ProposalProgress, ProposalStatus } from "@/features/scheduling/components/proposal-status";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
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

export default async function ScheduleProposalsPage({ searchParams }: {
  searchParams: Promise<{ propuesta?: string | string[] }>;
}) {
  let workspace;
  try {
    workspace = await listScheduleProposals();
  } catch (error) {
    if (error instanceof AuthorizationError) return <p role="alert">Tu cuenta no tiene acceso a las propuestas de programación. Si necesitas consultarlas, solicita acceso a la administración de la liga.</p>;
    throw error;
  }

  const { actorId, proposals } = workspace;
  const { propuesta } = await searchParams;
  const selected = proposals.find(proposal => proposal.id === propuesta);
  const visible = selected ? [selected, ...proposals.filter(proposal => proposal.id !== selected.id)] : proposals;
  return <div className="mx-auto w-full max-w-5xl space-y-6">
    <ManagementPageHeader title="Propuestas de programación"
      description="Consulta los encuentros, ajusta los pendientes y revisa el estado de la propuesta."
      back={{ href: "/access", label: "Volver al panel" }} />
    {proposals.length === 0 && <div className="space-y-3 rounded-2xl border border-border bg-surface p-5">
      <p>No hay propuestas guardadas en las ligas a las que tienes acceso.</p>
      <p className="text-sm text-muted">Primero genera una propuesta para la temporada y el grupo. Después podrás volver aquí para consultar y ajustar las jornadas.</p>
      <Link href="/competitions/scheduling" className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 font-semibold text-primary">Ir a generar calendario</Link>
    </div>}
    {visible.map(proposal => {
      const league = proposal.seasons.leagues;
      const format = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: league.timezone });
      const awaitingActivation = proposal.status === "APPROVED" && !!proposal.generated && proposal.operationalCount !== proposal.generated.matches.length;
      return <details key={proposal.id} id={`propuesta-${proposal.id}`} open={selected?.id === proposal.id ? true : undefined}
        className="scroll-mt-28 rounded-2xl border border-border bg-surface px-4 py-2 sm:px-5">
        <summary className="cursor-pointer py-3 font-semibold text-primary">
          {proposal.generated ? "Calendario del grupo" : `Jornada ${proposal.matchdays.number}`} · {awaitingActivation ? "Aprobada · Activación pendiente" : statusLabels[proposal.status] ?? proposal.status}
          <span className="ml-2 text-sm font-normal text-muted">{league.name} · {proposal.seasons.name}</span>
        </summary>
        <div className="pb-3">
        <p className="mt-3 text-sm text-muted">
          {format.format(proposal.created_at)} · Reglamento v{proposal.competition_rules.version_number} · Propuesta v{proposal.version}
        </p>
        <div className="mt-4"><ProposalProgress status={proposal.status} generated={!!proposal.generated} awaitingActivation={awaitingActivation} /></div>
        <ProposalStatus status={proposal.status} canEdit={proposal.canEdit} awaitingActivation={awaitingActivation} pendingCount={proposal.generated ? proposal.generated.matches.filter(match => !match.venueId || !match.start).length : proposal.matches.filter(match => !match.venues || !match.starts_at).length} />
        {proposal.status === "APPROVED" && proposal.generated && <p className="mt-4"><a
          href={`/api/scheduling/proposals/${proposal.id}/pdf`} download
          className="primary-action inline-flex min-h-12 items-center rounded-xl px-4 py-2 text-sm font-semibold">Descargar propuesta aprobada en PDF</a></p>}
        {proposal.canActivate && <ActivateApproved proposalId={proposal.id} version={proposal.version} />}
        {awaitingActivation && !proposal.canActivate && <p role="status" className="mt-4 text-sm text-muted">Esta propuesta no tiene todos sus partidos operativos registrados. La autoridad de la liga debe revisar su activación.</p>}
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
        </div>
      </details>;
    })}
  </div>;
}
