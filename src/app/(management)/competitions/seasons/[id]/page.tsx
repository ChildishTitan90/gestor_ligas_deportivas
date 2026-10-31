import { redirect } from "next/navigation";
import { ActionLink } from "@/components/ui/action-link";
import { SelectField } from "@/components/ui/select-field";
import { ConfigurationForm } from "@/features/competitions/components/configuration-form";
import { getCompetitionConfiguration } from "@/features/competitions/server/configuration";
import { listCategoryCatalog, listSeasonCategories } from "@/features/competitions/server/categories";
import { listCompetitionGroups } from "@/features/competitions/server/groups";
import { getConfigurationCapabilities } from "@/features/competitions/server/view-permissions";
import { AuthAccessError } from "@/server/auth/session";
import { getSeasonWorkspace } from "@/features/competitions/server/seasons";

export const metadata = { title: "Configurar competencia" };
const control = "min-h-12 w-full rounded-xl border border-border bg-surface p-3";
function Field({ name, label, type = "text", value }: { name: string; label: string; type?: string; value?: string | number }) {
  return <label className="block">{label}<input className={control} name={name} type={type} defaultValue={value} required maxLength={160} /></label>;
}
export default async function ConfigurationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let data;
  try {
    const config = await getCompetitionConfiguration(id);
    const workspace = await getSeasonWorkspace();
    const dates = workspace.seasons.find(season => season.id === id);
    const [catalog, categories, capabilities] = await Promise.all([listCategoryCatalog(config.season.leagueId), listSeasonCategories(id), getConfigurationCapabilities(id)]);
    const groups = await Promise.all(categories.items.map(category => listCompetitionGroups(id, category.id)));
    data = { ...config, catalog, categories, capabilities, groups, dates };
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    return <div className="p-6"><ActionLink href="/competitions/seasons">Volver a temporadas</ActionLink><p role="alert">No se pudo cargar la configuración. Comprueba tus permisos y vuelve a intentarlo.</p></div>;
  }
  const { season, rules, capabilities } = data;
  const base = `/api/competitions/seasons/${id}`;
  const editable = season.status === "PLANNED" && capabilities.update;
  return <div className="mx-auto max-w-5xl space-y-6 p-6">
    <ActionLink href="/competitions/seasons" variant="secondary">Volver a temporadas</ActionLink>
    <h1 className="text-2xl font-semibold">{season.name}</h1><p>Configuración · Versión de temporada {season.version}</p>
    {season.status === "CLOSED" && <p role="status">Temporada cerrada. La configuración se conserva para consulta.</p>}
    {editable && data.dates && <ConfigurationForm key={`season-${season.version}`} modal title="Editar temporada" endpoint={base} method="PATCH" version={season.version}><Field name="name" label="Nombre" value={season.name} /><Field name="startDate" label="Fecha de inicio" type="date" value={data.dates.startDate} /><Field name="endDate" label="Fecha de fin" type="date" value={data.dates.endDate} /><p>El servidor protege las fechas cuando ya existen datos relacionados.</p></ConfigurationForm>}
    <section className="space-y-4"><h2 className="text-xl font-semibold">Reglas de esta temporada</h2>
      {!rules.length && <p>Todavía no hay versiones de reglas. Crea un borrador antes de asociar categorías.</p>}
      {rules.map(rule => <article key={rule.id} className="rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold">Versión {rule.version} · {rule.status === "DRAFT" ? "Borrador" : rule.status}</h3>
        {rule.parameters.map(parameter => <div key={parameter.key} className="mt-3"><p>{parameter.key}{parameter.requiresValidation ? " · Pendiente de validación" : ""}</p><pre className="whitespace-pre-wrap break-words text-sm">{JSON.stringify(parameter.value, null, 2)}</pre></div>)}
      </article>)}
    </section>
    {capabilities.update && season.status !== "CLOSED" && <ConfigurationForm key={`rules-${season.version}`} title="Crear nueva versión en borrador" endpoint={`${base}/configuration`} version={season.version}>
      <label className="block">Convocatoria<textarea name="announcement" required maxLength={12000} className={control} /></label>
      <div className="grid gap-4 sm:grid-cols-3"><Field name="win" label="Puntos por victoria" type="number" /><Field name="draw" label="Puntos por empate" type="number" /><Field name="loss" label="Puntos por derrota" type="number" /></div>
      <Field name="tieBreakers" label="Códigos de desempate en orden, separados por coma" /><Field name="rounds" label="Vueltas" type="number" /><Field name="matchDurationMinutes" label="Duración del partido (minutos)" type="number" />
      <p>El borrador conserva las versiones anteriores. Su creación no publica ni aprueba las reglas.</p>
    </ConfigurationForm>}
    <section className="space-y-4"><h2 className="text-xl font-semibold">Categorías de la temporada</h2>
      {!data.categories.items.length && <p>No hay categorías asociadas.</p>}
      {data.categories.items.map((category, index) => {
        const endpoint = `${base}/categories/${category.id}`;
        return <article key={category.id} className="space-y-4 rounded-2xl border border-border bg-surface p-5"><h3 className="text-lg font-semibold">{category.name}</h3>
          <p>Reglas: versión {rules.find(rule => rule.id === category.ruleId)?.version ?? "no disponible"} · {category.format === "GENERAL_TABLE" ? "Tabla general" : category.format === "GROUP_STAGE" ? "Fase de grupos" : "Grupos existentes"}</p>
          {category.eligibilityPending && <p>Elegibilidad pendiente de configurar. Esta asociación no habilita por sí sola el registro de jugadores.</p>}
          {category.format === "GENERAL_TABLE" && <p>Las inscripciones se asignan automáticamente a General.</p>}
          {category.format === "GROUP_STAGE" && <p>Los equipos se inscriben por categoría y quedan pendientes de asignación. La distribución equilibra la carga de los grupos y conserva las asignaciones anteriores.</p>}
          {!data.groups[index].items.length && <p>No hay grupos creados.</p>}
          {data.groups[index].items.map(group => <div key={group.id} className="flex flex-wrap items-center gap-3"><span>{group.name} · {group._count.season_teams} inscripciones</span>
            {editable && category.format !== "GENERAL_TABLE" && <><ConfigurationForm key={`rename-${group.id}-${season.version}`} modal title={`Renombrar ${group.name}`} endpoint={`${endpoint}/groups`} method="PATCH" version={season.version} fixed={{ groupId: group.id }}><Field name="name" label="Nombre" value={group.name} /></ConfigurationForm><ConfigurationForm key={`delete-${group.id}-${season.version}`} modal title={`Eliminar ${group.name}`} endpoint={`${endpoint}/groups`} method="DELETE" version={season.version} fixed={{ groupId: group.id }}><p>Solo se elimina si no tiene equipos, partidos ni clasificaciones relacionados.</p></ConfigurationForm></>}
          </div>)}
          {editable && category.format === "LEGACY_GROUPS" && <ConfigurationForm title="Definir formato" endpoint={`${endpoint}/format`} method="PATCH" version={season.version}><label>Formato<SelectField name="format" required options={[{ value: "GENERAL_TABLE", label: "Tabla general" }, { value: "GROUP_STAGE", label: "Fase de grupos" }]} /></label><p>Solo se puede definir antes de tener grupos o afiliaciones relacionadas.</p></ConfigurationForm>}
          {capabilities.create && season.status === "PLANNED" && category.format !== "GENERAL_TABLE" && <ConfigurationForm key={`new-${category.id}-${season.version}`} modal title="Crear grupo" endpoint={`${endpoint}/groups`} version={season.version}><Field name="name" label="Nombre del grupo" /></ConfigurationForm>}
          {capabilities.distribute && season.status !== "CLOSED" && category.format === "GROUP_STAGE" && <ConfigurationForm key={`distribute-${category.id}-${season.version}`} modal title="Distribuir equipos pendientes" endpoint={`${endpoint}/distribution/automatic`} version={season.version}><p>Confirmar asignará todos los equipos pendientes de esta categoría. Debe existir al menos un grupo; las autorizaciones se comprueban en el servidor.</p></ConfigurationForm>}
        </article>;
      })}
    </section>
    {capabilities.create && <ConfigurationForm title="Crear categoría en el catálogo de la liga" endpoint="/api/competitions/categories" version={season.version} fixed={{ leagueId: season.leagueId }}><Field name="name" label="Nombre de categoría" /></ConfigurationForm>}
    {editable && !!rules.length && !!data.catalog.items.length && <ConfigurationForm key={`associate-${season.version}`} title="Asociar categoría a la temporada" endpoint={`${base}/categories`} version={season.version} numbers={["hierarchyOrder"]}>
      <label>Categoría<SelectField name="categoryId" required options={data.catalog.items.map(category => ({ value: category.id, label: category.name }))} /></label>
      <label>Versión de reglas<SelectField name="ruleId" required options={rules.map(rule => ({ value: rule.id, label: `Versión ${rule.version} · ${rule.status}` }))} /></label>
      <label>Tipo<SelectField name="type" required options={[{ value: "OPEN", label: "Libre" }, { value: "YOUTH", label: "Juvenil" }, { value: "VETERANS", label: "Veteranos" }]} /></label><Field name="hierarchyOrder" label="Orden de jerarquía" type="number" />
    </ConfigurationForm>}
  </div>;
}
