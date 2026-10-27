import { redirect } from "next/navigation";
import { AccountHeader } from "@/components/layout/account-header";
import { ActionLink } from "@/components/ui/action-link";
import { AffiliationForm } from "@/features/clubs/components/affiliation-form";
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
  const current = await getCurrentAccount({ includeAssignments: true });
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  return <>
    <AccountHeader account={current.account} />
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10 sm:px-10">
      <ActionLink href="/affiliations/new" variant="secondary">Volver a mis solicitudes</ActionLink>
      <h1 className="text-2xl font-semibold text-primary">Corregir solicitud de afiliación</h1>
      {data ? <AffiliationForm {...data} /> : <p role="alert">{message}</p>}
    </main>
  </>;
}
