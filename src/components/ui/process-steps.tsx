import { Check } from "lucide-react";

export function ProcessSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return <ol aria-label="Etapas de captura" className="grid gap-2 border-b border-border pb-4 sm:grid-cols-3">
    {steps.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined}
      className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm ${index === current ? "bg-soft font-semibold text-primary" : "text-muted"}`}>
      <span aria-hidden="true" className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${index === current ? "border-accent bg-surface text-primary" : "border-border"}`}>
        {index < current ? <Check size={15} /> : index + 1}
      </span>
      <span>{index < current && <span className="sr-only">Etapa completada. </span>}{label}</span>
    </li>)}
  </ol>;
}
