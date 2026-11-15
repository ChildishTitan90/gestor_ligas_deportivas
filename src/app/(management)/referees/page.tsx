import { redirect } from "next/navigation";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { getRefereeWorkspace } from "@/features/referees/server/queries";
import { LiveRefereeWorkspace } from "@/features/referees/components/live-referee-workspace";
import { canAccessMatchEligibility } from "@/features/matches/server/eligibility";
import { viewLabels } from "@/features/referees/preview-model";
import type { RefereeView } from "@/features/referees/types";
export const metadata = { title: "Árbitros y designaciones" };
export default async function Page({ searchParams }: { searchParams: Promise<{ league?: string; season?: string; view?: string }> }) {
  const q = await searchParams; let workspace; let matchesHref;
  try { workspace = await getRefereeWorkspace(q.league, q.season); matchesHref = await canAccessMatchEligibility() ? "/matches" : null; }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) return <section role="alert"><h1 className="text-2xl font-semibold">Acceso denegado</h1><p>No tienes permiso de lectura de arbitraje para este contexto. Tus partidos designados conservan su recorrido en Mi panel.</p></section>;
    throw error;
  }
  const view = q.view && Object.hasOwn(viewLabels,q.view) ? q.view as RefereeView : "register";
  return <LiveRefereeWorkspace key={`${workspace.actorId}:${workspace.leagueId}:${workspace.seasonId}`} workspace={workspace} view={view} matchesHref={matchesHref} />;
}
