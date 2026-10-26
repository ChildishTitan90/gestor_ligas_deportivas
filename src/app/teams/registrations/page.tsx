import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/action-link";
import { TeamRegistrationWorkspace } from "@/features/clubs/components/team-registration-workspace";
import { getAuthSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Inscripción y consulta de equipos" };
export default async function TeamRegistrationsPage() {
  const session = await getAuthSession();
  if (!session?.user) redirect("/login");
  if (session.user.mustChangePassword) redirect("/change-password");
  return <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10 sm:px-10">
    <ActionLink href="/access" variant="secondary">Volver al panel</ActionLink>
    <h1 className="mt-6 text-2xl font-semibold text-primary">Inscripción y consulta de equipos</h1>
    <TeamRegistrationWorkspace userId={session.user.id} />
  </main>;
}
