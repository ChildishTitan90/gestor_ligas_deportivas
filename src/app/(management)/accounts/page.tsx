import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { AccountMaintenanceWorkspace } from "@/features/accounts/components/maintenance-workspace";
import { CreateAccountLink } from "@/features/accounts/components/create-account-link";
import { getAccountMaintenanceWorkspace } from "@/features/accounts/server/maintenance-workspace";
import { canCreateAccounts } from "@/features/accounts/server/queries";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { AccountMaintenanceError } from "@/features/accounts/maintenance-contract";

export const metadata: Metadata = { title: "Administrar cuentas" };
export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let data;
  let listError: "invalid" | "denied" | undefined;
  let canCreate = false;
  let creationUnavailable = false;
  try { canCreate = await canCreateAccounts(); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    creationUnavailable = true;
  }
  try {
    if (Object.values(params).some(Array.isArray)) throw new AccountMaintenanceError("VALIDATION_ERROR");
    data = await getAccountMaintenanceWorkspace(params);
  }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) listError = "denied";
    else if (error instanceof AccountMaintenanceError) listError = "invalid";
    else throw error;
  }
  const search = data && typeof params.search === "string" ? params.search.trim() : "";
  const { page, pageSize } = data?.list ?? {};
  const header = <ManagementPageHeader title="Administrar cuentas"
    description={data ? "Consulta el estado de acceso y administra los datos de inicio de sesión." : "Consulta las opciones de administración disponibles."}
    back={{ href: "/access", label: "Volver al panel" }} />;
  const createAction = canCreate ? <CreateAccountLink search={search} page={page} pageSize={pageSize} /> : undefined;
  return <div className="mx-auto w-full max-w-6xl">
    {data ? <AccountMaintenanceWorkspace key={`${data.actorId}:${data.canUpdate}:${page}:${pageSize}:${search}`}
      {...data} search={search} header={header} createAction={createAction} /> : <div className="space-y-4">{header}{createAction}</div>}
    {creationUnavailable && <p role="status" className="mt-4 text-sm text-muted">No se pudo comprobar el acceso a la creación de cuentas. Vuelve a cargar la página.</p>}
    {listError === "denied" && <p className="mt-5 rounded-xl border border-border bg-surface p-4" role={canCreate ? undefined : "alert"}>
      {canCreate ? "Puedes crear cuentas dentro de tu ámbito. El listado requiere permiso de consulta global." : "No tienes permiso global para consultar cuentas."}
    </p>}
    {listError === "invalid" && <div className="mt-5"><p role="alert">Los filtros no son válidos.</p><Link className="underline" href="/accounts">Restablecer filtros</Link></div>}
  </div>;
}
