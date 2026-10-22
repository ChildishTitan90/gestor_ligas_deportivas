import { ArrowRight, CalendarDays, ClipboardList, Trophy } from "lucide-react";
import { ActionLink } from "@/components/ui/action-link";

const sections = [
  { id: "scheduled-matches", title: "Partidos programados", Icon: CalendarDays,
    empty: "Todavía no hay partidos publicados.", detail: "Aquí podrás consultar las fechas, los horarios y las canchas que publique la liga." },
  { id: "match-results", title: "Resultados", Icon: ClipboardList,
    empty: "Todavía no hay resultados publicados.", detail: "Los marcadores estarán disponibles cuando la liga confirme su publicación." },
  { id: "standings", title: "Tabla de posiciones", Icon: Trophy,
    empty: "Todavía no hay una tabla de posiciones publicada.", detail: "La clasificación aparecerá cuando la liga publique la tabla oficial." },
];

/** Sin consultas privadas ni datos de ejemplo mientras no exista un contrato de publicación. */
export function FootballPortal({ showSignIn }: { showSignIn: boolean }) {
  return (
    <>
      <div className="max-w-2xl">
        <p className="mb-5 flex items-center gap-3 text-xs font-semibold tracking-[0.15em] text-primary uppercase">
          <span className="h-px w-8 bg-accent" aria-hidden="true" />Portal público · Fútbol
        </p>
        <h1 className="text-4xl leading-tight font-semibold tracking-tight text-primary sm:text-5xl">Nuestra liga, más cerca</h1>
        <p className="mt-5 text-base leading-7 text-muted">Sigue el fútbol de la Liga Municipal de Morelia. Puedes consultar la información publicada sin iniciar sesión.</p>
      </div>

      <div className="mt-9 grid gap-5 lg:mt-12 lg:grid-cols-3">
        {sections.map(({ id, title, Icon, empty, detail }) => (
          <section key={id} aria-labelledby={`${id}-title`} className="rounded-3xl border border-border bg-surface p-6 sm:p-7">
            <span className="mb-5 flex size-12 items-center justify-center rounded-2xl bg-soft text-primary"><Icon size={24} aria-hidden="true" /></span>
            <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight text-primary">{title}</h2>
            <div className="mt-5 border-t border-border pt-5">
              <p className="text-sm font-medium leading-7">{empty}</p>
              <p className="mt-2 text-sm leading-7 text-muted">{detail}</p>
            </div>
          </section>
        ))}
      </div>

      {showSignIn && <aside aria-labelledby="participation-title" className="mt-8 flex flex-col items-start gap-5 rounded-3xl border border-border px-6 py-7 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <div>
          <h2 id="participation-title" className="text-lg font-semibold text-primary">¿Formas parte de la liga?</h2>
          <p className="mt-2 max-w-xl text-sm leading-7 text-muted">Inicia sesión para consultar las funciones autorizadas para tu cuenta.</p>
        </div>
        <ActionLink href="/login" variant="secondary" className="shrink-0">Iniciar sesión<ArrowRight size={16} aria-hidden="true" /></ActionLink>
      </aside>}
    </>
  );
}
