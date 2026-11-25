import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { AffiliationForm } from "@/features/clubs/components/affiliation-form";
import { affiliationFollowUpHref } from "@/features/clubs/affiliation-feedback";
import { getAffiliationCorrectionFormPageData } from "@/features/clubs/server/affiliation-form-queries";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { AffiliationReviewError } from "@/features/clubs/server/affiliation-review-service";

export const metadata = { title: "Corregir solicitud de afiliación" };

export default async function CorrectAffiliationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data: Awaited<ReturnType<typeof getAffiliationCorrectionFormPageData>> | undefined;
  let message = "No se pudo cargar la solicitud. Intenta consultarla nuevamente.";
  try { data = await getAffiliationCorrectionFormPageData(id); }
  catch (error) {
    if (error instanceof AuthAccessError)
      redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError || error instanceof AffiliationReviewError)
      message = "La solicitud no está disponible para corregirla o ya cambió. Consulta su estado actual.";
  }
  const current = await getCurrentAccount();
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  const context = data?.contextLabels;
  const submission = data?.submissionContext;
  const correction = data?.correction;
  return <div className="mx-auto w-full max-w-5xl space-y-6">
      <ManagementPageHeader title="Corregir solicitud de afiliación"
        description="Atiende las observaciones y reenvía la solicitud a Secretaría conservando su folio."
        back={{ href: submission ? affiliationFollowUpHref(submission.clubId, submission.seasonId) : "/affiliations/new", label: "Mis solicitudes de afiliación" }}
        context={context && correction && [
          { label: "Liga", value: context.league }, { label: "Temporada", value: context.season },
          { label: "Club", value: context.club }, { label: "Folio", value: correction.referenceNumber },
        ]} />
      {data ? <AffiliationForm {...data} /> : <p role="alert">{message}</p>}
  </div>;
}
