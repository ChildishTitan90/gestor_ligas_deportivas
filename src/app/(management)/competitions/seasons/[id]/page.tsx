import { RuleParameter } from "@/features/competitions/components/rule-parameter";
import { TieBreakerFields } from "@/features/competitions/components/tie-breaker-fields";
import { PlayerPolicyFields, PlayerPolicySummary } from "@/features/competitions/components/player-policy-fields";
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
import { AuthorizationError } from "@/server/auth/authorization";

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
    const denied = error instanceof AuthorizationError;
    return <div className="space-y-4 p-6"><h1 className="text-2xl font-semibold">Configuración de competencia</h1><p role="alert">{denied ? "No tienes permiso para consultar la configuración de esta temporada." : "No se pudo cargar la configuración. Vuelve a intentarlo."}</p><ActionLink href={denied ? "/access" : "/competitions/seasons"}>{denied ? "Volver al panel" : "Volver a temporadas"}</ActionLink></div>;
  }
  const { season, rules, capabilities } = data;
  const base = `/api/competitions/seasons/${id}`;
  const editable = season.status === "PLANNED" && capabilities.update;
  const latest = Object.fromEntries((rules[0]?.parameters ?? []).map(parameter => [parameter.key, parameter.value]));
  function previousNumber(group: string, key: string) {
    const value = latest[group];
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const number = value[key];
    return typeof number === "number" ? number : undefined;
  }
  return <div className="mx-auto max-w-5xl space-y-6 p-6">
    <ActionLink href="/competitions/seasons" variant="secondary">Volver a temporadas</ActionLink>
    <h1 className="text-2xl font-semibold">{season.name}</h1><p>Configuración · Versión de temporada {season.version}</p>
    <nav aria-label="Secciones de configuración" className="flex flex-wrap gap-3"><ActionLink variant="secondary" href={`/competitions/seasons/${id}/player-pathways`}>Categorías que permiten subir</ActionLink><ActionLink href="#season-rules" variant="secondary">Reglas</ActionLink><ActionLink href="#season-categories" variant="secondary">Categorías y grupos</ActionLink></nav>
    {season.status === "PLANNED" && <p className="rounded-xl border border-border bg-surface p-4">Preparación de la temporada: crea una versión de reglas, crea las categorías en el catálogo y asócialas a esta temporada. Después configura las reglas de jugadores de cada categoría, incluidos los jugadores en cancha y los convocados. Las categorías del catálogo solo estarán disponibles para afiliación cuando estén asociadas a la temporada.</p>}
    {season.status === "CLOSED" && <p role="status">Temporada cerrada. La configuración se conserva para consulta.</p>}
    <p>Inscripciones de equipos: {season.teamRegistrationClosed || season.status === "CLOSED" ? "Cerradas" : "Abiertas"}</p>
    <p>Total de inscripciones en la temporada: {data.groups.reduce((total, group) => total + group.total, 0)}</p>
    {editable && !season.teamRegistrationClosed && <ConfigurationForm modal title="Cerrar inscripciones de equipos" endpoint={`${base}/lifecycle/close-registrations`} version={season.version}><p>Se impedirán nuevas inscripciones de equipos para esta temporada. Las inscripciones existentes y su historial se conservan. Por ahora no existe una opción para reabrirlas; esta acción no cierra los registros de jugadores.</p></ConfigurationForm>}
    {editable && season.teamRegistrationClosed && <ConfigurationForm modal title="Iniciar competencia" endpoint={`${base}/lifecycle/start`} version={season.version}><p>Las inscripciones de equipos están cerradas. Para iniciar, todos los equipos inscritos deben tener un grupo asignado y los reglamentos de las categorías deben estar aprobados, sin parámetros pendientes de validación. Los borradores no permiten iniciar. Las reglas y grupos quedarán protegidos contra cambios incompatibles. Este paso no genera jornadas ni horarios.</p></ConfigurationForm>}
    {editable && <ConfigurationForm modal title="Eliminar temporada vacía" endpoint={base} method="DELETE" version={season.version} successHref="/competitions/seasons"><p>La eliminación es definitiva. Solo se permite si no hay reglas, categorías ni otros datos relacionados.</p></ConfigurationForm>}
    {capabilities.update && season.status === "ACTIVE" && <ConfigurationForm key={`close-${season.version}`} modal title="Cerrar temporada" endpoint={`${base}/close`} version={season.version}><p>El cierre conserva el historial en solo lectura y no puede revertirse. Antes deben completarse los resultados de todos los partidos disputados. Los partidos cancelados no requieren marcador.</p><Field name="confirm" label="Escribe CERRAR para confirmar" /></ConfigurationForm>}
    {editable && data.dates && <ConfigurationForm key={`season-${season.version}`} modal title="Editar temporada" endpoint={base} method="PATCH" version={season.version}><Field name="name" label="Nombre" value={season.name} /><Field name="startDate" label="Fecha de inicio" type="date" value={data.dates.startDate} /><Field name="endDate" label="Fecha de fin" type="date" value={data.dates.endDate} /><p>El servidor protege las fechas cuando ya existen datos relacionados.</p></ConfigurationForm>}
    <section id="season-rules" className="scroll-mt-24 space-y-4"><h2 className="text-xl font-semibold">Reglas de esta temporada</h2>
      {!rules.length && <p>{season.status === "CLOSED" ? "No hay versiones de reglas registradas en esta temporada." : "Todavía no hay versiones de reglas. Crea un borrador antes de asociar categorías."}</p>}
    {capabilities.update && season.status !== "CLOSED" && <ConfigurationForm modal key={`rules-${season.version}`} title={rules.length ? "Modificar reglas · nueva versión" : "Crear reglas de temporada"} endpoint={`${base}/configuration`} version={season.version}>
      <label className="block">Convocatoria<textarea name="announcement" required maxLength={12000} defaultValue={typeof latest.announcement === "string" ? latest.announcement : ""} className={control} /></label>
      <div className="grid gap-4 sm:grid-cols-3"><Field name="win" label="Puntos por victoria" type="number" value={previousNumber("points", "win")} /><Field name="draw" label="Puntos por empate" type="number" value={previousNumber("points", "draw")} /><Field name="loss" label="Puntos por derrota" type="number" value={previousNumber("points", "loss")} /></div>
      <TieBreakerFields initialValues={Array.isArray(latest.tieBreakers) ? latest.tieBreakers.filter((value): value is string => typeof value === "string") : []} />
      <Field name="rounds" label="Vueltas" type="number" value={previousNumber("calendar", "rounds")} /><Field name="matchDurationMinutes" label="Duración del partido (minutos)" type="number" value={previousNumber("calendar", "matchDurationMinutes")} />
      <p>El borrador conserva las versiones anteriores. Su creación no publica ni aprueba las reglas.</p>
    </ConfigurationForm>}
      {rules.map((rule, index) => <details key={rule.id} open={index === 0} className="rounded-2xl border border-border bg-surface p-5"><summary className="min-h-12 cursor-pointer font-semibold">Versión {rule.version} · {rule.status === "DRAFT" ? "Borrador" : rule.status === "APPROVED" ? "Aprobado" : rule.status}{index === 0 ? " · Última versión" : " · Historial"}</summary>
        {rule.parameters.map(parameter => <RuleParameter key={parameter.key} parameter={parameter} />)}
        {season.status === "PLANNED" && capabilities.approve && rule.status === "DRAFT" && <ConfigurationForm key={`approve-${rule.id}-${season.version}`} modal title={`Aprobar reglamento versión ${rule.version}`} endpoint={`${base}/configuration/${rule.id}/approve`} version={season.version}>
          <p>Confirma que revisaste la convocatoria, puntuación, desempates y calendario de esta versión. La aprobación valida estos parámetros y los conserva en solo lectura; una corrección requerirá otra versión. Aprobar no inicia la competencia ni cambia el reglamento asociado a una categoría.</p>
          <Field name="confirm" label="Escribe APROBAR para confirmar la revisión" />
        </ConfigurationForm>}
      </details>)}

    </section>
    <section id="season-categories" className="scroll-mt-24 space-y-4"><h2 className="text-xl font-semibold">Categorías y grupos de la temporada</h2>
    {!!data.catalog.items.length && <details className="rounded-2xl border border-border bg-surface p-5"><summary className="min-h-12 cursor-pointer font-semibold">Consultar catálogo de categorías de la liga</summary><ul className="mt-3 space-y-2">{data.catalog.items.map(category => <li key={category.id}>{category.name} · {data.categories.items.some(item => item.categoryId === category.id) ? "Asociada a esta temporada" : "Pendiente de asociar a esta temporada"}</li>)}</ul>{editable && !rules.length && <p className="mt-3">Primero completa «Crear reglas de temporada» en Reglas de esta temporada. Después aparecerá el formulario para asociar estas categorías; no necesitas crearlas de nuevo.</p>}</details>}
    {capabilities.create && season.status !== "CLOSED" && <ConfigurationForm modal key={`catalog-${data.catalog.items.length}`} title="Crear categoría en el catálogo de la liga" endpoint="/api/competitions/categories" version={season.version} fixed={{ leagueId: season.leagueId }}><p>Esto crea una categoría reutilizable en la liga. Para usarla en afiliación, asóciala después a esta temporada.</p><Field name="name" label="Nombre de categoría" /></ConfigurationForm>}
    {editable && !!rules.length && !!data.catalog.items.length && <ConfigurationForm modal key={`associate-${season.version}`} title="Asociar categoría a la temporada" endpoint={`${base}/categories`} version={season.version} numbers={["hierarchyOrder"]}>
      <label>Categoría<SelectField name="categoryId" required options={data.catalog.items.filter(category => !data.categories.items.some(item => item.categoryId === category.id)).map(category => ({ value: category.id, label: category.name }))} /></label>
      <label>Versión de reglas<SelectField name="ruleId" required options={rules.map(rule => ({ value: rule.id, label: `Versión ${rule.version} · ${rule.status}` }))} /></label>
      <label>Tipo<SelectField name="type" required options={[{ value: "OPEN", label: "Libre" }, { value: "YOUTH", label: "Juvenil" }, { value: "VETERANS", label: "Veteranos" }]} /></label><Field name="hierarchyOrder" label="Orden de jerarquía" type="number" />
    </ConfigurationForm>}
      {!data.categories.items.length && <p>No hay categorías asociadas.</p>}
      {data.categories.items.map((category, index) => {
        const endpoint = `${base}/categories/${category.id}`;
        return <article id={`category-${category.id}`} key={category.id} className="space-y-4 rounded-2xl border border-border bg-surface p-5"><h3 className="text-lg font-semibold">{category.name}</h3>
          <p>Reglas: versión {rules.find(rule => rule.id === category.ruleId)?.version ?? "no disponible"} · {category.format === "GENERAL_TABLE" ? "Tabla general" : category.format === "GROUP_STAGE" ? "Fase de grupos" : "Grupos existentes"}</p>
          {category.eligibilityPending && <p>Elegibilidad pendiente de configurar. Esta asociación no habilita por sí sola el registro de jugadores.</p>}
          <PlayerPolicySummary value={category.playerPolicy} />
          <ActionLink variant="secondary" href={`${base.replace("/api", "")}/categories/${category.id}/documents`}>Editar política documental</ActionLink>
          {!category.playerPolicy && <p>Sin reglas de jugadores guardadas: falta definir edades, documentos, días de registro, jugadores en cancha y convocados para esta categoría.</p>}
          {editable && <>
            <ConfigurationForm key={`edit-category-${category.id}-${season.version}`} modal title={`Editar categoría ${category.name}`} endpoint={endpoint} method="PATCH" version={season.version} numbers={["hierarchyOrder"]}>
              <label>Reglamento<SelectField name="ruleId" required defaultValue={category.ruleId} options={rules.map(rule => ({ value: rule.id, label: `Versión ${rule.version}` }))} /></label>
              <label>Tipo<SelectField name="type" required defaultValue={category.type} options={[{ value: "OPEN", label: "Libre" }, { value: "YOUTH", label: "Juvenil" }, { value: "VETERANS", label: "Veteranos" }]} /></label>
              <Field name="hierarchyOrder" label="Orden de jerarquía" type="number" value={category.hierarchyOrder} /><p>Solo permite cambios sin datos relacionados; las reglas de jugadores ya configuradas se conservan.</p>
            </ConfigurationForm>
            <ConfigurationForm key={`remove-category-${category.id}-${season.version}`} modal title={`Retirar categoría ${category.name}`} endpoint={endpoint} method="DELETE" version={season.version}><p>Retira esta categoría de la temporada si no tiene datos relacionados. La categoría permanece en el catálogo de la liga.</p></ConfigurationForm>
            <details className="rounded-xl border border-border p-4"><summary className="min-h-12 cursor-pointer">Configurar reglas de jugadores · {category.name}</summary><ConfigurationForm key={`policy-${category.id}-${season.version}`} title={`Guardar reglas de jugadores de ${category.name}`} endpoint={`${endpoint}/player-policy`} method="PATCH" version={season.version}><PlayerPolicyFields value={category.playerPolicy} type={category.type} /></ConfigurationForm></details>
          </>}
          <section aria-label={`Grupos de ${category.name}`} className="space-y-4 rounded-xl border border-border bg-background p-4">
          <h4 className="text-lg font-semibold">Grupos y distribución de equipos</h4>
          <p><strong>{data.groups[index].total} inscripciones en esta categoría.</strong> {data.groups[index].unassigned} equipos pendientes de asignar a un grupo.</p>
          {category.format === "GROUP_STAGE" && <p>Crea cada grupo con el nombre que prefieras. Cuando existan equipos inscritos, podrás distribuirlos entre los grupos.</p>}
          {category.format === "GENERAL_TABLE" && <p>Esta categoría utiliza tabla general. Todos los equipos se asignan automáticamente a General; aquí no se crean grupos separados.</p>}
          {category.format === "GROUP_STAGE" && <p>Los equipos se inscriben por categoría y quedan pendientes de asignación. La distribución equilibra la carga de los grupos y conserva las asignaciones anteriores.</p>}
          {!data.groups[index].items.length && <p>No hay grupos creados.</p>}
          {data.groups[index].items.map(group => <div key={group.id} className="flex flex-wrap items-center gap-3"><span>{group.name} · {group._count.season_teams} inscripciones</span>
            {editable && category.format !== "GENERAL_TABLE" && <><ConfigurationForm key={`rename-${group.id}-${season.version}`} modal title={`Renombrar ${group.name}`} endpoint={`${endpoint}/groups`} method="PATCH" version={season.version} fixed={{ groupId: group.id }}><Field name="name" label="Nombre" value={group.name} /></ConfigurationForm><ConfigurationForm key={`delete-${group.id}-${season.version}`} modal title={`Eliminar ${group.name}`} endpoint={`${endpoint}/groups`} method="DELETE" version={season.version} fixed={{ groupId: group.id }}><p>Solo se elimina si no tiene equipos, partidos ni clasificaciones relacionados.</p></ConfigurationForm></>}
          </div>)}
          {editable && category.format === "LEGACY_GROUPS" && <ConfigurationForm modal title="Definir formato" endpoint={`${endpoint}/format`} method="PATCH" version={season.version}><label>Formato<SelectField name="format" required options={[{ value: "GENERAL_TABLE", label: "Tabla general" }, { value: "GROUP_STAGE", label: "Fase de grupos" }]} /></label><p>Solo se puede definir antes de tener grupos o afiliaciones relacionadas.</p></ConfigurationForm>}
          {capabilities.create && season.status === "PLANNED" && category.format !== "GENERAL_TABLE" && <ConfigurationForm key={`new-${category.id}-${season.version}`} modal title="Crear grupo" endpoint={`${endpoint}/groups`} version={season.version}><Field name="name" label="Nombre del grupo" /></ConfigurationForm>}
          {capabilities.distribute && season.status !== "CLOSED" && category.format === "GROUP_STAGE" && <ConfigurationForm key={`distribute-${category.id}-${season.version}`} modal title="Distribuir equipos pendientes" endpoint={`${endpoint}/distribution/automatic`} version={season.version}><p>Confirmar asignará todos los equipos pendientes de esta categoría. Debe existir al menos un grupo; las autorizaciones se comprueban en el servidor.</p></ConfigurationForm>}
          </section>
        </article>;
      })}
    </section>
  </div>;
}
