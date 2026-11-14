import Link from "next/link";
import { redirect } from "next/navigation";
import { SelectField } from "@/components/ui/select-field";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { CatalogError, readCatalog } from "@/features/discipline/server/catalog";
import { CatalogWorkspace } from "@/features/discipline/components/catalog-workspace";

export const metadata = { title: "Catálogo disciplinario" };
export default async function CatalogPage({ searchParams }: { searchParams: Promise<{ season?: string; rule?: string }> }) {
  let workspace;
  try { workspace = await readCatalog(await searchParams); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError || error instanceof CatalogError) return <section><h1 className="text-2xl font-semibold">Catálogo disciplinario</h1><p className="mt-4">No tienes acceso a este catálogo o el contexto no es válido.</p><Link href="/access">Volver a mi panel</Link></section>;
    throw error;
  }
  return <section className="mx-auto max-w-6xl space-y-6"><header><h1 className="text-2xl font-semibold">Catálogo disciplinario</h1><p className="mt-2 text-muted-foreground">Artículos, consecuencias y versiones de convocatoria.</p></header>
    <form className="flex flex-wrap items-end gap-3" method="get"><div className="min-w-0 flex-1"><label htmlFor="catalog-season" className="mb-2 block">Temporada</label><SelectField id="catalog-season" name="season" defaultValue={workspace.season?.id ?? ""} required options={workspace.seasons.map(s => ({ value: s.id, label: `${s.leagues.name} · ${s.name}` }))} /></div><button className="primary-action min-h-12 rounded-xl px-5">Consultar</button></form>
    {!workspace.seasons.length ? <p>No hay temporadas disponibles en tu ámbito.</p> : !workspace.season ? <p>Selecciona explícitamente la temporada que deseas consultar.</p> : <CatalogWorkspace workspace={workspace} />}
  </section>;
}
