import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { AccountForm } from "@/features/accounts/components/account-form";
import { getAccountFormData } from "@/features/accounts/server/queries";
import { accountListSchema } from "@/features/accounts/maintenance-contract";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";

export const metadata = { title: "Crear cuenta" };

export default async function NewAccountPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  let data;
  let unavailable = false;
  try { data = await getAccountFormData(); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (!(error instanceof AuthorizationError)) unavailable = true;
  }
  const current = await getCurrentAccount();
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  const query = accountListSchema.safeParse(await searchParams);
  const back = query.success ? new URLSearchParams({
    search: query.data.search, page: String(query.data.page), pageSize: String(query.data.pageSize),
  }) : null;
  return <div className="mx-auto w-full max-w-4xl space-y-6">
    <ManagementPageHeader title="Crear cuenta"
      description="La nueva cuenta deberá cambiar su contraseña temporal al iniciar sesión."
      back={{ href: back ? `/accounts?${back}` : "/accounts", label: "Volver a cuentas" }} />
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-8">
      {data ? <AccountForm {...data} /> :
        <p role="alert">{unavailable ? "No se pudo cargar el formulario. Intenta abrir esta página nuevamente." : "Acceso denegado. No tienes permisos para crear cuentas en los ámbitos disponibles."}</p>}
    </section>
  </div>;
}
