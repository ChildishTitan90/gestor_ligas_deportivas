import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { SelectField } from "@/components/ui/select-field";
import { ActionLink } from "@/components/ui/action-link";
import { getCurrentAccount } from "@/features/auth/server/account-presentation";
import { getSeasonWorkspace } from "@/features/competitions/server/seasons";
import { createSeasonAction } from "@/features/competitions/actions";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";

export const metadata = { title: "Temporadas" };
const control = "min-h-12 w-full rounded-xl border border-border bg-surface px-4 py-3";
const messages: Record<string, string> = {
  INVALID_SEASON: "Revisa el nombre y las fechas. La fecha final no puede ser anterior al inicio.",
  DUPLICATE_SEASON: "Ya existe una temporada de fútbol con ese nombre en la liga.",
  INVALID_CONTEXT: "La liga o el catálogo de fútbol no están disponibles.",
  FORBIDDEN: "No tienes permiso para crear temporadas en esa liga.",
  UNAVAILABLE: "No se pudo confirmar el alta. Consulta el listado antes de intentarlo otra vez.",
};
export default async function SeasonsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const current = await getCurrentAccount({ includeAssignments: true });
  if (!current) redirect("/login");
  if (current.mustChangePassword) redirect("/change-password");
  const params = await searchParams;
  let data: Awaited<ReturnType<typeof getSeasonWorkspace>> | undefined;
  let denied = false;
  try { data = await getSeasonWorkspace(); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    denied = error instanceof AuthorizationError;
  }
  const creationLeagues = data?.leagues.filter(league => league.canCreate) ?? [];
  return <div className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10">
    <ManagementPageHeader title="Temporadas" description="Consulta y configura las temporadas de tus ligas."
      back={{ href: "/access", label: "Volver al panel" }} />
    {!data ? <p role="alert">{denied ? "No tienes permiso para consultar temporadas de una liga." : "No se pudieron cargar las temporadas. Intenta nuevamente."}</p> : <>
      {typeof params.error === "string" && <p role="alert">{messages[params.error] ?? messages.UNAVAILABLE}</p>}
      {params.created === "1" && <p role="status">Temporada creada como planificada. Configura sus categorías y reglas antes de recibir inscripciones.</p>}
      {!!creationLeagues.length && <section className="rounded-2xl border border-border bg-surface p-6">
        <h2 className="mb-4 text-xl font-semibold">Crear temporada</h2>
        <form action={createSeasonAction} className="space-y-4">
          <label className="block">Liga<SelectField name="leagueId" required options={creationLeagues.map(league => ({ value: league.id, label: league.name }))} /></label>
          <label className="block">Nombre<input name="name" required maxLength={160} className={control} /></label>
          <label className="block">Fecha de inicio<input name="startDate" type="date" required className={control} /></label>
          <label className="block">Fecha de fin<input name="endDate" type="date" required className={control} /></label>
          <p>Se crea planificada. Estas fechas corresponden a la temporada; las ventanas de registro de jugadores se configuran por separado.</p>
          <button className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold">Crear temporada</button>
        </form>
      </section>}
      <section aria-labelledby="seasons-heading" className="space-y-4"><h2 id="seasons-heading" className="text-xl font-semibold">Temporadas registradas</h2>
        {data.seasons.length === 0 ? <p>No hay temporadas registradas en tus ligas disponibles.</p>
          : <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
          {data.seasons.map(season => <li key={season.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h3 className="font-semibold text-primary">{season.name}</h3>
              <p className="text-sm text-muted">{data.leagues.find(league => league.id === season.leagueId)?.name} · {season.startDate} a {season.endDate}</p>
              <p className="text-sm">{({ PLANNED: "Planificada", ACTIVE: "Activa", CLOSED: "Cerrada" } as Record<string, string>)[season.status] ?? season.status} · Versión {season.version}</p>
            </div>
            <div className="shrink-0"><ActionLink href={`/competitions/seasons/${season.id}`} variant="secondary">Configurar temporada</ActionLink></div>
          </li>)}
        </ul>}
      </section>
    </>}
  </div>;
}
