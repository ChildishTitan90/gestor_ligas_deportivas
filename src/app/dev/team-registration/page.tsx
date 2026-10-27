import { notFound } from "next/navigation";
import { isTeamRegistrationPreview, TEAM_REGISTRATION_PREVIEW_PATH } from "@/lib/development-preview";

export const metadata = { title: "Demostración local de inscripciones", robots: { index: false, follow: false } };

export default async function TeamRegistrationPreviewPage() {
  if (!isTeamRegistrationPreview(TEAM_REGISTRATION_PREVIEW_PATH, process.env.NODE_ENV)) notFound();
  // No cargar los datos ni la vista de demostración fuera de desarrollo.
  const { TeamRegistrationPreview } = await import("@/features/clubs/components/team-registration-preview");
  return <TeamRegistrationPreview />;
}
