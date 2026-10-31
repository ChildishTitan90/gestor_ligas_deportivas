import { redirect } from "next/navigation";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { getPlayerWorkspace } from "@/features/players/server/workspace-queries";
import { PlayerRegistrationWorkspace } from "@/features/players/components/player-registration-workspace";

export const metadata = { title: "Registrar jugadores" };
export default async function PlayerRegistrationPage() {
  let data: Awaited<ReturnType<typeof getPlayerWorkspace>> | undefined;
  let failure = "";
  try {
    data = await getPlayerWorkspace();
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    failure = error instanceof AuthorizationError ? "Tu cuenta no tiene acceso a la captura de jugadores en este contexto." : "No se pudo cargar la captura. Intenta nuevamente.";
  }
  return <div className="mx-auto w-full max-w-5xl space-y-6"><header><h1 className="text-2xl font-semibold text-primary">Registrar jugadores</h1><p className="mt-2 leading-7 text-muted">Inscribe jugadores en los equipos de tu club y consulta el estado de su identidad.</p></header>
    {data ? <PlayerRegistrationWorkspace key={data.actorId} {...data} /> : <p role="alert">{failure}</p>}</div>;
}
