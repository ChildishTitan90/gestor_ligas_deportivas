import { redirect } from "next/navigation";
import { SelectField } from "@/components/ui/select-field";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { GovernanceForm } from "@/features/governance/components/governance-form";
import { bodyNames, periodFilters } from "@/features/governance/contract";
import { getGovernanceWorkspace } from "@/features/governance/server/service";

export const metadata = { title: "Órganos y cargos de la Liga" };

type Filters = { league?: string; body?: string; period?: string; person?: string; error?: string; saved?: string };
const title = "Órganos y cargos de la Liga";
const field = "block min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2";
const panel = "space-y-4 rounded-2xl border border-border bg-surface p-5";
const periodLabels = { all: "Todos los periodos", current: "Vigentes", past: "Finalizados", future: "Futuros" };
const errorMessages: Record<string, string> = {
  INVALID: "Revisa los campos obligatorios, el motivo y el orden de las fechas.",
  INVALID_END: "La fecha final debe corresponder al periodo y no puede ampliar una vigencia registrada.",
  STALE: "El nombramiento cambió mientras lo consultabas. Revisa la vigencia antes de volver a guardar.",
  FORBIDDEN: "Tu cuenta no tiene permiso para ese recurso de la liga.",
  DUPLICATE: "El órgano ya tiene un cargo con ese nombre.",
  UNAVAILABLE: "No se pudo confirmar el cambio. Revisa el historial antes de volver a intentarlo.",
};
const dateString = (value: Date | null) => value?.toISOString().slice(0, 10) ?? "";
const fullName = (person: { first_name: string; paternal_surname: string; maternal_surname: string | null }) =>
  [person.first_name, person.paternal_surname, person.maternal_surname].filter(Boolean).join(" ");

