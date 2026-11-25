import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ActionLink } from "@/components/ui/action-link";
import { SelectField } from "@/components/ui/select-field";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { CatalogError, readCatalog } from "@/features/discipline/server/catalog";
import { CatalogWorkspace } from "@/features/discipline/components/catalog-workspace";

export const metadata = { title: "Catálogo disciplinario" };
const title = "Catálogo disciplinario";
const description = "Consulta los artículos, sus consecuencias y el estado de cada versión de la convocatoria.";
const back = { href: "/access", label: "Volver al panel" };

export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ season?: string; rule?: string }> }) {
  const filters = await searchParams;
  let workspace;
  try { workspace = await readCatalog(filters); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError || error instanceof CatalogError) return <section className="mx-auto max-w-6xl space-y-4">
      <ManagementPageHeader title={title} description={description} back={back} />
      <p role="alert">No tienes acceso a este catálogo o el contexto seleccionado no es válido.</p>
      {(filters.season || filters.rule) && <ActionLink href="/discipline/catalog" variant="secondary">Elegir temporada</ActionLink>}
    </section>;
    throw error;
  }
  const { season, seasons } = workspace;
  return <section className="mx-auto max-w-6xl space-y-6">
    <ManagementPageHeader title={title} description={description} back={back}
      context={season ? [{ label: "Liga", value: season.leagues.name }, { label: "Temporada", value: season.name }] : []} />
    {seasons.length > 0 && <form className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:flex-row sm:items-end" method="get">
      <div className="min-w-0 flex-1">
        <label htmlFor="catalog-season" className="mb-1 block text-sm font-medium">Temporada</label>
        <SelectField key={season?.id} id="catalog-season" name="season" defaultValue={season?.id ?? ""} required
          options={seasons.map(s => ({ value: s.id, label: s.name, description: s.leagues.name }))} />
      </div>
      <button className="primary-action min-h-12 rounded-xl px-5 font-semibold">Consultar temporada</button>
    </form>}
    {!seasons.length ? <p role="status">No hay temporadas disponibles en tu ámbito.</p>
      : !season ? <p role="status">Selecciona una temporada para consultar sus versiones de convocatoria.</p>
        : <CatalogWorkspace workspace={workspace} />}
  </section>;
}
