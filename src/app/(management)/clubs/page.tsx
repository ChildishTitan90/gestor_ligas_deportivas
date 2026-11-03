import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SelectField } from "@/components/ui/select-field";
import { MaintenanceList } from "@/features/clubs/components/maintenance-list";
import { getMaintenanceWorkspace, MaintenanceError } from "@/features/clubs/server/maintenance";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";

export const metadata: Metadata = { title: "Administrar clubes y equipos" };
export default async function ClubsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const value = (key: string) => typeof params[key] === "string" ? params[key] : undefined;
  const input = { q: value("q"), kind: value("kind"), status: value("status"), after: value("after") };
  let data;
  try { data = await getMaintenanceWorkspace(input); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) return <p role="alert">No tienes permiso para consultar clubes y equipos.</p>;
    if (error instanceof MaintenanceError) return <div><p role="alert">Los filtros no son válidos.</p><Link href="/clubs">Restablecer filtros</Link></div>;
    throw error;
  }
  const next = new URLSearchParams({ q: input.q ?? "", kind: input.kind ?? "club", status: input.status ?? "all", after: data.nextAfter ?? "" });
  return <div className="mx-auto w-full max-w-6xl">
    <h1 className="text-2xl font-semibold text-primary">Administrar clubes y equipos</h1>
    <p className="mt-2 text-muted">Consulta datos, historial y bajas temporales. Las altas se realizan desde afiliación e inscripción.</p>
    <form className="mt-6 grid gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-2 lg:grid-cols-4">
      <label htmlFor="maintenance-search">Nombre o referencia<input id="maintenance-search" name="q" defaultValue={input.q} maxLength={160} className="min-h-12 w-full rounded-xl border border-border bg-surface px-3 text-foreground" /></label>
      <div><label htmlFor="maintenance-kind">Consultar</label><SelectField id="maintenance-kind" name="kind" defaultValue={input.kind ?? "club"} options={[{ value: "club", label: "Clubes" }, { value: "team", label: "Equipos" }]} searchable={false} /></div>
      <div><label htmlFor="maintenance-status">Estado</label><SelectField id="maintenance-status" name="status" defaultValue={input.status ?? "all"} options={[{ value: "all", label: "Todos" }, { value: "ACTIVE", label: "Activos" }, { value: "INACTIVE", label: "Baja temporal / bloqueados" }]} searchable={false} /></div>
      <button className="primary-action min-h-12 self-end rounded-xl px-5 py-3 font-semibold">Buscar</button>
    </form>
    <MaintenanceList items={data.items} />
    <nav aria-label="Paginación de clubes y equipos" className="mt-6 flex gap-5">
      {input.after && <Link href={`/clubs?${new URLSearchParams({ q: input.q ?? "", kind: input.kind ?? "club", status: input.status ?? "all" })}`} className="min-h-12 underline">Volver al inicio</Link>}
      {data.nextAfter && <Link href={`/clubs?${next}`} className="min-h-12 underline">Siguiente página</Link>}
    </nav>
  </div>;
}
