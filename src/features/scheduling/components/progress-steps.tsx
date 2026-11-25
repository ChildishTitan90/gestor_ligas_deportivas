import { ProcessSteps } from "@/components/ui/process-steps";

type Step = { label: string; detail: string };

/** El estado procede de la pantalla o de la propuesta, no de visitas anteriores. */
export function ProgressSteps({ label, steps, current }: { label: string; steps: Step[]; current: number }) {
  return <section aria-label={label} className="space-y-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
    <p className="text-sm font-semibold text-primary">{label}</p>
    <ProcessSteps label="Etapas" steps={steps.map(step => step.label)} current={current} />
    <p className="text-sm leading-6 text-muted">{(steps[current] ?? steps.at(-1))?.detail}</p>
  </section>;
}
