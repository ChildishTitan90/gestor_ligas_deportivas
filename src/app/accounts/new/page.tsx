import { redirect } from "next/navigation";
import { AccountHeader } from "@/components/layout/account-header";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { AccountForm } from "@/features/accounts/components/account-form";
import { getAccountFormData } from "@/features/accounts/server/queries";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";

export const metadata = { title: "Crear cuenta" };

export default async function NewAccountPage() {
  let data;
  let unavailable = false;
  try { data = await getAccountFormData(); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (!(error instanceof AuthorizationError)) unavailable = true;
  }
  const current = await getCurrentAccount({ includeAssignments: true });
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  return <>
    <AccountHeader account={current.account} />
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10 sm:px-10">
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-8">
      <h1 className="text-2xl font-semibold text-primary">Crear cuenta</h1>
      {data ? <><p className="mt-3 text-sm leading-6 text-muted">Alta administrativa de usuarios autorizados. La nueva cuenta deberá cambiar su contraseña temporal al ingresar.</p><AccountForm {...data} /></> :
        <p role="alert" className="mt-5">{unavailable ? "No se pudo cargar el formulario. Intenta abrir esta página nuevamente." : "Acceso denegado. No tienes permisos para crear cuentas en los ámbitos disponibles."}</p>}
    </section>
  </main></>;
}
