"use client";

import { useRef, useState, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { focusFormControl } from "@/components/ui/focus-form-control";
import { FormDialog } from "@/components/ui/form-dialog";
import { ProcessSteps } from "@/components/ui/process-steps";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { chargesPath, chargesUrl, type DemoResponse, type DemoSeason } from "../demo-data";
import { chargeCaptureSchema, createChargeSchema, type CreateCharge } from "../schemas";
import type { ChargeFilters, ChargeTerms as Terms } from "../types";
import { ChargeCaptureFields, type CaptureErrors, type CaptureField, type ChargeDraft } from "./charge-capture";
import { ChargeTerms, WeeklyConditions } from "./charge-details";

const steps = ["Captura", "Revisión", "Resultado simulado"];
const primary = "primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50";
const secondary = "min-h-12 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold text-primary hover:bg-background disabled:opacity-50";
const draftDefaults: ChargeDraft = {
  seasonId: "", recipientKind: "", recipientId: "", concept: "", frequency: "ONCE",
  amount: "", dueOn: "", periodStart: "", periodEnd: "", reason: "",
};
const fieldOrder = Object.keys(draftDefaults) as CaptureField[];

type Intent = { command: CreateCharge; terms: Terms };
type Result = "idle" | "sending" | "error" | "uncertain" | "checking" | "retry" | "confirmed";

export function ChargeForm({ seasons, filters, response }: {
  seasons: readonly DemoSeason[];
  filters: ChargeFilters;
  response: DemoResponse;
}) {
  const [draft, setDraft] = useState<ChargeDraft>(() => ({ ...draftDefaults, seasonId: filters.season ?? "" }));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<CaptureErrors>({});
  const [intent, setIntent] = useState<Intent | null>(null);
  const [result, setResult] = useState<Result>("idle");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const active = useRef(false);
  const scenarioUsed = useRef(false);
  const consultationRequired = result === "uncertain" || result === "checking" || result === "retry";
  const locked = consultationRequired || result === "sending";
  const back = chargesUrl(chargesPath, filters);

  useUnsavedChangesWarning(result === "confirmed" ? null : locked
    ? "La simulación aún no tiene un resultado confirmado. Si sales, se perderá la captura de esta página. ¿Salir?"
    : dirty ? "Si sales, se perderán los datos de la captura. ¿Salir?" : null);

  function changeDraft(field: CaptureField, value: string) {
    setDirty(true);
    const resetRecipient = field === "seasonId" || field === "recipientKind";
    setDraft(current => resetRecipient ? { ...current, [field]: value, recipientId: "" } : { ...current, [field]: value });
    setErrors(current => ({
      ...current, [field]: undefined,
      ...(resetRecipient ? { recipientId: undefined } : {}),
      ...(field === "periodStart" ? { periodEnd: undefined } : {}),
    }));
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = chargeCaptureSchema.safeParse(draft);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const visibleErrors: CaptureErrors = {};
      for (const field of fieldOrder) {
        const issue = issues.find(item => item.path[0] === field);
        if (issue) visibleErrors[field] = issue.message;
      }
      setErrors(visibleErrors);
      const first = fieldOrder.find(field => visibleErrors[field]);
      if (first) requestAnimationFrame(() => focusFormControl(form.current, first));
      return;
    }
    const { recipientId, recipientKind, ...data } = parsed.data;
    const selected = seasons.find(season => season.id === data.seasonId);
    const recipient = selected?.recipients.find(item => item.id === recipientId && item.kind === recipientKind);
    if (!selected || !recipient) {
      const field = selected ? "recipientId" : "seasonId";
      setErrors({ [field]: "Vuelve a elegir dentro de la temporada seleccionada." });
      requestAnimationFrame(() => focusFormControl(form.current, field));
      return;
    }

    const season = { id: selected.id, name: selected.name, league: selected.league };
    const command = createChargeSchema.parse({
      ...data, operationId: crypto.randomUUID(),
      recipient: recipient.kind === "CLUB" ? { kind: "CLUB", clubId: recipient.id } : { kind: "TEAM", seasonTeamId: recipient.id },
    });
    setIntent({ command, terms: { ...data, currency: "MXN", season, recipient } });
    setResult("idle");
    requestAnimationFrame(() => reviewHeading.current?.focus());
  }

  async function simulate() {
    if (!intent || active.current || (result !== "idle" && result !== "error" && result !== "retry")) return;
    active.current = true;
    setConfirmOpen(false);
    setResult("sending");
    requestAnimationFrame(() => reviewHeading.current?.focus());
    await pause();
    const initial = !scenarioUsed.current;
    scenarioUsed.current = true;
    if (initial && response === "error") setResult("error");
    else if (initial && (response === "uncertain" || response === "retry")) setResult("uncertain");
    else setResult("confirmed");
    active.current = false;
    requestAnimationFrame(() => (resultHeading.current ?? reviewHeading.current)?.focus());
  }

  async function checkResult() {
    if (!intent || active.current || result !== "uncertain") return;
    active.current = true;
    setResult("checking");
    await pause();
    setResult(response === "retry" ? "retry" : "confirmed");
    active.current = false;
    requestAnimationFrame(() => (resultHeading.current ?? reviewHeading.current)?.focus());
  }

  function edit() {
    setIntent(null);
    setResult("idle");
    requestAnimationFrame(() => focusFormControl(form.current, "seasonId"));
  }

  const weekly = intent?.terms.frequency === "WEEKLY";
  return <div className="space-y-5">
    <ProcessSteps steps={steps} current={result === "confirmed" ? 2 : intent ? 1 : 0} />
    {!intent ? <ChargeCaptureFields formRef={form} seasons={seasons} draft={draft} errors={errors} onChange={changeDraft} onReview={review} />
      : result === "confirmed" ? <section className="space-y-5 rounded-2xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="charge-result">
        <div className="rounded-xl bg-(--positive-surface) px-4 py-3 text-positive">
          <h2 ref={resultHeading} tabIndex={-1} id="charge-result" className="text-lg font-semibold">{weekly ? "Plan semanal simulado" : "Creación del cargo simulada"}</h2>
          <p className="mt-1 text-sm">{weekly ? "La simulación terminó. El calendario de la Liga sigue pendiente y no se generaron cargos ni pagos." : "La simulación terminó. No se registró ningún cargo oficial ni pago."}</p>
        </div>
        <ChargeTerms terms={intent.terms} preview />
        {weekly && <WeeklyConditions />}
        <ActionLink href={back}>Volver al listado</ActionLink>
      </section>
      : <section className="space-y-5 rounded-2xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="review-charge">
        <div>
          <h2 ref={reviewHeading} tabIndex={-1} id="review-charge" className="text-lg font-semibold text-primary">Revisa los datos del cargo</h2>
          <p className="mt-1 text-sm text-muted">Verifica el destinatario y el importe antes de confirmar la simulación.</p>
        </div>
        <ChargeTerms terms={intent.terms} preview />
        <p className="wrap-anywhere border-t border-border pt-3 text-sm text-primary"><strong className="font-semibold">Motivo:</strong> {intent.command.reason}</p>
        {weekly && <WeeklyConditions />}
        {(result === "sending" || result === "checking") && <p role="status" className="rounded-xl bg-soft px-4 py-3 text-sm text-primary">
          {result === "sending" ? "Enviando la solicitud de demostración…" : "Consultando el resultado simulado…"}
        </p>}
        {result === "error" && <p role="alert" className="rounded-xl bg-danger-surface px-4 py-3 text-sm text-danger">La demostración rechazó el intento. La captura se conserva. Puedes revisarla o volver a intentar.</p>}
        {result === "uncertain" && <p role="alert" className="rounded-xl bg-soft px-4 py-3 text-sm text-primary"><strong>Resultado incierto.</strong> Conservamos los datos de este intento. Consulta su resultado antes de volver a enviarlo.</p>}
        {result === "retry" && <p role="status" className="rounded-xl bg-soft px-4 py-3 text-sm text-primary">La consulta de demostración confirmó que ese intento no se aplicó. Puedes reintentar con los mismos datos.</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          {!locked && <>
            <button type="button" className={secondary} onClick={edit}>Volver a la captura</button>
            <button type="button" className={primary} onClick={() => setConfirmOpen(true)}>{weekly ? "Simular plan semanal" : "Simular creación del cargo"}</button>
          </>}
          {result === "uncertain" && <button type="button" className={primary} onClick={checkResult}>Consultar resultado</button>}
          {result === "retry" && <button type="button" className={primary} onClick={simulate}>Reintentar la misma solicitud</button>}
        </div>
      </section>}
    {intent && <FormDialog open={confirmOpen} title={weekly ? "Simular plan semanal" : "Simular creación del cargo"}
      description="Confirma el destinatario y el importe de la demostración."
      onClose={() => setConfirmOpen(false)} dismissLabel="Volver a la revisión"
      footer={<button type="button" className={primary} onClick={simulate}>Confirmar simulación</button>}>
      <ChargeTerms terms={intent.terms} preview />
    </FormDialog>}
  </div>;
}

function pause() {
  return new Promise<void>(resolve => setTimeout(resolve, 850));
}
