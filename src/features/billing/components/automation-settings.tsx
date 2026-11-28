"use client";
import { useRef, useState, type FormEvent } from "react";
import { SelectField } from "@/components/ui/select-field";
import { FormDialog } from "@/components/ui/form-dialog";
import { focusFormControl } from "@/components/ui/focus-form-control";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { automationLabels, automationPolicySchema, type AutomationPolicyInput, type AutomationPolicyView, type AutomationResult } from "../automation";
import { formatChargeAmount } from "../presentation";
import { billingMessages } from "../feedback";

type Season = { id: string; name: string; league: string };
const inputClass = "mt-1 min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2 text-primary";
const primary = "primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50";
const secondary = "min-h-12 rounded-xl border border-border bg-surface px-5 py-3 font-semibold text-primary disabled:opacity-50";
export function AutomationSettings({ seasons, policies: initial }: { seasons: Season[]; policies: AutomationPolicyView[] }) {
  const [policies, setPolicies] = useState(initial);
  const [season, setSeason] = useState("");
  const [kind, setKind] = useState<AutomationPolicyInput["kind"]>("CLUB_AFFILIATION");
  const [dirty, setDirty] = useState(false);
  const [intent, setIntent] = useState<AutomationPolicyInput | null>(null);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "sending" | "uncertain" | "confirmed">("idle");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const active = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const current = policies.find(p => p.seasonId === season && p.kind === kind);
  const locked = state === "sending" || state === "uncertain";
  useUnsavedChangesWarning(locked ? "El envío aún no tiene acuse. Si sales perderás la intención para reintentarlo. ¿Salir?"
    : dirty ? "Hay cambios sin guardar en la configuración. ¿Salir?" : null);
  function context(change: () => void) {
    if (dirty && !window.confirm("Se perderán los cambios sin guardar. ¿Cambiar de configuración?")) return;
    change(); setDirty(false); setErrors({}); setMessage(""); setState("idle"); setIntent(null);
  }
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const parsed = automationPolicySchema.safeParse({ operationId: crypto.randomUUID(), seasonId: season, kind,
      expectedRevision: current?.revision ?? 0, enabled: data.get("enabled") === "on", amount: data.get("amount"),
      dueDays: Number(data.get("dueDays")), firstMatchday: Number(data.get("firstMatchday") ?? 1), lastMatchday: Number(data.get("lastMatchday") ?? 1), reason: data.get("reason") });
    if (!parsed.success) {
      const issues = Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message]));
      setErrors(issues); focusFormControl(event.currentTarget, String(parsed.error.issues[0].path[0])); return;
    }
    setErrors({}); setMessage(""); setIntent(parsed.data); setOpen(true);
  }
  async function send() {
    if (!intent || active.current) return;
    active.current = true; setState("sending"); setMessage("");
    try {
      const response = await fetch("/api/v1/billing/automation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent) });
      const result = await response.json() as AutomationResult;
      if (result.status === "CONFIRMED") {
        setPolicies(items => [...items.filter(p => p.seasonId !== result.policy.seasonId || p.kind !== result.policy.kind), result.policy]);
        setState("confirmed"); setDirty(false); setOpen(false); setIntent(null);
        setMessage("Configuración confirmada por el servidor. Los cargos emitidos están disponibles en Cargos; no se registró ningún pago.");
      } else if (result.status === "REJECTED") {
        setState("idle"); setOpen(false);
        setMessage(result.code === "VERSION_CONFLICT" ? "La configuración cambió. Recarga para consultar su revisión vigente; conserva tu captura antes de salir."
          : billingMessages[result.code] ?? "No se guardó la configuración. Revisa los datos y vuelve a intentar.");
      } else { setState("uncertain"); setMessage("No hay acuse confirmado. Reintenta el mismo envío: el servidor conserva su clave y evita duplicarlo."); }
    } catch { setState("uncertain"); setMessage("Se perdió la respuesta. Conservamos el mismo envío para recuperarlo sin duplicar cargos."); }
    finally { active.current = false; }
  }
  const fieldError = (name: string) => errors[name] ? <span id={`${name}-error`} className="mt-1 block text-sm text-danger">{errors[name]}</span> : null;
  const period = kind === "REFEREE_MATCHDAY";
  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Temporada<SelectField id="automation-season" name="seasonId" value={season} disabled={locked} onValueChange={value => context(() => setSeason(value))}
        options={seasons.map(s => ({ value: s.id, label: s.name, description: s.league }))} /></label>
      <label className="text-sm font-medium">Evento que genera el cargo<SelectField id="automation-kind" name="kind" value={kind} disabled={locked} onValueChange={value => context(() => setKind(value as typeof kind))}
        options={Object.entries(automationLabels).map(([value, label]) => ({ value, label }))} /></label>
    </div>
    {!season ? <p role="status" className="text-muted">Selecciona una temporada para configurar sus cargos automáticos.</p> : <>
      <div className="space-y-2 text-sm leading-6">
        <h2 className="text-lg font-semibold text-primary">{automationLabels[kind]}</h2>
        <p className="text-muted">{period
          ? "Una cuota por equipo con partido programado en cada jornada de fase regular. Los descansos no generan cargo. La liguilla se cobra manualmente."
          : kind === "CLUB_AFFILIATION" ? "Un cargo por club al aprobar su afiliación a esta temporada. No cobra clubes que ya estaban aprobados."
            : "Un cargo por equipo al confirmar su inscripción en esta temporada. No cobra inscripciones anteriores a la habilitación."}</p>
        <p className="font-medium">{current ? `Revisión ${current.revision} · ${current.enabled ? "Habilitada" : "Deshabilitada"}` : "Sin configurar: no hay generación automática."}</p>
      </div>
      <form ref={form} key={`${season}:${kind}:${current?.revision ?? 0}`} onSubmit={review} onChange={() => { setDirty(true); setState("idle"); }} className="space-y-5">
        <fieldset disabled={locked} className="space-y-5">
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" name="enabled" className="size-5 accent-accent" defaultChecked={current?.enabled ?? false} />Habilitar esta generación automática</label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">{period ? "Importe por equipo y jornada (MXN)" : "Importe de inscripción (MXN)"}
              <input name="amount" inputMode="decimal" autoComplete="off" defaultValue={current?.amount ?? ""} required className={inputClass} aria-invalid={!!errors.amount} aria-describedby={errors.amount ? "amount-error" : undefined} />{fieldError("amount")}</label>
            <label className="text-sm font-medium">Días para pagar desde la emisión
              <input name="dueDays" type="number" min="0" max="365" autoComplete="off" defaultValue={current?.dueDays ?? ""} required className={inputClass} aria-invalid={!!errors.dueDays} aria-describedby={`dueDays-help${errors.dueDays ? " dueDays-error" : ""}`} />
              <span id="dueDays-help" className="mt-1 block text-sm text-muted">0 significa que vence el mismo día de emisión.</span>{fieldError("dueDays")}</label>
            {period && <>
              <label className="text-sm font-medium">Aplicar desde la jornada<input name="firstMatchday" type="number" min="1" max="1000" autoComplete="off" required defaultValue={current?.firstMatchday ?? ""} className={inputClass} aria-invalid={!!errors.firstMatchday} aria-describedby={errors.firstMatchday ? "firstMatchday-error" : undefined} />{fieldError("firstMatchday")}</label>
              <label className="text-sm font-medium">Última jornada de fase regular<input name="lastMatchday" type="number" min="1" max="1000" autoComplete="off" required defaultValue={current?.lastMatchday ?? ""} className={inputClass} aria-invalid={!!errors.lastMatchday} aria-describedby={errors.lastMatchday ? "lastMatchday-error" : undefined} />{fieldError("lastMatchday")}</label>
            </>}
          </div>
          {period && <p className="max-w-3xl text-sm leading-6 text-muted">Al habilitar se generan los cargos pendientes de partidos ya programados en ese rango. Después se generan al aprobar su calendario. Una nueva tarifa solo se aplica a jornadas aún no cobradas; conserva los cargos anteriores, incluso si siguen pendientes de pago.</p>}
          {period && <p className="max-w-3xl text-sm leading-6">Si programas toda la fase regular de una vez, sus cargos se emiten en ese momento. El plazo para pagar cuenta desde la emisión de cada cargo.</p>}
          <label className="block text-sm font-medium">Motivo de la configuración<textarea name="reason" autoComplete="off" maxLength={2000} required rows={3} className={inputClass} aria-invalid={!!errors.reason} aria-describedby={errors.reason ? "reason-error" : undefined} />{fieldError("reason")}</label>
          <button className={primary}>Revisar configuración</button>
        </fieldset>
      </form>
    </>}
    {message && <p role={state === "confirmed" ? "status" : "alert"} className="text-sm leading-6">{message}</p>}
    <FormDialog open={open} pending={locked} onClose={() => { if (!locked) setOpen(false); }} title="Confirmar generación automática" description="Revisa el contexto y el efecto antes de autorizarlo.">
      {intent && <div className="space-y-4 text-sm leading-6">
        <p className="font-semibold">{seasons.find(s => s.id === intent.seasonId)?.name} · {automationLabels[intent.kind]}</p>
        <p>{intent.enabled ? "Habilitar" : "Deshabilitar"} · {formatChargeAmount(intent.amount, "MXN")} · Vence {intent.dueDays} días después de emitirse.</p>
        {intent.kind === "REFEREE_MATCHDAY" && <p>Jornadas {intent.firstMatchday} a {intent.lastMatchday}, todos los equipos con partido de fase regular. Los cargos emitidos conservan sus importes. Liguilla: captura manual.</p>}
        {intent.kind === "REFEREE_MATCHDAY" && intent.enabled && <p>Los partidos ya programados en ese rango generan sus cargos ahora; no esperan al día del encuentro.</p>}
        <p>Motivo: {intent.reason}</p>
        <p>{intent.enabled ? "Esta regla autoriza la creación automática de deuda. No registra pagos." : "Deshabilitar conserva los cargos ya emitidos y su historial."}</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" className={secondary} disabled={locked} onClick={() => setOpen(false)} data-dialog-initial>Volver a editar</button>
          <button type="button" className={primary} disabled={state === "sending"} onClick={send}>{state === "sending" ? "Guardando…" : state === "uncertain" ? "Reintentar el mismo envío" : "Confirmar configuración"}</button>
        </div>
        {locked && message && <p role="alert">{message}</p>}
      </div>}
    </FormDialog>
  </div>;
}
