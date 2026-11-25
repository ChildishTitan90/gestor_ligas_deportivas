import type { ChangeEvent, FormEvent, ReactNode, RefObject } from "react";
import { SelectField } from "@/components/ui/select-field";
import type { DemoSeason } from "../demo-data";
import { recipientContext } from "../presentation";
import { chargeConceptLabels } from "../schemas";
import type { ChargeCapture } from "../schemas";
import { WeeklyConditions } from "./charge-details";

export type CaptureField = keyof ChargeCapture;
export type ChargeDraft = Record<CaptureField, string>;
export type CaptureErrors = Partial<Record<CaptureField, string>>;
const controlClass = "min-h-12 w-full min-w-0 rounded-xl border border-border bg-surface px-3 py-2.5 text-sm text-primary aria-invalid:border-danger";

export function ChargeCaptureFields({ formRef, seasons, draft, errors, onChange, onReview }: {
  formRef: RefObject<HTMLFormElement | null>;
  seasons: readonly DemoSeason[];
  draft: ChargeDraft;
  errors: CaptureErrors;
  onChange: (field: CaptureField, value: string) => void;
  onReview: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const season = seasons.find(option => option.id === draft.seasonId);
  const recipients = season?.recipients.filter(option => option.kind === draft.recipientKind) ?? [];
  const weekly = draft.frequency === "WEEKLY";
  const fixed = (name: CaptureField) => ({
    id: `charge-${name}`,
    name,
    required: true,
    value: draft[name],
    "aria-invalid": errors[name] ? true as const : undefined,
    "aria-describedby": errors[name] ? `charge-${name}-error` : undefined,
  });
  const set = (name: CaptureField) => (value: string) => onChange(name, value);
  const change = (name: CaptureField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(name, event.target.value);

  return <form ref={formRef} noValidate onSubmit={onReview} autoComplete="off" className="rounded-2xl border border-border bg-surface"
    aria-label="Captura de cargo">
    <div className="space-y-6 p-5 sm:p-6">
      {Object.values(errors).some(Boolean) && <p role="alert" className="rounded-xl bg-danger-surface px-4 py-3 text-sm font-medium text-danger">Revisa los campos marcados antes de continuar.</p>}
      <fieldset className="min-w-0 space-y-3">
        <legend className="mb-2 text-lg font-semibold text-primary">Destinatario</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="seasonId" label="Temporada" errors={errors}>
            <SelectField {...fixed("seasonId")} searchable={false} onValueChange={set("seasonId")}
              options={seasons.map(option => ({ value: option.id, label: option.name }))} />
          </Field>
          <Field name="recipientKind" label="Tipo de destinatario" errors={errors}>
            <SelectField {...fixed("recipientKind")} searchable={false} onValueChange={set("recipientKind")}
              options={[{ value: "CLUB", label: "Club" }, { value: "TEAM", label: "Equipo" }]} />
          </Field>
          <div className="sm:col-span-2">
            <Field name="recipientId" label={draft.recipientKind === "TEAM" ? "Equipo de la temporada" : draft.recipientKind === "CLUB" ? "Club afiliado" : "Club o equipo"} errors={errors}>
              <SelectField {...fixed("recipientId")} onValueChange={set("recipientId")} disabled={!season || !draft.recipientKind}
                placeholder={!season || !draft.recipientKind ? "Selecciona temporada y tipo" : "Selecciona un destinatario"}
                options={recipients.map(option => ({ value: option.id, label: option.name, description: recipientContext(option) }))}
                descriptionPosition="below" />
            </Field>
          </div>
        </div>
      </fieldset>
      <fieldset className="min-w-0 border-t border-border pt-5">
        <legend className="float-left w-full pb-3 text-lg font-semibold text-primary">Concepto, importe y periodo</legend>
        <div className="clear-both grid gap-4 sm:grid-cols-2">
          <Field name="concept" label="Concepto" errors={errors}>
            <SelectField {...fixed("concept")} searchable={false} onValueChange={set("concept")}
              options={Object.entries(chargeConceptLabels).map(([value, label]) => ({ value, label }))} />
          </Field>
          <Field name="frequency" label="Modalidad" errors={errors}>
            <SelectField {...fixed("frequency")} searchable={false} onValueChange={set("frequency")}
              options={[{ value: "ONCE", label: "Único" }, { value: "WEEKLY", label: "Semanal" }]} />
          </Field>
          {draft.concept === "FINE" && <p role="status" className="rounded-xl border border-border bg-soft px-4 py-3 text-sm text-primary sm:col-span-2">La multa requiere una resolución oficial. El vínculo con PDGLD-27 está pendiente y este concepto queda bloqueado.</p>}
          <Field name="amount" label={weekly ? "Importe por semana (MXN de ejemplo)" : "Importe (MXN de ejemplo)"} errors={errors}>
            <input {...fixed("amount")} type="text" inputMode="decimal" spellCheck={false} placeholder="Ej. 175.50…" className={controlClass} onChange={change("amount")} />
          </Field>
          <Field name="dueOn" label={weekly ? "Vencimiento de referencia" : "Vencimiento"} errors={errors}>
            <input {...fixed("dueOn")} type="date" className={controlClass} onChange={change("dueOn")} />
          </Field>
          <Field name="periodStart" label="Inicio del periodo" errors={errors}>
            <input {...fixed("periodStart")} type="date" className={controlClass} onChange={change("periodStart")} />
          </Field>
          <Field name="periodEnd" label="Fin del periodo" errors={errors}>
            <input {...fixed("periodEnd")} type="date" className={controlClass} onChange={change("periodEnd")} />
          </Field>
          {weekly && <div className="sm:col-span-2"><WeeklyConditions /></div>}
          <div className="sm:col-span-2">
            <Field name="reason" label="Motivo del cargo" errors={errors}>
              <textarea {...fixed("reason")} rows={2} className={controlClass} onChange={change("reason")} />
            </Field>
          </div>
        </div>
      </fieldset>
    </div>
    <div className="flex justify-end border-t border-border px-5 py-4 sm:px-6">
      <button type="submit" className="primary-action min-h-12 rounded-xl px-5 text-sm font-semibold">Revisar cargo</button>
    </div>
  </form>;
}

function Field({ name, label, errors, children }: { name: CaptureField; label: string; errors: CaptureErrors; children: ReactNode }) {
  return <div className="min-w-0">
    <label htmlFor={`charge-${name}`} className="mb-1.5 block text-sm font-medium text-primary">{label}</label>
    {children}
    {errors[name] && <p id={`charge-${name}-error`} className="mt-1.5 text-sm text-danger">{errors[name]}</p>}
  </div>;
}
