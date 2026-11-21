import { AuthorizationError } from "@/server/auth/authorization";
import { getSchedulingWorkspace } from "@/features/scheduling/server/workspace";
import { SchedulingWorkspace } from "@/features/scheduling/components/scheduling-workspace";

export const metadata = { title: "Generar calendario" };
export default async function SchedulingPage() {
  const workspace = await getSchedulingWorkspace().catch(error => {
    if (error instanceof AuthorizationError) return null;
    throw error;
  });
  if (!workspace) return <p role="alert">Tu cuenta no tiene acceso a la generación de calendarios.</p>;
  return <SchedulingWorkspace key={workspace.actorId} workspace={workspace} />;
}
