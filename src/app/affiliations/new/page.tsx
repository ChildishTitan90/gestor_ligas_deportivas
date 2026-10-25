import { redirect } from "next/navigation";
import { AccountHeader } from "@/components/layout/account-header";
import { getCurrentAccount } from
  "@/features/auth/server/account-presentation";
import { AffiliationForm } from
  "@/features/clubs/components/affiliation-form";
import { getAffiliationFormPageData } from
  "@/features/clubs/server/affiliation-form-queries";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";

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

  const current = await getCurrentAccount({
    includeAssignments: true,
  });

  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");

  return (
    <>
      <AccountHeader account={current.account} />

      <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-6 py-10 sm:px-10">
        <h1 className="text-2xl font-semibold text-primary">
          Solicitar afiliación
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

              <select
                id="affiliation-context"
                name="context"
                defaultValue={data.selected.value}
                className="min-h-12 w-full rounded-xl border border-border bg-surface px-3"
              >
                {data.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.clubName} — {option.seasonName}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                className="min-h-12 rounded-xl bg-primary px-5 py-3 font-semibold text-white"
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
      </main>
    </>
  );
}