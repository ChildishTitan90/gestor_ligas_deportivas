import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AccountMaintenanceWorkspace } from "@/features/accounts/components/maintenance-workspace";
import { getAccountMaintenanceWorkspace } from "@/features/accounts/server/maintenance-workspace";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { AccountMaintenanceError } from "@/features/accounts/maintenance-contract";

export const metadata: Metadata = { title: "Administrar cuentas" };
export default async function AccountsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  let data;
  try {
    if (Object.values(params).some(Array.isArray)) throw new AccountMaintenanceError("VALIDATION_ERROR");
    data = await getAccountMaintenanceWorkspace(params);
  }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) return <p role="alert">No tienes permiso global para consultar cuentas.</p>;
    if (error instanceof AccountMaintenanceError) return <div><p role="alert">Los filtros no son válidos.</p><Link href="/accounts">Restablecer filtros</Link></div>;
    throw error;
  }
  const search = typeof params.search === "string" ? params.search.trim() : "";
  const { page, pageSize } = data.list;
  return <div className="mx-auto w-full max-w-6xl">
    <h1 className="text-2xl font-semibold text-primary">Administrar cuentas</h1>
    <p className="mt-2 text-muted">Consulta el estado de acceso y administra identificadores. Los datos de personas, roles y asignaciones conservan sus procedimientos propios.</p>
    <AccountMaintenanceWorkspace key={`${data.actorId}:${data.canUpdate}:${page}:${pageSize}:${search}`} {...data} search={search} />
  </div>;
}
