import { redirect } from "next/navigation";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { getOwnAvailabilityWorkspace } from "@/features/referees/server/own-availability";
import { OwnAvailabilityWorkspaceView } from "@/features/referees/components/own-availability-workspace";
export const metadata = { title: "Mi disponibilidad arbitral" };
export default async function Page({ searchParams }: { searchParams: Promise<{ league?: string; season?: string }> }) {
  const q = await searchParams; let workspace;
  try { workspace = await getOwnAvailabilityWorkspace(q.league, q.season); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) return <section role="alert"><h1 className="text-2xl font-semibold">Acceso denegado</h1><p className="mt-2">No tienes acceso a la disponibilidad arbitral propia en este contexto.</p></section>;
    throw error;
  }
  return <OwnAvailabilityWorkspaceView key={`${workspace.actorId}:${workspace.leagueId}:${workspace.seasonId}`} workspace={workspace}/>;
}
