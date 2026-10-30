import { SelectField } from "@/components/ui/select-field";
import type { DelegateAssignmentOptions } from "../types";

export function DelegatePositionSelect({ id, value, onChange, options, status, error, className }: {
  id: string; value: string; onChange: (value: string) => void; options: DelegateAssignmentOptions | null;
  status: "idle" | "loading" | "ready" | "error"; error?: string; className: string;
}) {
  return <div>
    <label htmlFor={id} className="text-sm font-medium">Cargo en el club *</label>
    <SelectField id={id} name="delegatePosition" value={value} required className={className}
      searchable={false} placeholder="Selecciona un cargo" disabled={status !== "ready"} aria-invalid={Boolean(error)}
      aria-describedby={`${id}-status${error ? ` ${id}-error` : ""}`} onValueChange={onChange}
      options={options?.positions.map(position => ({ value: position.value, label: position.label,
        disabled: !position.available,
        description: position.reason === "LEGACY" ? "Pendiente de regularización" : position.reason === "OCCUPIED" ? "Ocupado en este periodo" : undefined,
      })) ?? []} />
    <p id={`${id}-status`} role="status" className="mt-2 text-sm text-muted">
      {status === "loading" ? "Consultando cargos disponibles…" : status === "error" ? "No se pudo consultar la disponibilidad. Reintenta antes de crear la cuenta." :
        status === "idle" ? "Selecciona un club y una vigencia válida para consultar los cargos." :
        options?.positions.some(position => position.reason === "LEGACY") ? "Hay una asignación con cargo no identificado en este periodo. Se necesita regularización." :
        options?.positions.every(position => !position.available) ? "No hay cargos disponibles en el periodo seleccionado." : "La disponibilidad se confirma al crear la cuenta. No se asigna un cargo automáticamente."}
    </p>
    {error && <p id={`${id}-error`} className="mt-2 text-sm text-danger">{error}</p>}
  </div>;
}
