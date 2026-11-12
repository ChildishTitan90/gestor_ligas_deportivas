import Link from "next/link";
import { redirect } from "next/navigation";
import { SelectField } from "@/components/ui/select-field";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { removeIntervalAction, saveIntervalAction, saveVenueAction } from "@/features/venues/actions";
import { SubmitButton } from "@/features/venues/components/submit-button";
import { intervalLabels, intervalTypes } from "@/features/venues/schemas";
import { getVenueWorkspace } from "@/features/venues/server/service";
import { venueLocalTime } from "@/features/venues/time";

export const metadata = { title: "Canchas y disponibilidad" };

type Workspace = Awaited<ReturnType<typeof getVenueWorkspace>>;
type Venue = NonNullable<Workspace["venue"]>;
type Interval = Venue["venue_availability"][number];
const control = "min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2";
const card = "space-y-4 rounded-2xl border border-border bg-surface p-5";
const errorMessages: Record<string, string> = {
  INVALID_VENUE: "Revisa el código, nombre, domicilio, duración y holgura.",
  INVALID_INTERVAL: "Revisa las fechas en la zona de la liga. La hora debe existir y ser inequívoca, el fin debe ser posterior al inicio y los bloqueos requieren un motivo.",
  DUPLICATE_CODE: "Ya existe una cancha con ese código en la liga.",
  INTERVAL_CONFLICT: "El intervalo se traslapa con otra disponibilidad o con otro bloqueo del mismo grupo.",
  FORBIDDEN: "No tienes permiso para realizar esta acción en esa liga.",
  RETRY: "Hubo otro cambio al mismo tiempo. Revisa los datos y vuelve a intentarlo.",
  UNAVAILABLE: "No se pudo confirmar el cambio. Revisa los datos antes de volver a intentarlo.",
};

function VenueForm({ leagueId, venue }: { leagueId: string; venue?: Venue }) {
  const features = venue?.features;
  const description = features && typeof features === "object" && !Array.isArray(features)
    && typeof features.description === "string" ? features.description : "";
  return <form action={saveVenueAction} className="space-y-4">
    <input name="leagueId" type="hidden" value={leagueId} />
    <input name="venueId" type="hidden" value={venue?.id ?? ""} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Código<input name="code" className={control} required maxLength={40} defaultValue={venue?.code} /></label>
      <label>Nombre<input name="name" className={control} required maxLength={160} defaultValue={venue?.name} /></label>
      <label>Domicilio<input name="address" className={control} required maxLength={300} defaultValue={venue?.address} /></label>
      <label>Tipo<SelectField name="kind" defaultValue={venue?.is_league_sports_complex ? "complex" : "private"}
        options={[{ value: "private", label: "Particular" }, { value: "complex", label: "Unidad deportiva" }]} /></label>
      <label>Duración del partido (min)<input name="duration" type="number" className={control} required min={1} max={1440} defaultValue={venue?.match_duration_minutes ?? 90} /></label>
      <label>Holgura después del partido (min)<input name="buffer" type="number" className={control} required min={0} max={1440} defaultValue={venue?.buffer_minutes ?? 0} /></label>
    </div>
    <label className="block">Características<textarea name="features" className={control} maxLength={1000} defaultValue={description} /></label>
    <SubmitButton>{venue ? "Guardar cancha" : "Registrar cancha"}</SubmitButton>
  </form>;
}

function IntervalForm({ league, venueId, interval }: { league: Workspace["league"]; venueId: string; interval?: Interval }) {
  return <form action={saveIntervalAction} className="space-y-3">
    <input name="leagueId" type="hidden" value={league.id} />
    <input name="venueId" type="hidden" value={venueId} />
    <input name="intervalId" type="hidden" value={interval?.id ?? ""} />
    <div className="grid gap-3 sm:grid-cols-2">
      <label>Tipo<SelectField name="type" defaultValue={interval?.type ?? "AVAILABLE"}
        options={intervalTypes.map(value => ({ value, label: intervalLabels[value] }))} /></label>
      <label>Inicio<input name="start" className={control} type="datetime-local" step="1" required
        defaultValue={interval && venueLocalTime(interval.starts_at, league.timezone)} /></label>
      <label>Fin<input name="end" className={control} type="datetime-local" step="1" required
        defaultValue={interval && venueLocalTime(interval.ends_at, league.timezone)} /></label>
      <label>Motivo (obligatorio para bloqueos y mantenimiento)<input name="reason" className={control}
        maxLength={300} defaultValue={interval?.reason ?? ""} /></label>
    </div>
    <SubmitButton>{interval ? "Guardar intervalo" : "Agregar intervalo"}</SubmitButton>
  </form>;
}

