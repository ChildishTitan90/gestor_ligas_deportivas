import { SchedulingPolicyFields } from "@/features/competitions/components/scheduling-policy-fields";
import { PlayoffFields } from "@/features/competitions/components/playoff-fields";
import { playoffRulesSchema } from "@/features/competitions/playoff-qualification";
import { z } from "zod";
import { schedulingPolicySchema } from "@/features/scheduling/schemas";
import { RuleParameter } from "@/features/competitions/components/rule-parameter";
import { TieBreakerFields } from "@/features/competitions/components/tie-breaker-fields";
import { PlayerPolicyFields, PlayerPolicySummary } from "@/features/competitions/components/player-policy-fields";
import { redirect } from "next/navigation";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ActionLink } from "@/components/ui/action-link";
import { ProcessSteps } from "@/components/ui/process-steps";
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
const seasonSteps = ["Preparar", "Altas cerradas", "En curso", "Cerrada"];
const seasonStatusLabels: Record<string, string> = { PLANNED: "Planificada", ACTIVE: "Activa", CLOSED: "Cerrada" };
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
    const league = workspace.leagues.find(league => league.id === config.season.leagueId);
    const [catalog, categories, capabilities] = await Promise.all([listCategoryCatalog(config.season.leagueId), listSeasonCategories(id), getConfigurationCapabilities(id)]);
    const groups = await Promise.all(categories.items.map(category => listCompetitionGroups(id, category.id)));
    data = { ...config, catalog, categories, capabilities, groups, dates, league };
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    const denied = error instanceof AuthorizationError;
    return <div className="space-y-4 p-6"><h1 className="text-2xl font-semibold">Configuración de competencia</h1><p role="alert">{denied ? "No tienes permiso para consultar la configuración de esta temporada." : "No se pudo cargar la configuración. Vuelve a intentarlo."}</p><ActionLink href={denied ? "/access" : "/competitions/seasons"}>{denied ? "Volver al panel" : "Volver a temporadas"}</ActionLink></div>;
  }
  const { season, rules, capabilities } = data;
  const base = `/api/competitions/seasons/${id}`;
  const editable = season.status === "PLANNED" && capabilities.update;
  const closed = season.status === "CLOSED";
  const active = season.status === "ACTIVE";
  const currentStep = closed ? 3 : active ? 2 : season.teamRegistrationClosed ? 1 : 0;
  const latest = Object.fromEntries((rules[0]?.parameters ?? []).map(parameter => [parameter.key, parameter.value]));
  const calendar = latest.calendar;
  const previousScheduling = calendar && typeof calendar === "object" && !Array.isArray(calendar)
    ? schedulingPolicySchema.safeParse(calendar.scheduling) : null;
  const previousPlayoff = calendar && typeof calendar === "object" && !Array.isArray(calendar)
    ? playoffRulesSchema.extend({ regularDeadline: z.iso.date(), dates: z.array(z.iso.date()).optional() }).safeParse(calendar.playoff) : null;
  function previousNumber(group: string, key: string) {
    const value = latest[group];
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const number = value[key];
    return typeof number === "number" ? number : undefined;
  }
  return <div className="mx-auto max-w-5xl space-y-6 p-6">
    <ManagementPageHeader title={season.name} description="Consulta el avance de la temporada y configura sus reglas, categorías y grupos."
      back={{ href: "/competitions/seasons", label: "Volver a temporadas" }}
      context={[
        ...(data.league ? [{ label: "Liga", value: data.league.name }] : []),
        { label: "Estado de la temporada", value: seasonStatusLabels[season.status] ?? season.status },
        { label: "Inscripciones de equipos", value: season.teamRegistrationClosed || closed ? "Cerradas" : "Abiertas" },
        { label: "Versión", value: String(season.version) },
      ]} />
    {seasonStatusLabels[season.status] && <section aria-labelledby="season-progress" className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <h2 id="season-progress" className="text-lg font-semibold text-primary">Avance de la temporada</h2>
      <ProcessSteps label="Etapas de la temporada" steps={seasonSteps} current={currentStep}
        completedSteps={[currentStep > 0, season.teamRegistrationClosed, closed, closed]} />
      {closed ? <p className="text-sm text-muted">La configuración queda disponible para consulta.</p>
        : active ? <p className="text-sm text-muted">Para cerrar la temporada, completa los resultados de los partidos disputados.</p>
          : season.teamRegistrationClosed
            ? <p className="text-sm text-muted">Para iniciar la competencia, asigna los equipos a sus grupos y verifica que los reglamentos asociados estén aprobados y sin parámetros pendientes.</p>
            : <p className="text-sm text-muted">Prepara las reglas y asocia las categorías que se usarán para afiliación. Después configura las reglas de jugadores de cada categoría. Cuando termine el periodo de alta de equipos, cierra las inscripciones.</p>}
      {editable && !season.teamRegistrationClosed && <ConfigurationForm modal title="Cerrar inscripciones de equipos" endpoint={`${base}/lifecycle/close-registrations`} version={season.version}>
        <p>El cierre es definitivo e impide nuevas inscripciones de equipos para esta temporada. Se conservan las inscripciones existentes y las ventanas de registro de jugadores.</p>
      </ConfigurationForm>}
      {editable && season.teamRegistrationClosed && <ConfigurationForm modal title="Iniciar competencia" endpoint={`${base}/lifecycle/start`} version={season.version}>
        <p>Para iniciar, todos los equipos inscritos deben tener un grupo asignado y los reglamentos asociados deben estar aprobados, con sus parámetros validados. Las reglas y los grupos quedarán protegidos contra cambios incompatibles. Las jornadas y los horarios se generan desde Programación.</p>
      </ConfigurationForm>}
      {capabilities.update && active && <ConfigurationForm key={`close-${season.version}`} modal title="Cerrar temporada" endpoint={`${base}/close`} version={season.version}>
        <p>El cierre es irreversible y conserva el historial en solo lectura. Antes deben completarse los resultados de los partidos disputados. Los partidos cancelados no requieren marcador.</p>
        <Field name="confirm" label="Escribe CERRAR para confirmar" />
      </ConfigurationForm>}
    </section>}
    <nav aria-label="Secciones de configuración" className="flex flex-wrap gap-3"><ActionLink variant="secondary" href={`/competitions/seasons/${id}/player-pathways`}>Categorías que permiten subir</ActionLink><ActionLink href="#season-rules" variant="secondary">Reglas</ActionLink><ActionLink href="#season-categories" variant="secondary">Categorías y grupos</ActionLink></nav>
    <p>Total de inscripciones en la temporada: {data.groups.reduce((total, group) => total + group.total, 0)}</p>
    {editable && <div className="flex flex-wrap gap-3">
      {data.dates && <ConfigurationForm key={`season-${season.version}`} modal title="Editar temporada" endpoint={base} method="PATCH" version={season.version}><Field name="name" label="Nombre" value={season.name} /><Field name="startDate" label="Fecha de inicio" type="date" value={data.dates.startDate} /><Field name="endDate" label="Fecha de fin" type="date" value={data.dates.endDate} /><p>El servidor protege las fechas cuando ya existen datos relacionados.</p></ConfigurationForm>}
      <ConfigurationForm modal title="Eliminar temporada vacía" endpoint={base} method="DELETE" version={season.version} successHref="/competitions/seasons"><p>La eliminación es definitiva. Solo se permite si no hay reglas, categorías ni otros datos relacionados.</p></ConfigurationForm>
    </div>}
    <section id="season-rules" className="scroll-mt-24 space-y-4"><h2 className="text-xl font-semibold">Reglas de esta temporada</h2>
      {!rules.length && <p>{season.status === "CLOSED" ? "No hay versiones de reglas registradas en esta temporada." : "Todavía no hay versiones de reglas. Crea un borrador antes de asociar categorías."}</p>}
    {capabilities.update && season.status !== "CLOSED" && <ConfigurationForm modal key={`rules-${season.version}`} title={rules.length ? "Modificar reglas · nueva versión" : "Crear reglas de temporada"} endpoint={`${base}/configuration`} version={season.version}>
      <label className="block">Convocatoria<textarea name="announcement" required maxLength={12000} defaultValue={typeof latest.announcement === "string" ? latest.announcement : ""} className={control} /></label>
      <div className="grid gap-4 sm:grid-cols-3"><Field name="win" label="Puntos por victoria" type="number" value={previousNumber("points", "win")} /><Field name="draw" label="Puntos por empate" type="number" value={previousNumber("points", "draw")} /><Field name="loss" label="Puntos por derrota" type="number" value={previousNumber("points", "loss")} /></div>
      <TieBreakerFields initialValues={Array.isArray(latest.tieBreakers) ? latest.tieBreakers.filter((value): value is string => typeof value === "string") : []} />
      <Field name="rounds" label="Vueltas" type="number" value={previousNumber("calendar", "rounds")} /><Field name="matchDurationMinutes" label="Duración del partido (minutos)" type="number" value={previousNumber("calendar", "matchDurationMinutes")} />
      <label className="block">Últimas jornadas solo en unidad deportiva
        <input name="complexOnlyFinalRounds" type="number" min={0} step={1} aria-describedby="complex-only-final-rounds-help"
          defaultValue={previousNumber("calendar", "complexOnlyFinalRounds")} className={control} />
        <span id="complex-only-final-rounds-help" className="mt-1 block text-sm text-muted">Usa 0 para desactivar la restricción o deja el campo vacío si aún no se ha definido.</span>
      </label>
      <SchedulingPolicyFields venues={data.venues} initial={previousScheduling?.success ? previousScheduling.data : undefined} />
      <PlayoffFields initial={previousPlayoff?.success ? previousPlayoff.data : undefined} seasonStart={data.dates?.startDate} seasonEnd={data.dates?.endDate} venues={data.venues} />
      <p>El borrador conserva las versiones anteriores. Su creación no publica ni aprueba las reglas.</p>
    </ConfigurationForm>}
      {rules.map((rule, index) => <details key={rule.id} open={index === 0} className="rounded-2xl border border-border bg-surface p-5"><summary className="min-h-12 cursor-pointer font-semibold">Versión {rule.version} · {rule.status === "DRAFT" ? "Borrador" : rule.status === "APPROVED" ? "Aprobado" : rule.status}{index === 0 ? " · Última versión" : " · Historial"}</summary>
        {rule.parameters.map(parameter => <RuleParameter key={parameter.key} parameter={parameter} venueNames={Object.fromEntries(data.venues.map(venue => [venue.id, `${venue.name} · ${venue.code}`]))} />)}
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
        return <article id={`category-${category.id}`} key={category.id} className="scroll-mt-24 space-y-4 rounded-2xl border border-border bg-surface p-5"><h3 className="text-lg font-semibold">{category.name}</h3>
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
