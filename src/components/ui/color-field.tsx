"use client";

/** Selector nativo de color; los contratos de RGB y su persistencia pertenecen
 * al formulario consumidor. Conserva etiqueta, foco y objetivo táctil de 48 px. */
export function ColorField({ id, label, value, description, disabled, onValueChange }: { id: string; label: string; value: string; description?: string; disabled?: boolean; onValueChange: (hex: string) => void }) {
  return <label htmlFor={id} className="block text-sm font-medium">{label}<span className="mt-2 flex min-h-12 items-center gap-2 rounded-xl border border-border bg-surface p-2"><input id={id} type="color" value={value} disabled={disabled} aria-describedby={description ? `${id}-description` : undefined} onChange={event => onValueChange(event.target.value)} className="size-12 shrink-0 cursor-pointer rounded border border-border bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50" />{description && <span id={`${id}-description`} className="break-all text-xs text-muted">{description}</span>}</span></label>;
}
