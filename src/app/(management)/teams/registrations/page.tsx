import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { TeamRegistrationWorkspace } from "@/features/clubs/components/team-registration-workspace";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { getAuthSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Inscripción y consulta de equipos" };
export default async function TeamRegistrationsPage() {
  const session = await getAuthSession();
  if (!session?.user) redirect("/login");
  const current = await getCurrentAccount();
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  return <div className="mx-auto w-full max-w-6xl">
    <ManagementPageHeader title="Inscripción y consulta de equipos"
      description="Inscribe un equipo en una temporada autorizada o consulta el historial de tu club."
      back={{ href: "/access", label: "Volver al panel" }} />
    <TeamRegistrationWorkspace userId={session.user.id} />
  </div>;
}
