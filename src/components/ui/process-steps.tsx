import { Check } from "lucide-react";
import { useId } from "react";

export function ProcessSteps({ steps, current, label = "Etapas de captura", completedSteps, onStepChange }: {
  steps: readonly string[];
  current: number;
  label?: string;
  completedSteps?: readonly boolean[];
  onStepChange?: (index: number) => void;
}) {
  const completionId = useId();
  return <ol aria-label={label} role="list" className={`grid grid-flow-col auto-cols-fr ${onStepChange ? "" : "border-b border-border pb-4"}`}>
    {steps.map((step, index) => {
      const completed = completedSteps?.[index] ?? index < current;
      const active = index === current;
      const indicator = <>
        <span aria-hidden="true" className={`relative mx-auto flex size-8 items-center justify-center rounded-full border text-xs font-semibold ${active ? "primary-action border-transparent" : completed ? "border-accent bg-surface text-primary" : "border-border bg-surface text-muted"}`}>
          {completed ? <Check size={16} /> : index + 1}
        </span>
        <span className={`mt-2 block leading-tight wrap-anywhere ${onStepChange ? "text-[10px] min-[375px]:text-[11px]" : "px-1 text-xs"} sm:text-sm ${active ? "font-semibold text-primary" : "text-muted"}`}>
          {completed && !onStepChange && <span className="sr-only">Etapa completada. </span>}{step}
        </span>
      </>;
      return <li key={step} aria-current={active && !onStepChange ? "step" : undefined} className="relative min-w-0 text-center">
        {index < steps.length - 1 && <span aria-hidden="true"
          className={`pointer-events-none absolute start-1/2 h-0.5 w-full ${onStepChange ? "top-5" : "top-4"} ${completed ? "bg-accent" : "bg-border"}`} />}
        {onStepChange ? <button type="button" aria-label={step} aria-current={active ? "step" : undefined}
          aria-describedby={completed ? `${completionId}-${index}` : undefined}
          className="relative flex h-full min-h-12 w-full flex-col items-stretch rounded-lg pt-1 pb-2 hover:underline"
          onClick={() => onStepChange(index)}>
          {indicator}{completed && <span id={`${completionId}-${index}`} hidden>Etapa completada</span>}
        </button> : indicator}
      </li>;
    })}
  </ol>;
}
