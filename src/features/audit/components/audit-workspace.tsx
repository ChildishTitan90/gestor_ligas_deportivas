import Link from "next/link";
import { SelectField } from "@/components/ui/select-field";
import { auditEntities, auditHref, type AuditWorkspace, type AuditDetail, type AuditFilters } from "../contract";
import { AuditJourney } from "./audit-journey";

const inputClass="mt-1 min-h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-3 py-2 text-sm";
function date(value:string,timezone:string) { return new Intl.DateTimeFormat("es-MX",{dateStyle:"medium",timeStyle:"short",timeZone:timezone}).format(new Date(value)); }

export function AuditWorkspaceView({ workspace }: { workspace: AuditWorkspace }) {
  const {filters,selected,scopes,entries,next}=workspace;
  const query=auditHref(filters).split("?")[1];
  return <div className="mx-auto max-w-6xl space-y-6 px-5 py-8">
    <header className="space-y-2"><p className="text-sm text-muted">Administración</p>
      <h1 className="text-3xl font-semibold">Bitácora de operaciones</h1>
      <p className="text-sm text-muted">Consulta quién realizó cada cambio y con qué motivo.</p>
    </header>
    <AuditJourney />
    <form action="/audit" method="get" className="space-y-4 rounded-2xl border border-border bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="min-w-0 sm:col-span-2 lg:col-span-1"><label htmlFor="audit-scope" className="text-sm font-medium">Ámbito</label>
          <SelectField key={`scope:${filters.scope??""}`} id="audit-scope" name="scope" required defaultValue={filters.scope??""} options={scopes} placeholder="Selecciona una liga" className="mt-1" /></div>
        <div className="min-w-0"><label htmlFor="audit-entity" className="text-sm font-medium">Entidad</label>
          <SelectField key={`entity:${filters.entity??""}`} id="audit-entity" name="entity" defaultValue={filters.entity??""} className="mt-1"
            options={[{value:"",label:"Todas"},...Object.entries(auditEntities).map(([value,label])=>({value,label}))]} /></div>
        <label className="min-w-0 text-sm font-medium">Usuario
          <input key={filters.actor??""} name="actor" type="text" autoComplete="off" maxLength={61} placeholder="@usuario" defaultValue={filters.actor??""} className={inputClass} /></label>
        <label className="min-w-0 text-sm font-medium">Desde
          <input key={filters.from??""} type="date" name="from" defaultValue={filters.from??""} className={inputClass} /></label>
        <label className="min-w-0 text-sm font-medium">Hasta
          <input key={filters.to??""} type="date" name="to" defaultValue={filters.to??""} className={inputClass} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold" type="submit">Filtrar operaciones</button>
        <Link href={auditHref({scope:filters.scope})} className="rounded text-sm underline underline-offset-4">Limpiar filtros</Link>
        {selected&&<p className="text-xs text-muted">Fechas y horarios de {selected.timezone}.</p>}
      </div>
    </form>
    {!selected ? <p role="status" className="rounded-2xl border border-border bg-surface p-6 text-sm">Selecciona un ámbito para consultar sus operaciones.</p>
      : <section aria-label="Operaciones registradas" className="overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="border-b border-border px-5 py-4"><h2 className="font-semibold">{selected.label}</h2><p className="mt-1 text-sm text-muted">De la más reciente a la más antigua. Abre una operación para ver su detalle.</p></div>
        {entries.length===0?<p role="status" className="p-6 text-sm text-muted">No hay operaciones visibles con estos filtros.</p>:<ul className="divide-y divide-border">
          {entries.map(item=><li key={item.id}><Link href={`/audit/${item.id}${query?`?${query}`:""}`} className="block space-y-2 px-5 py-4 transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-[-3px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-medium">{item.action} · {item.name}</p><time dateTime={item.at} className="text-xs text-muted">{date(item.at,item.timezone)}</time></div>
            <p className="text-sm text-muted">{item.actor} · {item.entity}</p>
            <p className="break-all text-xs text-muted">Registro: {item.reference}</p><p className="break-words text-sm">{item.reason}</p>
          </Link></li>)}
        </ul>}
      </section>}
    {selected&&(filters.after||next)&&<nav aria-label="Páginas de operaciones" className="flex flex-wrap justify-between gap-4 text-sm">
      {filters.after?<Link href={auditHref(filters,"")} className="rounded underline underline-offset-4">Volver a las más recientes</Link>:<span />}
      {next&&<Link href={auditHref(filters,next)} className="rounded underline underline-offset-4">Ver operaciones anteriores →</Link>}
    </nav>}
  </div>;
}

export function AuditDetailView({ entry, filters }: {entry:AuditDetail;filters:AuditFilters}) {
  const back=auditHref(filters);
  return <div className="mx-auto max-w-4xl space-y-6 px-5 py-8">
    <header className="space-y-2"><p className="text-sm text-muted">Administración · Bitácora</p><h1 className="text-3xl font-semibold">Detalle de la operación</h1><p className="text-sm text-muted">Revisa el cambio registrado sin modificar el historial.</p></header>
    <AuditJourney detail back={back} />
    <section className="space-y-6 rounded-2xl border border-border bg-surface p-5 sm:p-7" aria-label="Información de la operación">
      <div><h2 className="text-xl font-semibold">{entry.action} · {entry.name}</h2><p className="mt-1 text-sm text-muted">{entry.entity} · {entry.scope}</p></div>
      <dl className="grid gap-5 sm:grid-cols-2"><div><dt className="text-sm text-muted">Realizado por</dt><dd className="mt-1 font-medium">{entry.actor}</dd></div>
        <div><dt className="text-sm text-muted">Fecha y hora</dt><dd className="mt-1"><time dateTime={entry.at}>{date(entry.at,entry.timezone)}</time><span className="mt-1 block text-xs text-muted">{entry.timezone}</span></dd></div>
        <div className="sm:col-span-2"><dt className="text-sm text-muted">Registro afectado</dt><dd className="mt-1 break-all font-mono text-sm">{entry.reference}</dd></div>
        <div className="sm:col-span-2"><dt className="text-sm text-muted">Motivo</dt><dd className="mt-1 break-words">{entry.reason}</dd></div></dl>
      <div className="border-t border-border pt-5"><h3 className="font-semibold">Cambios registrados</h3>
        {entry.changes.length===0?<p className="mt-3 text-sm text-muted">Esta operación no contiene cambios de campos visibles para esta consulta.</p>:<dl className="mt-3 divide-y divide-border">
          {entry.changes.map(change=><div key={change.field} className="grid gap-2 py-4 sm:grid-cols-3"><dt className="text-sm font-medium">{change.field}</dt>
            <dd className="break-words text-sm"><span className="mb-1 block text-xs text-muted">Antes</span>{change.before}</dd>
            <dd className="break-words text-sm"><span className="mb-1 block text-xs text-muted">Después</span>{change.after}</dd></div>)}
        </dl>}
      </div>
    </section>
  </div>;
}