export default async function GovernancePage({ searchParams }: { searchParams: Promise<Filters> }) {
  const filters = await searchParams;
  let data: Awaited<ReturnType<typeof getGovernanceWorkspace>>;
  try {
    data = await getGovernanceWorkspace(filters);
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    return <div className="mx-auto max-w-5xl space-y-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p role="alert">{error instanceof AuthorizationError ? "No tienes acceso a los órganos de esta liga." : "No se pudo consultar la composición. Intenta nuevamente."}</p>
    </div>;
  }

  const { league, canEdit, body, positions, people, today, query } = data;
  const bodyOptions = data.bodies.map(item => ({ value: item.id, label: item.name }));
  const visibleBodies = body ? [body] : data.bodies;
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
    <h1 className="text-2xl font-semibold">{title}</h1>
    {filters.error && <p role="alert">{errorMessages[filters.error] ?? errorMessages.UNAVAILABLE}</p>}
    {filters.saved === "1" && <p role="status">Cambio registrado en el historial de la liga.</p>}

    <form action="/governance" className={`${panel} space-y-3`}>
      <div className="grid gap-3 sm:grid-cols-3">
        <label>Liga<SelectField key={league.id} name="league" aria-label="Liga" defaultValue={league.id}
          options={data.leagues.map(item => ({ value: item.id, label: item.name }))} /></label>
        <label>Órgano<SelectField key={`${league.id}-${body?.id}`} name="body" aria-label="Órgano" defaultValue={body?.id ?? "all"}
          options={[{ value: "all", label: "Todos los órganos" }, ...bodyOptions]} /></label>
        <label>Vigencia<SelectField key={data.period} name="period" aria-label="Vigencia" defaultValue={data.period}
          options={periodFilters.map(value => ({ value, label: periodLabels[value] }))} /></label>
      </div>
      <button type="submit" className="min-h-11 rounded-xl border border-border px-4 py-2 font-semibold">Filtrar composición</button>
    </form>

    {canEdit && <section aria-label="Administrar composición" className={panel}>
      {!bodyNames.every(name => data.bodies.some(item => item.name === name)) && <GovernanceForm title="Registrar órganos de la Liga"
        description="Registra la Asamblea General, el Consejo Directivo y el Comité Ejecutivo que falten."
        submit="Registrar órganos" operation="initialize" leagueId={league.id} />}
      {!!data.bodies.length && <GovernanceForm title="Registrar cargo"
        description="Usa el nombre acordado por la Liga. El rol es una referencia y el cargo no modifica los permisos."
        submit="Guardar cargo" operation="position" leagueId={league.id}>
        <label>Órgano<SelectField name="bodyId" aria-label="Órgano del cargo" required defaultValue={body?.id} options={bodyOptions} /></label>
        <label>Nombre del cargo<input name="name" required maxLength={120} className={field} /></label>
        <label>Rol asociado (opcional)<SelectField name="roleId" aria-label="Rol asociado (opcional)" defaultValue=""
          options={[{ value: "", label: "Sin rol" }, ...data.roles.map(role => ({ value: role.id, label: role.name }))]} /></label>
      </GovernanceForm>}
      {!!positions.length && <>
        <form action="/governance" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="league" value={league.id} />
          <input type="hidden" name="body" value={body?.id ?? "all"} />
          <input type="hidden" name="period" value={data.period} />
          <label className="min-w-48 flex-1">Buscar persona de la liga
            <input key={query} name="person" type="search" required minLength={2} maxLength={100} defaultValue={query} className={field} />
          </label>
          <button type="submit" className="min-h-11 rounded-xl border border-border px-4 py-2 font-semibold">Buscar</button>
        </form>
        {query.length >= 2 && !people.length && <p role="status">No se encontraron personas con vínculo registrado en la liga.</p>}
        {people.length > 30 && <p role="status">Se muestran 30 coincidencias. Agrega un apellido para acotar la búsqueda.</p>}
        {!!people.length && <GovernanceForm title="Registrar nombramiento" description="Selecciona una persona existente y registra su periodo."
          submit="Guardar nombramiento" operation="appoint" leagueId={league.id}>
          <label>Cargo<SelectField name="positionId" aria-label="Cargo" required options={positions.map(item => ({
            value: item.id, label: `${item.name} · ${data.bodies.find(group => group.id === item.governing_body_id)?.name}`,
          }))} /></label>
          <label>Persona<SelectField name="personId" aria-label="Persona" required
            options={people.slice(0, 30).map(person => ({ value: person.id, label: fullName(person) }))} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label>Inicio de vigencia<input name="startsAt" type="date" required className={field} /></label>
            <label>Fin de vigencia (opcional)<input name="endsAt" type="date" className={field} /></label>
          </div>
        </GovernanceForm>}
      </>}
    </section>}

    {!visibleBodies.length && <p>Esta liga todavía no tiene órganos registrados.</p>}
    {visibleBodies.map(group => {
      const groupPositions = positions.filter(item => item.governing_body_id === group.id);
      return <section key={group.id} className={panel}>
        <h2 className="text-xl font-semibold">{group.name}</h2>
        {!groupPositions.length && <p>Sin cargos registrados.</p>}
        {groupPositions.map(position => <article key={position.id} className="space-y-3 rounded-xl border border-border p-4">
          <h3 className="font-semibold">{position.name}</h3>
          {position.roles && <p>Rol asociado: {position.roles.name}</p>}
          {!position.appointments.length && <p>Sin nombramientos para esta vigencia.</p>}
          <ul className="space-y-3">
            {position.appointments.map(appointment => {
              const start = dateString(appointment.starts_at);
              const end = dateString(appointment.ends_at);
              return <li key={appointment.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div><p className="font-semibold">{fullName(appointment.people)}</p><p>{start} · {end || "Sin fecha final"}</p></div>
                {canEdit && (!end || end >= today) && <GovernanceForm title="Finalizar nombramiento"
                  description={`Se conserva el historial de ${fullName(appointment.people)} en el cargo.`}
                  submit="Guardar fecha final" operation="finish" leagueId={league.id}>
                  <input type="hidden" name="appointmentId" value={appointment.id} />
                  <input type="hidden" name="expectedEnd" value={end} />
                  <label>Último día de vigencia<input name="endsAt" type="date" required min={start} defaultValue={start <= today ? today : start}
                    max={end || undefined} className={field} /></label>
                </GovernanceForm>}
              </li>;
            })}
          </ul>
        </article>)}
      </section>;
    })}
  </div>;
}
