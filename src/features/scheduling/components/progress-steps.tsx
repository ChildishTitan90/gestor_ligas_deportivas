type Step = { label: string; detail: string };

/** El estado procede de la pantalla o de la propuesta, no de visitas anteriores. */
export function ProgressSteps({ label, steps, current }: { label: string; steps: Step[]; current: number }) {
  return <nav aria-label={label} className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
    <p className="text-sm font-semibold text-primary">{label}</p>
    <ol className="mt-4 grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => {
        const state = index < current ? "Completado" : index === current ? "Actual" : "Pendiente";
        return <li key={step.label} aria-current={index === current ? "step" : undefined}
          className={`flex min-w-0 items-start gap-3 rounded-xl border px-3 py-3 ${index === current ? "border-accent bg-background" : "border-border"}`}>
          <span aria-hidden="true" className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${index < current ? "bg-[var(--positive-surface)] text-[var(--positive)]" : index === current ? "bg-[var(--action)] text-[var(--on-action)]" : "border border-border text-muted"}`}>{index < current ? "✓" : index + 1}</span>
          <span className="min-w-0"><span className="block text-xs font-semibold">{state}</span><span className="block font-semibold">{step.label}</span><span className="mt-1 block text-xs text-muted">{step.detail}</span></span>
        </li>;
      })}
    </ol>
  </nav>;
}
