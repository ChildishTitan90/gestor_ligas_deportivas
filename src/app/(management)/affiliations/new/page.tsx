import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ActionLink } from "@/components/ui/action-link";
import { SelectField } from "@/components/ui/select-field";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { AffiliationForm } from "@/features/clubs/components/affiliation-form";
import { getAffiliationFormPageData } from "@/features/clubs/server/affiliation-form-queries";
import { getTeamEnrollmentCatalogs } from "@/features/clubs/server/team-enrollment-queries";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";

export const metadata = { title: "Mis solicitudes de afiliación" };

const followUp = {
  AWAITING_REVIEW: { label: "Pendiente de revisión", action: "Secretaría revisará la solicitud. Por ahora, espera su respuesta." },
  CORRECTIONS_REQUESTED: { label: "Correcciones solicitadas", action: "El club debe atender las observaciones y reenviar el mismo folio." },
  APPROVED: { label: "Aprobada", action: "Secretaría aprobó la afiliación de este club y temporada." },
  REJECTED: { label: "Rechazada", action: "Consulta con Secretaría si necesitas aclarar la decisión registrada." },
};

export default async function NewAffiliationPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const current = await getCurrentAccount();
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");

  const { context } = await searchParams;
  let data: Awaited<ReturnType<typeof getAffiliationFormPageData>> | undefined;
  let unavailable = false;
  let teamCatalog: Awaited<ReturnType<typeof getTeamEnrollmentCatalogs>> | null = null;
  try {
    data = await getAffiliationFormPageData(context);
    if (data.selected && data.existingAffiliation?.status === "APPROVED") {
      teamCatalog = await getTeamEnrollmentCatalogs({ clubId: data.selected.clubId, limit: 1 });
    }
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    unavailable = !(error instanceof AuthorizationError);
  }

  const selected = data?.selected;
  const existing = data?.existingAffiliation;
  const status = existing ? followUp[existing.phase as keyof typeof followUp] : undefined;
  const contextLabels = selected ? { club: selected.clubName, season: selected.seasonName, league: selected.leagueName } : undefined;

  return <div className="mx-auto w-full max-w-5xl space-y-5">
    <ManagementPageHeader title="Mis solicitudes de afiliación"
      description="Inicia una afiliación o consulta qué sigue para tu solicitud."
      back={{ href: "/access", label: "Mi panel" }}
      context={contextLabels && [
        { label: "Liga", value: contextLabels.league }, { label: "Temporada", value: contextLabels.season }, { label: "Club", value: contextLabels.club },
      ]} />

    {!data ? <section role="alert" className="space-y-3 rounded-xl border border-border bg-surface p-4">
      <p>{unavailable ? "No se pudo cargar la afiliación. Vuelve a consultar." : "La selección no está disponible para tu cuenta. Vuelve a tus clubes y temporadas autorizados."}</p>
      <ActionLink href="/affiliations/new" variant="secondary">Volver a consultar</ActionLink>
    </section> : !selected ? <p role="status" className="rounded-xl border border-border bg-surface p-4">No hay clubes y temporadas disponibles para iniciar o corregir una solicitud.</p> : <>
      <form method="get" className="grid items-end gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0"><label htmlFor="affiliation-context" className="mb-2 block text-sm font-semibold">Club y temporada</label>
          <SelectField key={selected.value} id="affiliation-context" name="context" defaultValue={selected.value} required
            options={data.options.map(option => ({ value: option.value, label: `${option.clubName} · ${option.seasonName}`, description: option.leagueName }))} />
        </div>
        <button type="submit" className="min-h-12 rounded-xl border border-border px-5 py-3 text-sm font-semibold text-primary hover:bg-background">Cambiar club o temporada</button>
      </form>

      {existing ? <section aria-labelledby="affiliation-follow-up-title" className="space-y-4 rounded-xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="affiliation-follow-up-title" className="text-xl font-semibold text-primary">Seguimiento de la solicitud</h2>
          <span className={`rounded-lg border px-3 py-1 text-sm font-semibold ${existing.status === "APPROVED" ? "border-positive bg-positive-surface text-positive" : "border-border bg-soft text-primary"}`}>
            {status?.label ?? "Estado no disponible"}
          </span>
        </div>
        <dl className="space-y-3 text-sm"><div><dt className="text-xs text-muted">Folio</dt><dd className="wrap-anywhere font-semibold text-primary">{existing.referenceNumber}</dd></div>
          <div><dt className="font-semibold">Qué sigue</dt><dd className="mt-1 leading-6 text-muted">{status?.action ?? "Vuelve a consultar la solicitud."}
            {existing.phase === "CORRECTIONS_REQUESTED" && !existing.canCorrect && " Esta cuenta no puede reenviar este folio."}</dd></div>
        </dl>
        {existing.canCorrect && <ActionLink href={`/affiliations/${existing.id}/correct`}>Consultar observaciones y corregir solicitud</ActionLink>}
        {teamCatalog?.clubs.some(club => club.id === selected.clubId) && <ActionLink href="/teams/registrations">
          {teamCatalog.capabilities.canEnroll ? "Inscribir o consultar equipos" : "Consultar equipos"}
        </ActionLink>}
        {existing.status === "APPROVED" && !teamCatalog && <p className="text-sm text-muted">{unavailable ? "No se pudo comprobar el acceso a equipos. Vuelve a consultar más tarde." : "La consulta de equipos no está disponible para esta cuenta en el club seleccionado."}</p>}
      </section> : !data.categories.length ? <p role="status" className="rounded-xl border border-border bg-surface p-4">Secretaría debe configurar las categorías de esta temporada antes de que puedas iniciar la afiliación.</p> : data.submissionContext && <AffiliationForm
        categories={data.categories} submissionContext={data.submissionContext} contextLabels={contextLabels} initialValues={{
          clubName: selected.clubName, uniformColors: "", categoryIds: [],
          officers: {
            PRESIDENT: { firstName: "", paternalSurname: "", maternalSurname: "" },
            SECRETARY: { firstName: "", paternalSurname: "", maternalSurname: "" },
            TREASURER: { firstName: "", paternalSurname: "", maternalSurname: "" },
          },
        }} />}
    </>}
  </div>;
}
