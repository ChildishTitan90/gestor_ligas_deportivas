import { redirect } from "next/navigation";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { getRefereeAccessWorkspace } from "@/features/accounts/server/referee-access";
import { RefereeAccessForm } from "@/features/accounts/components/referee-access-form";

export const metadata = { title: "Acceso del árbitro" };
export default async function Page({ searchParams }: { searchParams: Promise<{ referee?: string; season?: string }> }) {
  const q = await searchParams;
  let workspace;
  try { workspace = await getRefereeAccessWorkspace(q.referee ?? "", q.season ?? ""); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) return <section role="alert"><h1 className="text-2xl font-semibold">Acceso denegado</h1><p className="mt-2">No tienes permiso para habilitar acceso de árbitros en este contexto.</p></section>;
    throw error;
  }
  return <RefereeAccessForm key={`${workspace.actorId}:${workspace.refereeId}:${workspace.seasonId}`} workspace={workspace}/>;
}
