import { AuthorizationError } from "@/server/auth/authorization";
import { getSchedulingWorkspace } from "@/features/scheduling/server/workspace";
import { SchedulingWorkspace } from "@/features/scheduling/components/scheduling-workspace";

export const metadata = { title: "Generar calendario" };
export default async function SchedulingPage() {
  try { return <SchedulingWorkspace workspace={await getSchedulingWorkspace()} />; }
  catch (error) { if (error instanceof AuthorizationError) return <p role="alert">Tu cuenta no tiene acceso a la generación de calendarios.</p>; throw error; }
}
