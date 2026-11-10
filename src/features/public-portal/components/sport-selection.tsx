import Link from "next/link";
import { ArrowRight, CircleDot, Volleyball, SportShoe } from "lucide-react";

const upcomingSports = [
  { name: "Básquetbol", id: "basketball-title", Icon: CircleDot },
  { name: "Voleibol", id: "volleyball-title", Icon: Volleyball },
];

export function SportSelection() {
  return (
    <>
      <div className="max-w-2xl">
        <p className="mb-5 flex items-center gap-3 text-xs font-semibold tracking-[0.15em] text-primary uppercase">
          <span className="h-px w-8 bg-accent" aria-hidden="true" />El deporte nos reúne
        </p>
        <h1 className="text-4xl leading-tight font-semibold tracking-tight text-primary sm:text-5xl">Elige tu deporte</h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-muted">
          Selecciona el deporte que te interesa. La Liga Municipal de Fútbol de Morelia está disponible; los demás deportes están en desarrollo.
        </p>
      </div>

      <div className="mt-9 grid gap-5 md:mt-12 md:grid-cols-3">
        <Link href="/futbol" aria-labelledby="football-title football-action" className="group flex flex-col overflow-hidden rounded-3xl border border-primary bg-surface shadow-sm transition-colors hover:border-primary-hover">
          <div className="h-1 bg-accent" aria-hidden="true" />
          <div className="flex flex-1 flex-col p-6 sm:p-7">
            <div className="flex items-start justify-between gap-3">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-soft text-primary"><SportShoe size={30} aria-hidden="true" /></span>
              <span className="rounded-full bg-soft px-3 py-1 text-xs font-semibold leading-6 text-primary">Disponible</span>
            </div>
            <h2 id="football-title" className="mt-6 text-2xl font-semibold tracking-tight text-primary">Fútbol</h2>
            <p className="mt-3 text-sm leading-7 text-muted">Accede a tu cuenta de la liga o continúa como espectador desde la pantalla de acceso.</p>
            <span id="football-action" className="mt-8 inline-flex min-h-12 items-center justify-between gap-3 rounded-xl primary-action px-4 py-3 text-sm font-semibold">
              Entrar a fútbol<ArrowRight size={18} aria-hidden="true" />
            </span>
          </div>
        </Link>
        {upcomingSports.map(({ name, id, Icon }) => (
          <details key={id} className="rounded-3xl border border-border bg-surface">
            <summary aria-labelledby={`${id} ${id}-availability`} className="cursor-pointer list-none rounded-3xl p-6 sm:p-7 [&::-webkit-details-marker]:hidden">
              <span className="flex items-start justify-between gap-3">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-background text-muted"><Icon size={30} aria-hidden="true" /></span>
                <span id={`${id}-availability`} className="rounded-full border border-border px-3 py-1 text-xs font-medium leading-6 text-muted">Próximamente</span>
              </span>
              <span id={id} role="heading" aria-level={2} className="mt-6 block text-2xl font-semibold tracking-tight">{name}</span>
              <span className="mt-3 block text-sm leading-7 text-muted">Este deporte todavía no está disponible en el sistema.</span>
              <span className="mt-5 block text-sm font-semibold text-primary underline underline-offset-4">Consultar disponibilidad</span>
            </summary>
            <p className="mx-6 mb-6 border-t border-border pt-4 text-sm leading-7 text-muted sm:mx-7 sm:mb-7">
              {name} está en desarrollo. Por ahora puedes acceder a la liga de fútbol.
            </p>
          </details>
        ))}
      </div>
    </>
  );
}
