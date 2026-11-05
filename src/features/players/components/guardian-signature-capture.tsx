"use client";
import { useEffect, useRef, useState } from "react";
import { DirectSignatureField } from "@/components/ui/direct-signature-field";
import { SelectField } from "@/components/ui/select-field";
import { buildGuardianSignatureRecord, guardianRelationships, guardianSignatureSchema, guardianSignatureStatement } from "../guardian-signature";

export function GuardianSignatureCapture({ registrationId, disabled, onPrepared }: {
  registrationId: string; disabled: boolean; onPrepared: (file: File | null) => void;
}) {
  const [name, setName] = useState(""), [relationship, setRelationship] = useState("");
  const [signature, setSignature] = useState<File | null>(null), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const revision = useRef(0), mounted = useRef(false), lock = useRef(false);
  useEffect(() => { const version = revision; mounted.current = true; return () => { mounted.current = false; version.current++; }; }, []);
  function changed() { revision.current++; onPrepared(null); setMessage(""); }
  async function prepare() {
    if (lock.current || disabled || !signature) return;
    const data = guardianSignatureSchema.safeParse({ registrationId, guardianName: name, relationship, acknowledgesRecord: acknowledged });
    if (!data.success) { setMessage("Completa nombre, relación y confirmación antes de preparar la evidencia."); return; }
    lock.current = true; setBusy(true); const version = revision.current;
    try {
      const file = await buildGuardianSignatureRecord(data.data, signature);
      if (mounted.current && revision.current === version) {
        onPrepared(file); setMessage("Documento con firma preparado en esta pantalla. Revisa el PDF y confirma su envío con el botón de abajo; quedará pendiente de revisión.");
      }
    } catch { if (mounted.current) setMessage("No se pudo preparar el documento con firma. Conservamos los datos para que puedas revisarlos y reintentar."); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <fieldset disabled={disabled || busy} className="space-y-4 rounded-xl border border-border p-4">
    <legend className="px-2 font-semibold">Firma de padre, madre o tutor</legend>
    <p className="text-sm">La persona responsable debe revisar estos datos y dibujar su propia firma. La credencial escolar o constancia de estudios corresponde al menor y es un documento separado.</p>
    <p className="text-sm text-muted">Secretaría o Administración debe revisar la identidad del firmante, su relación con el menor, la firma y la autorización antes de acreditarla. Esta captura no habilita por sí sola al jugador.</p>
    <div><label htmlFor="guardian-name">Nombre completo de quien firma</label><input id="guardian-name" value={name} maxLength={160} onChange={event => { changed(); setName(event.target.value); }} aria-describedby="guardian-capture-message" className="mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2" /></div>
    <div><label htmlFor="guardian-relationship">Relación declarada con el menor</label><SelectField id="guardian-relationship" value={relationship} options={guardianRelationships} onValueChange={value => { changed(); setRelationship(value); }} disabled={disabled || busy} searchable={false} /></div>
    <DirectSignatureField label="Firma de la persona responsable" disabled={disabled || busy} onChange={file => { changed(); setSignature(file); }} />
    <label className="flex items-start gap-3"><input type="checkbox" checked={acknowledged} onChange={event => { changed(); setAcknowledged(event.target.checked); }} /><span>{guardianSignatureStatement}</span></label>
    <button type="button" onClick={() => void prepare()} disabled={disabled || busy || !signature || !name.trim() || !relationship || !acknowledged} className="primary-action min-h-12 rounded-xl px-4 py-3 disabled:opacity-50">{busy ? "Preparando documento…" : "Preparar documento con firma"}</button>
    <p id="guardian-capture-message" role="status" className="text-sm">{message}</p>
  </fieldset>;
}
