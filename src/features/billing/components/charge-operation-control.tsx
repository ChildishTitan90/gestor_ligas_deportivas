"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { focusFormControl } from "@/components/ui/focus-form-control";
import { saveBillingCommand, consultBillingOperation } from "../actions";
import { billingCommandSchema, type BillingCommand } from "../schemas";
import { billingMessages } from "../feedback";
import { chargesPath } from "../navigation";
import { formatChargeAmount, formatChargePeriod } from "../presentation";
import type { BillingPlan, BillingReceipt, ChargeDetail } from "../types";

type Props = { plan: BillingPlan; charge?: never } | { charge: ChargeDetail; plan?: never };
const inputClass = "mt-1 min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2 text-primary aria-invalid:border-danger";

export function ChargeOperationControl({ plan, charge }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState<BillingCommand | null>(null);
  const [phase, setPhase] = useState("idle");
  const [message, setMessage] = useState("");
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<BillingReceipt | null>(null);
  const [dirty, setDirty] = useState(false);
  const [fields, setFields] = useState({
    amount: charge?.amount ?? plan?.amount ?? "", dueOn: charge?.dueOn ?? "",
    periodStart: "", periodEnd: "", reason: "",
  });
  const busy = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const title = plan ? "Generar cargo del periodo" : "Modificar cargo";
  const pending = phase === "sending" || phase === "checking";
  const uncertain = phase === "uncertain" || phase === "retry";
  const locked = pending || uncertain;
  const errorId = `billing-operation-${plan?.id ?? charge?.id}-error`;
  const validation = (name: string) => ({
    "aria-invalid": invalidField === name || undefined,
    "aria-describedby": invalidField === name ? errorId : undefined,
  });

  function update(name: keyof typeof fields, value: string) {
    setFields(current => ({ ...current, [name]: value })); setDirty(true); setMessage(""); setInvalidField(null); setCommand(null);
  }
  function accept(result: Awaited<ReturnType<typeof saveBillingCommand>>) {
    if (result.status === "CONFIRMED") {
      setReceipt(result.receipt); setPhase("confirmed"); setDirty(false); router.refresh();
    } else if (result.status === "REJECTED") { setPhase("error"); setMessage(billingMessages[result.code] ?? "Revisa la captura y vuelve a consultar."); }
    else setPhase(result.status === "NOT_APPLIED" ? "retry" : "uncertain");
  }
  async function send(intent: BillingCommand, consult = false) {
    if (busy.current) return;
    busy.current = true; setPhase(consult ? "checking" : "sending");
    try { accept(await (consult ? consultBillingOperation(intent) : saveBillingCommand(intent))); }
    catch { setPhase("uncertain"); }
    finally { busy.current = false; }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked || phase === "confirmed") return;
    const operationId = command?.input.operationId ?? crypto.randomUUID();
    const parsed = billingCommandSchema.safeParse(plan
      ? { action: "GENERATE", input: { operationId, planId: plan.id, periodStart: fields.periodStart, periodEnd: fields.periodEnd, dueOn: fields.dueOn, reason: fields.reason } }
      : { action: "MODIFY", input: { operationId, chargeId: charge.id, version: charge.version, amount: fields.amount, dueOn: fields.dueOn, reason: fields.reason } });
    if (!parsed.success) {
      setMessage(parsed.error.issues[0].message);
      const field = parsed.error.issues[0].path.at(-1);
      setInvalidField(typeof field === "string" ? field : null);
      if (typeof field === "string") focusFormControl(form.current, field);
      return;
    }
    // Una captura corregida constituye una intención nueva después de un rechazo explícito.
    setCommand(parsed.data); void send(parsed.data);
  }
  return <>
    <button type="button" className="min-h-12 rounded-xl border border-border bg-surface px-4 text-sm font-semibold text-primary hover:bg-background"
      onClick={() => setOpen(true)}>{uncertain ? "Consultar operación pendiente" : title}</button>
    <FormDialog open={open} title={title} description={plan ? "Genera un cargo para este periodo de siete días. Puedes repetir la consulta del mismo periodo." : "Corrige el importe o vencimiento y explica el motivo."}
      dirty={dirty} pending={pending} uncertain={uncertain} onClose={reason => {
        setOpen(false);
        if (reason === "discard") {
          setDirty(false); setCommand(null); setMessage(""); setInvalidField(null); setPhase("idle");
          setFields({ amount: charge?.amount ?? plan?.amount ?? "", dueOn: charge?.dueOn ?? "", periodStart: "", periodEnd: "", reason: "" });
        }
      }} footer={phase === "confirmed" ? undefined : uncertain ? <>
        <button type="button" className="primary-action min-h-12 rounded-xl px-5 font-semibold" onClick={() => command && void send(command, phase !== "retry")}>
          {phase === "retry" ? "Reintentar la misma solicitud" : "Consultar resultado"}
        </button>
      </> : <button type="submit" form={`billing-operation-${plan?.id ?? charge?.id}`} disabled={pending} className="primary-action min-h-12 rounded-xl px-5 font-semibold disabled:opacity-50">{title}</button>}>
      <div className="mb-4 text-sm text-primary">
        <p className="font-semibold">{(plan ?? charge).recipient.name} · {(plan ?? charge).season.name}</p>
        {plan && <p className="mt-1">Importe por periodo {formatChargeAmount(plan.amount, "MXN")}. Ventana {plan.periodEnd ? formatChargePeriod(plan.periodStart, plan.periodEnd) : plan.periodStart}.</p>}
      </div>
      {phase === "confirmed" ? <div role="status" className="space-y-3 text-sm">
        <p className="font-semibold text-positive">{plan ? receipt?.existing ? "Se recuperó el cargo ya generado para este periodo." : "Cargo generado y confirmado." : "Modificación confirmada."}</p>
        {receipt?.chargeId && <a className="inline-flex min-h-11 items-center font-semibold text-primary underline" href={`${chargesPath}/${receipt.chargeId}`}>Ver cargo actualizado</a>}
        {plan && <button type="button" className="block min-h-12 text-primary underline" onClick={() => {
          setPhase("idle"); setReceipt(null); setCommand(null); setFields(current => ({ ...current, periodStart: "", periodEnd: "", dueOn: "", reason: "" }));
        }}>Generar otro periodo</button>}
      </div> : <form id={`billing-operation-${plan?.id ?? charge?.id}`} ref={form} onSubmit={submit} noValidate autoComplete="off" className="space-y-3">
        <fieldset disabled={locked} className="space-y-3 disabled:opacity-70">
          {plan ? <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">Inicio del periodo<input {...validation("periodStart")} className={inputClass} name="periodStart" type="date" value={fields.periodStart} onChange={event => update("periodStart", event.target.value)} required /></label>
            <label className="text-sm">Fin del periodo<input {...validation("periodEnd")} className={inputClass} name="periodEnd" type="date" value={fields.periodEnd} onChange={event => update("periodEnd", event.target.value)} required /></label>
          </div> : <label className="block text-sm">Importe (MXN)<input {...validation("amount")} className={inputClass} name="amount" inputMode="decimal" value={fields.amount} onChange={event => update("amount", event.target.value)} required /></label>}
          <label className="block text-sm">Vencimiento<input {...validation("dueOn")} className={inputClass} name="dueOn" type="date" value={fields.dueOn} onChange={event => update("dueOn", event.target.value)} required /></label>
          <label className="block text-sm">Motivo<textarea {...validation("reason")} className={inputClass} name="reason" value={fields.reason} onChange={event => update("reason", event.target.value)} required rows={2} /></label>
        </fieldset>
        {message && <p id={errorId} role="alert" className="text-sm text-danger">{message}</p>}
        {uncertain && <p role="status" className="text-sm text-primary">{phase === "retry" ? "El servidor confirmó que el intento no se aplicó. Puedes reenviar la misma intención." : "El resultado sigue sin confirmar. Consulta antes de volver a enviar."}</p>}
      </form>}
    </FormDialog>
  </>;
}
