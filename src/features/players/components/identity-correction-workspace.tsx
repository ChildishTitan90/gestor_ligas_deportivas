"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { SelectField } from "@/components/ui/select-field";
import { correctionMessages, correctionRequestSchema, type CorrectionIdentity, type CorrectionWorkspace } from "../identity-correction";
const fields = [['curp', 'CURP'], ['firstName', 'Nombre(s)'], ['paternalSurname', 'Apellido paterno'], ['maternalSurname', 'Apellido materno'], ['birthDate', 'Nacimiento']] as const;
export function IdentityCorrectionWorkspace({ data, actorId }: {
    data: CorrectionWorkspace;
    actorId: string;
}) {
    const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState("");
    const messageRef = useRef<HTMLParagraphElement>(null);
    useEffect(() => { if (message) messageRef.current?.focus(); }, [message]);
    const lock = useRef(false);
    const requestKey = useRef<string | null>(null);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const [chosen, setChosen] = useState<CorrectionIdentity>(data.identity);
    async function send(path: string, body: BodyInit, json = false) {
        if (lock.current || uncertain)
            return;
        lock.current = true;
        setBusy(true);
        setMessage("");
        try {
            const response = await fetch(path, { method: "POST", headers: { "X-Expected-Actor-Id": actorId, ...(json ? { "Content-Type": "application/json" } : {}) }, body });
            if (response.status >= 500)
                throw Error();
            const result = await response.json();
            if (!response.ok) {
                requestKey.current = null;
                setMessage(correctionMessages[result.code] ?? "No se aplicó la operación. Revisa la solicitud.");
                return;
            }
            setUncertain(true);
            setMessage("Operación confirmada. Consulta el estado actualizado antes de otra decisión.");
        }
        catch {
            setUncertain(true);
            setMessage(correctionMessages.SERVICE_UNAVAILABLE);
        }
        finally {
            lock.current = false;
            setBusy(false);
        }
    }
    const base = `/api/player-registrations/${data.registrationId}/identity-corrections`;
    return <section className="mx-auto w-full min-w-0 max-w-4xl space-y-6 break-words"><Link href={`/players/registrations/${data.registrationId}/documents`} className="underline">Volver al expediente</Link><h1 className="text-2xl font-semibold">Corrección de identidad deportiva</h1>
  <p>Solicitar o devolver una corrección no cambia la identidad ni la habilitación. La aprobación requiere evidencia privada y autoridad sobre todas las referencias de la misma persona.</p>
  <p>Las referencias en temporadas cerradas sin identidad histórica acreditada bloquean la aplicación, sin cambiar el historial.</p>
  <p>CURP: constancia correcta y documento de vinculación si hay duda. Nombre o nacimiento: acta o documento rectificatorio; constancia actualizada si cambia la clave o existe discrepancia. Para menores no hay excepciones nuevas y se conserva la acreditación de tutor.</p>
  {data.canRequest && <form className="space-y-4 rounded-xl border border-border bg-surface p-5" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); requestKey.current ??= crypto.randomUUID(); const intent = { operationKey: requestKey.current, expectedIdentityVersion: data.identityVersion, identity: chosen, reason: String(form.get('reason')), identityDoubt: form.get('identityDoubt') === 'on' }; const parsed = correctionRequestSchema.safeParse(intent); if (!parsed.success) {
            const fields: Record<string, string> = {};
            for (const issue of parsed.error.issues) {
                const field = String(issue.path[0] === 'identity' ? issue.path[1] : issue.path[0]);
                fields[field] ??= issue.message;
            }
            setErrors(fields);
            setMessage('Revisa los campos indicados.');
            return;
        } setErrors({}); const payload = new FormData(); payload.set('intent', JSON.stringify(intent)); for (const kind of ['CURP_CERTIFICATE', 'CIVIL_RECORD', 'LINK_DOCUMENT']) {
            const file = form.get(kind);
            if (file instanceof File && file.size)
                payload.set(kind, file);
        } void send(base, payload); }}>
   <h2 className="text-xl font-semibold">Solicitar corrección</h2><fieldset disabled={busy || uncertain} className="space-y-4">
   {fields.map(([key, label]) => <div key={key}><label htmlFor={`correction-${key}`}>{label}</label><input className="mt-1 min-h-12 w-full rounded-xl border border-border bg-background px-3" id={`correction-${key}`} name={key} type={key === 'birthDate' ? 'date' : 'text'} required={key !== 'maternalSurname'} aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `correction-${key}-error` : undefined} value={chosen[key] ?? ''} onChange={e => setChosen(v => ({ ...v, [key]: e.target.value }))}/>{errors[key] && <p id={`correction-${key}-error`} className="text-sm">{errors[key]}</p>}</div>)}
   <label className="block">Motivo privado<textarea name="reason" aria-invalid={Boolean(errors.reason)} aria-describedby={errors.reason ? "correction-reason-error" : undefined} required minLength={10} maxLength={500} className="mt-1 w-full rounded-xl border border-border bg-background p-3"/>{errors.reason && <span id="correction-reason-error" className="block text-sm">{errors.reason}</span>}</label>
   <label className="flex gap-3"><input type="checkbox" name="identityDoubt"/>Existe duda de vinculación con la misma persona; adjunto documento de vinculación.</label>
   {[['CURP_CERTIFICATE', 'Constancia CURP'], ['CIVIL_RECORD', 'Acta o documento rectificatorio'], ['LINK_DOCUMENT', 'Documento de vinculación']].map(([kind, label]) => <label key={kind} className="block">{label}<input type="file" name={kind} accept="application/pdf,image/png,image/jpeg" className="mt-2 block w-full"/></label>)}
   <p className="text-sm">Evidencia privada PDF, PNG o JPEG, hasta 10 MiB por documento. La captura solo permanece en esta página; salir o recargar la pierde.</p>
   <button className="primary-action min-h-12 rounded-xl px-5">Enviar solicitud</button></fieldset></form>}
  {message && <p role="status" tabIndex={-1} ref={messageRef}>{message}</p>}
  <button type="button" disabled={busy} onClick={() => location.reload()} className="min-h-12 rounded-xl border border-border px-4">Consultar estado sin reenviar</button>
  <h2 className="text-xl font-semibold">Solicitudes de este expediente</h2>{!data.requests.length && <p>No hay solicitudes visibles.</p>}
  {data.requests.map(r => <article key={r.id} className="space-y-4 rounded-xl border border-border bg-surface p-5"><h3 className="font-semibold">{r.status === 'PENDING' ? 'Pendiente' : r.status === 'RETURNED' ? 'Devuelta' : 'Aplicada'} · {r.createdAt}</h3><dl>{fields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{r.identity[key] ?? '—'}</dd></div>)}</dl><p>Motivo privado: {r.reason}</p>{r.observations && <p>Observaciones: {r.observations}</p>}<ul>{r.evidence.map(e => <li key={e.id}><a target="_blank" rel="noreferrer" className="underline" href={`${base}/evidence/${e.id}`}>Ver evidencia privada · {e.kind}</a></li>)}</ul>
   {r.status === 'PENDING' && data.canReview && !r.own && <Decision applyBlockedCode={data.applyBlockedCode} busy={busy || uncertain} onSend={body => void send(`${base}/${r.id}`, JSON.stringify(body), true)}/>}
   {r.status === 'PENDING' && r.own && <p>No puedes aprobar ni devolver tu propia solicitud.</p>}
   {!data.canReview && <p>La revisión requiere autoridad con alcance sobre todas las referencias afectadas.</p>}
  </article>)}
 </section>;
}
function Decision({ busy, onSend, applyBlockedCode }: {
    applyBlockedCode: string | null;
    busy: boolean;
    onSend: (value: unknown) => void;
}) {
    const decisionId = useId();
    const [decision, setDecision] = useState('RETURN');
    const operationKey = useRef<string | null>(null);
    return <form className="space-y-4" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); operationKey.current ??= crypto.randomUUID(); onSend({ operationKey: operationKey.current, decision, observations: String(form.get('observations')), evidenceChecked: form.get('evidenceChecked') === 'on', samePersonChecked: form.get('samePersonChecked') === 'on', curpDiscrepancy: form.get('curpDiscrepancy') === 'on' }); }}><fieldset disabled={busy} className="space-y-4"><div><label htmlFor={decisionId} className="block">Decisión</label><SelectField id={decisionId} value={decision} onValueChange={setDecision} searchable={false} options={[{ value: 'RETURN', label: 'Devolver con observaciones' }, { value: 'APPLY', label: 'Aplicar corrección a la misma persona', disabled: Boolean(applyBlockedCode) }]}/></div>
 {applyBlockedCode && <p role="status">{correctionMessages[applyBlockedCode]}</p>}
 <label className="block">Observaciones privadas<textarea name="observations" required minLength={10} maxLength={500} className="block w-full rounded-xl border border-border bg-background p-3"/></label>
 <label className="flex gap-3"><input type="checkbox" name="evidenceChecked" required={decision === 'APPLY'}/>Comprobé los documentos admisibles y su suficiencia.</label>
 <label className="flex gap-3"><input type="checkbox" name="samePersonChecked" required={decision === 'APPLY'}/>Comprobé que corresponde a la misma persona.</label>
 <label className="flex gap-3"><input type="checkbox" name="curpDiscrepancy"/>Hay discrepancia de CURP; exijo constancia actualizada.</label>
 <p>Aplicar invalida verificaciones y habilitaciones dependientes. No modifica partidos, resultados ni sanciones. Si hay referencias cerradas sin identidad histórica, la operación queda bloqueada.</p><button className="primary-action min-h-12 rounded-xl px-5">Confirmar decisión</button></fieldset></form>;
}
