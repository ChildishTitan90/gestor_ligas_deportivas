import type { TeamRegistrationItem, TeamRegistrationStatus } from "../team-registration-model";

const statusLabels = {
  REGISTERED: "Inscrito",
  ACTIVE: "Activo",
  WITHDRAWN: "Retirado",
} satisfies Record<TeamRegistrationStatus, string>;

/** Recibe solo datos de presentación. No consulta, autoriza ni cambia inscripciones. */
export function TeamRegistrationList({ items }: { items: readonly TeamRegistrationItem[] }) {
  if (items.length === 0) {
    return <div className="rounded-2xl border border-border bg-surface p-6">
      <p className="font-medium text-primary">No hay inscripciones de equipos para la consulta seleccionada.</p>
      <p className="mt-2 text-sm leading-6 text-muted">Aquí aparecerán los equipos inscritos en el ámbito consultado.</p>
    </div>;
  }

  return <ul aria-label="Inscripciones de equipos" className="space-y-4">
    {items.map(item => <li key={item.seasonTeamId} className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <h2 className="min-w-0 break-words text-lg font-semibold text-primary">{item.teamName}</h2>
        <p className="text-sm"><span className="text-muted">Estado: </span>
          <span className="inline-block rounded-lg bg-soft px-3 py-1 font-medium text-primary">{statusLabels[item.status]}</span>
        </p>
      </div>
      <dl className="mt-4 grid min-w-0 gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="min-w-0"><dt className="text-muted">Temporada</dt><dd className="mt-1 break-words">{item.seasonName}</dd></div>
        <div className="min-w-0"><dt className="text-muted">Categoría</dt><dd className="mt-1 break-words">{item.categoryName}</dd></div>
        <div className="min-w-0"><dt className="text-muted">Grupo</dt><dd className="mt-1 break-words">{item.groupName}</dd></div>
        <div className="min-w-0"><dt className="text-muted">Identificador del equipo</dt><dd className="mt-1 break-all">{item.teamId}</dd></div>
        <div className="min-w-0"><dt className="text-muted">Identificador de inscripción</dt><dd className="mt-1 break-all">{item.seasonTeamId}</dd></div>
      </dl>
    </li>)}
  </ul>;
}
