"use client";

import { useRef, useState, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { focusFormControl } from "@/components/ui/focus-form-control";
import { FormDialog } from "@/components/ui/form-dialog";
import { ProcessSteps } from "@/components/ui/process-steps";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { chargesPath, chargesUrl } from "../navigation";
import { saveBillingCommand, consultBillingOperation } from "../actions";
import { billingMessages } from "../feedback";
import { chargeCaptureSchema, createChargeSchema, type CreateCharge } from "../schemas";
import type { BillingReceipt, BillingResult, BillingSeason, ChargeFilters, ChargeTerms as Terms } from "../types";
import { ChargeCaptureFields, type CaptureErrors, type CaptureField, type ChargeDraft } from "./charge-capture";
import { ChargeTerms, WeeklyConditions } from "./charge-details";

const steps = ["Captura", "Revisión", "Resultado confirmado"];
const primary = "primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50";
const secondary = "min-h-12 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold text-primary hover:bg-background disabled:opacity-50";
const draftDefaults: ChargeDraft = {
  seasonId: "", recipientKind: "", recipientId: "", concept: "", frequency: "ONCE",
  amount: "", dueOn: "", periodStart: "", periodEnd: "", reason: "",
};
const fieldOrder = Object.keys(draftDefaults) as CaptureField[];

type Intent = { command: CreateCharge; terms: Terms };
type Result = "idle" | "sending" | "error" | "uncertain" | "checking" | "retry" | "confirmed";

export function ChargeForm({ seasons, filters }: {
  seasons: readonly BillingSeason[];
  filters: ChargeFilters;
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
  const [receipt, setReceipt] = useState<BillingReceipt | null>(null);
  const [error, setError] = useState("");
  const consultationRequired = result === "uncertain" || result === "checking" || result === "retry";
  const locked = consultationRequired || result === "sending";
  const back = chargesUrl(chargesPath, filters);

  useUnsavedChangesWarning(result === "confirmed" ? null : locked
    ? "El envío aún no tiene un resultado confirmado. Si sales, perderás los datos para conciliarlo desde esta captura. ¿Salir?"
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

  function accept(response: BillingResult) {
    if (response.status === "CONFIRMED" && response.receipt.operationId === intent?.command.operationId) {
      setReceipt(response.receipt);
      setResult("confirmed");
    } else if (response.status === "REJECTED") {
      setError(billingMessages[response.code] ?? "Revisa los datos y vuelve a consultar.");
      setResult("error");
    } else setResult(response.status === "NOT_APPLIED" ? "retry" : "uncertain");
  }

  async function submitIntent() {
    if (!intent || active.current || (result !== "idle" && result !== "error" && result !== "retry")) return;
    active.current = true;
    setConfirmOpen(false);
    setResult("sending");
    requestAnimationFrame(() => reviewHeading.current?.focus());
    try { accept(await saveBillingCommand({ action: "CREATE", input: intent.command })); }
    catch { setResult("uncertain"); }
    active.current = false;
    requestAnimationFrame(() => (resultHeading.current ?? reviewHeading.current)?.focus());
  }

  async function checkResult() {
    if (!intent || active.current || result !== "uncertain") return;
    active.current = true;
    setResult("checking");
    try { accept(await consultBillingOperation({ action: "CREATE", input: intent.command })); }
    catch { setResult("uncertain"); }
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
          <h2 ref={resultHeading} tabIndex={-1} id="charge-result" className="text-lg font-semibold">{weekly ? "Plan semanal guardado" : receipt?.existing ? "Cargo existente recuperado" : "Cargo creado"}</h2>
          <p className="mt-1 text-sm">{weekly ? "El plan quedó guardado. Elige cada periodo y su vencimiento desde el listado para generar sus cargos." : "El servidor confirmó el cargo. El registro de pagos corresponde a otro trámite."}</p>
        </div>
        <ChargeTerms terms={intent.terms} preview />
        {weekly && <WeeklyConditions />}
        <ActionLink href={back}>Volver al listado</ActionLink>
        {receipt?.chargeId && <ActionLink variant="secondary" href={chargesUrl(`${chargesPath}/${receipt.chargeId}`, filters)}>Ver cargo</ActionLink>}
      </section>
      : <section className="space-y-5 rounded-2xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="review-charge">
        <div>
          <h2 ref={reviewHeading} tabIndex={-1} id="review-charge" className="text-lg font-semibold text-primary">Revisa los datos del cargo</h2>
          <p className="mt-1 text-sm text-muted">Verifica el destinatario y el importe antes de confirmar.</p>
        </div>
        <ChargeTerms terms={intent.terms} preview />
        <p className="wrap-anywhere border-t border-border pt-3 text-sm text-primary"><strong className="font-semibold">Motivo:</strong> {intent.command.reason}</p>
        {weekly && <WeeklyConditions />}
        {(result === "sending" || result === "checking") && <p role="status" className="rounded-xl bg-soft px-4 py-3 text-sm text-primary">
          {result === "sending" ? "Enviando la solicitud…" : "Consultando el resultado…"}
        </p>}
        {result === "error" && <p role="alert" className="rounded-xl bg-danger-surface px-4 py-3 text-sm text-danger">{error} La captura se conserva.</p>}
        {result === "uncertain" && <p role="alert" className="rounded-xl bg-soft px-4 py-3 text-sm text-primary"><strong>Resultado incierto.</strong> Conservamos los datos de este intento. Consulta su resultado antes de volver a enviarlo.</p>}
        {result === "retry" && <p role="status" className="rounded-xl bg-soft px-4 py-3 text-sm text-primary">La consulta confirmó que ese intento no se aplicó. Puedes reintentar con los mismos datos.</p>}
        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
          {!locked && <>
            <button type="button" className={secondary} onClick={edit}>Volver a la captura</button>
            <button type="button" className={primary} onClick={() => setConfirmOpen(true)}>{weekly ? "Guardar plan semanal" : "Crear cargo"}</button>
          </>}
          {result === "uncertain" && <button type="button" className={primary} onClick={checkResult}>Consultar resultado</button>}
          {result === "retry" && <button type="button" className={primary} onClick={submitIntent}>Reintentar la misma solicitud</button>}
        </div>
      </section>}
    {intent && <FormDialog open={confirmOpen} title={weekly ? "Guardar plan semanal" : "Crear cargo"}
      description="Confirma el destinatario y el importe."
      onClose={() => setConfirmOpen(false)} dismissLabel="Volver a la revisión"
      footer={<button type="button" className={primary} onClick={submitIntent}>Confirmar {weekly ? "plan" : "cargo"}</button>}>
      <ChargeTerms terms={intent.terms} preview />
    </FormDialog>}
  </div>;
}
