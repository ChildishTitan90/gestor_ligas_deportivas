import Link from "next/link";
import { ArrowRight, ClipboardCheck, FilePenLine, UsersRound, UserRoundPlus } from "lucide-react";
import { ActionLink } from "@/components/ui/action-link";
import type { ManagementNavigationGroup } from "@/components/layout/management-navigation";
import type { AccountPresentation } from "../types";
import type { AccessOverviewScope } from "../server/access-overview";
import type { DashboardActivity } from "../server/dashboard-queries";
import { AccessOverview } from "./access-overview";
import { SelectField } from "@/components/ui/select-field";

// Texto de presentación para destinos existentes; la capacidad la decide el servidor.
const tools = {
  "/affiliations/new": { title: "Mis afiliaciones", description: "Consulta tu solicitud, atiende correcciones o inicia la afiliación de tu club.", action: "Abrir mis solicitudes", icon: FilePenLine },
  "/affiliations/review": { title: "Revisión de afiliaciones", description: "Busca solicitudes y consulta su estado. Revisa y autoriza cuando tengas permiso.", action: "Consultar afiliaciones", icon: ClipboardCheck },
  "/teams/registrations": { title: "Inscripción y equipos", description: "Consulta las inscripciones de tus clubes. Registra equipos cuando esté habilitado.", action: "Abrir equipos", icon: UsersRound },
  "/accounts/new": { title: "Cuentas de acceso", description: "Crea cuentas y asigna los roles y ámbitos que tienes permitido administrar.", action: "Crear cuenta", icon: UserRoundPlus },
};