export default async function VenuesPage({ searchParams }: {
  searchParams: Promise<{ league?: string; venue?: string; error?: string; saved?: string }>;
}) {
  const params = await searchParams;
  let data: Workspace;
  try {
    data = await getVenueWorkspace(params.league, params.venue);
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    return <div className="mx-auto max-w-5xl space-y-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">Canchas y disponibilidad</h1>
      <p role="alert">{error instanceof AuthorizationError ? "No tienes permiso para consultar esta liga." : "No se pudieron cargar las canchas. Intenta nuevamente."}</p>
    </div>;
  }
  const { league, venue } = data;
  const date = new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: league.timezone });
  const status = ({ venue: "Cancha guardada.", interval: "Intervalo guardado.", removed: "Intervalo retirado." } as Record<string, string>)[params.saved ?? ""];
  return <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
    <h1 className="text-2xl font-semibold">Canchas y disponibilidad</h1>
    {params.error && <p role="alert">{errorMessages[params.error] ?? errorMessages.UNAVAILABLE}</p>}
    {status && <p role="status">{status}</p>}
    <form className="flex flex-wrap items-end gap-3" action="/venues">
      <label className="min-w-48">Liga<SelectField name="league" defaultValue={league.id}
        options={data.leagues.map(item => ({ value: item.id, label: item.name }))} /></label>
      <button type="submit" className="min-h-11 rounded-xl border border-border px-4">Ver canchas</button>
    </form>

    {data.canCreate && <details className={card}>
      <summary className="cursor-pointer font-semibold">Registrar cancha</summary>
      <VenueForm leagueId={league.id} />
    </details>}

    <section className={card}>
      <h2 className="text-xl font-semibold">Catálogo de canchas</h2>
      {data.venues.length ? <ul className="grid gap-2 sm:grid-cols-2">
        {data.venues.map(item => <li key={item.id}>
          <Link href={`/venues?league=${league.id}&venue=${item.id}`} aria-current={item.id === venue?.id ? "page" : undefined}
            className="block rounded-xl border border-border px-3 py-2 underline">
            {item.name} · {item.code}{item.is_active ? "" : " · Inactiva"}
          </Link>
        </li>)}
      </ul> : <p>Esta liga todavía no tiene canchas registradas.</p>}
    </section>

    {venue && <section className={card}>
      <h2 className="text-xl font-semibold">{venue.name}</h2>
      <p>{venue.address} · {venue.is_league_sports_complex ? "Unidad deportiva" : "Particular"}</p>
      <p>{venue.match_duration_minutes} min de juego · {venue.buffer_minutes} min de holgura</p>
      {venue.features && typeof venue.features === "object" && !Array.isArray(venue.features)
        && typeof venue.features.description === "string" && <p>{venue.features.description}</p>}
      {data.canUpdate && <details>
        <summary className="mb-3 cursor-pointer font-semibold">Editar cancha</summary>
        <VenueForm venue={venue} leagueId={league.id} />
      </details>}

      <h3 className="text-lg font-semibold">Disponibilidad y bloqueos</h3>
      <p>Zona horaria de la liga: {league.timezone}</p>
      {data.canUpdate && <details open={!venue.venue_availability.length}>
        <summary className="mb-3 cursor-pointer font-semibold">Agregar disponibilidad o bloqueo</summary>
        <IntervalForm league={league} venueId={venue.id} />
      </details>}

      {data.conflicts.length > 0 && <p role="alert">Hay partidos afectados. Reprográmalos o ajusta el bloqueo. Los partidos siguen registrados.</p>}
      {!venue.venue_availability.length && <p>La cancha aún no tiene intervalos registrados.</p>}
      <ul className="space-y-3">
        {venue.venue_availability.map(interval => {
          const conflicts = data.conflicts.filter(conflict => conflict.intervalId === interval.id);
          return <li key={interval.id} className="space-y-2 rounded-xl border border-border p-4">
            <h4 className="font-semibold">{intervalLabels[interval.type as keyof typeof intervalLabels]}</h4>
            <p>{date.format(interval.starts_at)} – {date.format(interval.ends_at)}</p>
            {interval.reason && <p>{interval.reason}</p>}
            {conflicts.length > 0 && <ul className="list-inside list-disc">
              {conflicts.map(conflict => <li key={conflict.matchId}>Partido {conflict.number} · {date.format(conflict.startsAt)}</li>)}
            </ul>}
            {data.canUpdate && <details>
              <summary className="mb-3 cursor-pointer">Editar o retirar intervalo</summary>
              <IntervalForm league={league} venueId={venue.id} interval={interval} />
              <form action={removeIntervalAction} className="mt-2">
                <input name="leagueId" type="hidden" value={league.id} />
                <input name="venueId" type="hidden" value={venue.id} />
                <input name="intervalId" type="hidden" value={interval.id} />
                <SubmitButton secondary>Retirar intervalo</SubmitButton>
              </form>
            </details>}
          </li>;
        })}
      </ul>
    </section>}
  </div>;
}
