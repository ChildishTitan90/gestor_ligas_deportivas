import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/action-link";
import { getCurrentAccount } from
  "@/features/auth/server/account-presentation";
import { AffiliationForm } from
  "@/features/clubs/components/affiliation-form";
import { getAffiliationFormPageData } from
  "@/features/clubs/server/affiliation-form-queries";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { SelectField } from "@/components/ui/select-field";

export const metadata = {
  title: "Solicitar afiliación",
};

type Props = {
  searchParams: Promise<{
    [key: string]: string | string[] | undefined;
  }>;
};

export default async function NewAffiliationPage({
  searchParams,
}: Props) {
  const params = await searchParams;

  let data: Awaited<
    ReturnType<typeof getAffiliationFormPageData>
  > | undefined;
  let unavailable = false;

  try {
    data = await getAffiliationFormPageData(params.context);
  } catch (error) {
    if (error instanceof AuthAccessError) {
      redirect(
        error.code === "PASSWORD_CHANGE_REQUIRED"
          ? "/change-password"
          : "/login",
      );
    }

    unavailable = !(error instanceof AuthorizationError);
  }

  const current = await getCurrentAccount();

  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");

  return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <ActionLink href="/access" variant="secondary">Volver al panel</ActionLink>
        <h1 className="text-2xl font-semibold text-primary">
          Mis solicitudes de afiliación
        </h1>

        {!data ? (
          <p role="alert">
            {unavailable
              ? "No se pudo cargar el formulario. Intenta nuevamente."
              : "No tienes permiso para solicitar una afiliación en la selección indicada."}
          </p>
        ) : !data.selected ? (
          <p>
            No hay temporadas abiertas disponibles para tus clubes.
          </p>
        ) : (
          <>
            <form
              method="get"
              className="space-y-3 rounded-2xl border border-border bg-surface p-5"
            >
              <label
                htmlFor="affiliation-context"
                className="block font-medium"
              >
                Club y temporada
              </label>

              <SelectField
                id="affiliation-context"
                name="context"
                defaultValue={data.selected.value}
                required options={data.options.map(option => ({ value: option.value, label: `${option.clubName} — ${option.seasonName}` }))}
              />

              <button
                type="submit"
                className="min-h-12 rounded-xl primary-action px-5 py-3 font-semibold"
              >
                Abrir selección
              </button>
            </form>

            {data.existingAffiliation ? (
              <section className="rounded-2xl border border-border bg-surface p-5">
                <h2 className="font-semibold">
                  Ya existe una solicitud para este club y temporada
                </h2>
                <p className="mt-2">
                  Folio: {data.existingAffiliation.referenceNumber}
                </p>
                <p className="mt-2">Estado: {data.existingAffiliation.status === "APPROVED" ? "Aprobada" :
                  data.existingAffiliation.status === "REJECTED" ? "Rechazada" : "Pendiente de revisión"}.</p>
                {data.existingAffiliation.canCorrect && <p className="mt-2">Secretaría solicitó correcciones. Consulta sus observaciones, actualiza los datos y reenvía la misma solicitud.</p>}
                {data.existingAffiliation.canCorrect && <a
                  href={`/affiliations/${data.existingAffiliation.id}/correct`}
                  className="mt-3 inline-block rounded-xl border border-border px-5 py-3 font-semibold">
                  Consultar observaciones y corregir solicitud
                </a>}
                {data.existingAffiliation.status === "APPROVED" && <ActionLink href="/teams/registrations" variant="secondary" className="mt-3">
                  Inscribir o consultar equipos
                </ActionLink>}
                <p className="mt-2">
                  Puedes seleccionar otra temporada disponible.
                </p>
              </section>
            ) : !data.categories.length ? (
              <p role="status">
                Esta temporada todavía no tiene categorías configuradas.
              </p>
            ) : data.submissionContext ? (
              <AffiliationForm
                categories={data.categories}
                submissionContext={data.submissionContext}
                initialValues={{
                  clubName: data.selected.clubName,
                  uniformColors: "",
                  categoryIds: [],
                  officers: {
                    PRESIDENT: {
                      firstName: "",
                      paternalSurname: "",
                      maternalSurname: "",
                    },
                    SECRETARY: {
                      firstName: "",
                      paternalSurname: "",
                      maternalSurname: "",
                    },
                    TREASURER: {
                      firstName: "",
                      paternalSurname: "",
                      maternalSurname: "",
                    },
                  },
                }}
              />
            ) : null}
          </>
        )}
      </div>
  );
}