export function ManagementDashboard({ account, scopes, navigation, activity }: {
  account: Pick<AccountPresentation, "username" | "roleNames">;
  scopes: AccessOverviewScope[];
  navigation: ManagementNavigationGroup[];
  activity: DashboardActivity;
}) {
  const links = navigation.flatMap(group => group.items).filter(item => Object.hasOwn(tools, item.href));
  const summary = activity.summary;
  const metrics = summary ? [
    { label: "Por revisar", value: summary.awaitingReview, detail: "Afiliaciones pendientes sin correcciones solicitadas." },
    { label: "Con correcciones", value: summary.correctionsRequested, detail: "Afiliaciones pendientes de un nuevo envío." },
    { label: "Aprobadas", value: summary.approved, detail: "Afiliaciones con aprobación registrada." },
    ...(summary.enrollments !== null ? [{ label: "Inscripciones", value: summary.enrollments, detail: "Registros de inscripción, incluidos los retirados." }] : []),
  ] : [];
  const activityError = {
    invalid: "La selección no es válida. Elige una liga o un club de la lista.",
    denied: "No tienes acceso a esa selección o tu permiso cambió. Elige otra opción disponible.",
    unavailable: "No pudimos cargar el resumen. Puedes seguir usando tus accesos e intentarlo de nuevo.",
  };

  return <div className="space-y-8">
    <section aria-labelledby="dashboard-title" className="overflow-hidden rounded-3xl border border-border bg-surface shadow-sm">
      <div className="h-1 bg-accent" />
      <div className="p-6 sm:p-8">
        <p className="text-xs font-semibold tracking-widest text-muted uppercase">Tu espacio de gestión</p>
        <h1 id="dashboard-title" className="mt-3 wrap-break-word text-2xl font-semibold tracking-tight text-primary sm:text-3xl">
          {account.username ? `Hola, @${account.username}` : "Bienvenido a tu panel"}
        </h1>
        <p className="mt-3 text-sm leading-7 text-muted">Continúa con las tareas de tu liga desde tus accesos disponibles.</p>
        {account.roleNames.length > 0 && <ul aria-label="Tus roles vigentes" className="mt-4 flex flex-wrap gap-2">
          {account.roleNames.map(role => <li key={role} className="rounded-lg bg-soft px-3 py-1 text-xs leading-6 text-primary">{role}</li>)}
        </ul>}
      </div>
    </section>

    <section aria-labelledby="dashboard-tools-title">
      <h2 id="dashboard-tools-title" className="text-xl font-semibold text-primary">¿Qué necesitas hacer?</h2>
      {links.length ? <ul className="mt-4 grid gap-4 md:grid-cols-2">
        {links.map(item => {
          const tool = tools[item.href as keyof typeof tools];
          const Icon = tool.icon;
          return <li key={item.href} className="flex min-w-0 flex-col rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <span className="mb-4 flex size-11 items-center justify-center rounded-xl bg-soft text-primary"><Icon size={23} aria-hidden="true" /></span>
            <h3 className="text-lg font-semibold text-primary">{tool.title}</h3>
            <p className="mt-2 mb-5 text-sm leading-6 text-muted">{tool.description}</p>
            <ActionLink href={item.href} className="mt-auto justify-between gap-3">{tool.action}<ArrowRight size={18} aria-hidden="true" /></ActionLink>
          </li>;
        })}
      </ul> : <div className="mt-4 rounded-2xl border border-border bg-surface p-6">
        <p className="text-sm leading-7 text-muted">No tienes herramientas de gestión disponibles por ahora. Puedes consultar tus permisos o comunicarte con la administración si necesitas acceso.</p>
        <ActionLink href="/futbol" variant="secondary" className="mt-4">Ir al portal público</ActionLink>
      </div>}
    </section>

    <section aria-labelledby="dashboard-activity-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-8">
      <h2 id="dashboard-activity-title" className="text-xl font-semibold text-primary">Resumen de afiliaciones e inscripciones</h2>
      <p id="dashboard-context-help" className="mt-2 text-sm leading-6 text-muted">Elige una liga o un club. Las cifras corresponden a todas sus temporadas; no se suman ámbitos distintos.</p>
      {activity.state in activityError && <div role="alert" className="mt-4 rounded-xl border border-border bg-background p-4 text-sm leading-6">
        <p>{activityError[activity.state as keyof typeof activityError]}</p>
        <a href="" className="mt-2 inline-flex min-h-11 items-center font-semibold text-primary underline">Reintentar resumen</a>
      </div>}
      {activity.options.length > 0 ? <form action="/access" method="get" className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="dashboard-context" className="mb-2 block text-sm font-medium">Liga o club</label>
          <SelectField key={activity.selected} id="dashboard-context" name="context" defaultValue={activity.selected} aria-describedby="dashboard-context-help"
            options={[{ value: "", label: "Selecciona una opción" }, ...activity.options]} />
        </div>
        <button type="submit" className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold">Ver resumen</button>
      </form> : activity.state === "ready" && <p className="mt-4 text-sm leading-6 text-muted">No tienes ligas o clubes consultables para este resumen. Tus demás accesos siguen disponibles.</p>}
      {(activity.nextClubAfter || activity.selected) && <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {activity.nextClubAfter && <Link href={`/access?${new URLSearchParams({ clubAfter: activity.nextClubAfter, ...(activity.selected ? { context: activity.selected } : {}) })}`} className="inline-flex min-h-11 items-center font-medium text-primary underline">Ver más clubes</Link>}
        <Link href="/access" className="inline-flex min-h-11 items-center font-medium text-primary underline">Limpiar selección y volver al inicio de la lista</Link>
      </div>}
      {!summary && activity.state === "ready" && activity.options.length > 0 && <p className="mt-5 text-sm text-muted">Selecciona el contexto que quieres consultar para ver sus cifras.</p>}
      {summary && <div className="mt-6" role="region" aria-label="Indicadores del contexto seleccionado">
        <h3 className="wrap-break-word font-semibold text-primary">{summary.name}</h3>
        <p className="mt-1 text-xs leading-6 text-muted">Todas las temporadas · Consulta actual del servidor</p>
        <dl className={`mt-4 grid gap-3 sm:grid-cols-2 ${metrics.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
          {metrics.map(metric => <div key={metric.label} className="rounded-2xl border border-border bg-background p-4">
            <dt className="text-sm font-medium text-muted">{metric.label}</dt>
            <dd className="mt-2 text-3xl font-semibold text-primary tabular-nums">{metric.value.toLocaleString("es-MX")}</dd>
            <dd className="mt-2 text-xs leading-5 text-muted">{metric.detail}</dd>
          </div>)}
        </dl>
        {metrics.every(metric => metric.value === 0) && <p className="mt-4 text-sm leading-6 text-muted">No hay afiliaciones pendientes ni aprobadas{summary.enrollments === 0 ? ", ni inscripciones registradas" : ""} en esta selección.</p>}
      </div>}
    </section>

    <details className="rounded-3xl border border-border bg-surface">
      <summary className="cursor-pointer rounded-3xl p-5 font-semibold text-primary sm:px-8">Consultar mis permisos y ámbitos</summary>
      <AccessOverview scopes={scopes} />
    </details>
  </div>;
}
