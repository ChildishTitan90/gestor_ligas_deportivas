import type { AccessOverviewScope } from "../server/access-overview";

export function AccessOverview({ scopes }: { scopes: AccessOverviewScope[] }) {
  if (!scopes.length) {
    return (
      <section aria-labelledby="permissions-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
        <h2 id="permissions-title" className="text-xl font-semibold text-primary">Tus funciones</h2>
        <p className="mt-4 text-sm leading-7 text-muted">Tu cuenta todavía no tiene funciones habilitadas. Si necesitas acceso a la gestión, comunícate con la administración de la liga.</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="permissions-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
      <h2 id="permissions-title" className="text-xl font-semibold text-primary">Tus funciones</h2>
      <p className="mt-3 max-w-2xl text-sm leading-7 text-muted">Estos son tus permisos vigentes. Las herramientas de gestión se incorporarán a este panel conforme estén disponibles.</p>
      <div className="mt-6 space-y-8">
        {scopes.map((scope, index) => (
          <section key={`${scope.title}-${scope.description}`} aria-labelledby={`scope-${index}-title`} className="border-t border-border pt-6">
            <h3 id={`scope-${index}-title`} className="font-semibold text-primary">{scope.title}</h3>
            <p className="mt-1 text-sm leading-6 text-muted">{scope.description}</p>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2">
              {scope.modules.map((module) => (
                <li key={module.name} className="rounded-2xl border border-border p-4">
                  <h4 className="text-sm font-semibold">{module.name}</h4>
                  <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Permisos de ${module.name}`}>
                    {module.actions.map((action) => (
                      <li key={action.label} className="rounded-lg bg-soft px-3 py-1 text-xs leading-6 text-primary">
                        {action.label}{action.contextOnly ? " · restringido" : ""}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-6 border-t border-border pt-5 text-xs leading-6 text-muted">Los permisos restringidos se limitan a la información o asignación que te corresponda. Cada operación conserva las reglas de la liga.</p>
    </section>
  );
}
