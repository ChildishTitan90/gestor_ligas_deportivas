"use client";

import { useRef, useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { playerRequest, PlayerRequestError } from "../player-client";
import type { ProviderRetryKind, ProviderRetryState } from "../provider-retry";

export function ProviderRetryAuthorization({ kind, actorId, registrationId, attemptId, state, disabled, fetcher, onAuthorized }: {
  kind: ProviderRetryKind;
  actorId: string;
  registrationId: string;
  attemptId: string;
  state: ProviderRetryState;
  disabled: boolean;
  fetcher?: typeof fetch;
  onAuthorized: (value: unknown) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);

  async function authorize() {
    if (busy.current || disabled || !state.canAuthorizeProviderRetry) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      onAuthorized(await playerRequest(actorId, `/api/player-registrations/${registrationId}/provider-retry`,
        { kind, attemptId, confirmProviderRestored: true }, fetcher));
    } catch (error) {
      setMessage(error instanceof PlayerRequestError && error.code === "OPERATION_CONFLICT"
        ? "El resultado cambió. Actualiza el estado para revisar el intento vigente."
        : "No se pudo confirmar la autorización. Consulta el estado antes de continuar.");
    } finally {
      busy.current = false;
      setPending(false);
      setOpen(false);
    }
  }

  return <div className="space-y-2">
    {state.providerRetryAuthorized ? <p role="status" className="text-sm">Administración autorizó un nuevo intento. Se aplican los límites de consulta habituales.</p>
      : state.canAuthorizeProviderRetry ? <button type="button" disabled={disabled || pending} onClick={() => setOpen(true)}
        className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold text-primary disabled:opacity-50">Autorizar reintento de {kind}</button>
        : <p className="text-sm text-muted">Administración debe restablecer el servicio y autorizar un nuevo intento.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    <FormDialog open={open} title={`Autorizar reintento de ${kind}`} description="Confirma que se corrigieron las credenciales o se restableció el saldo."
      pending={pending} onClose={() => setOpen(false)}
      footer={<button type="button" disabled={disabled || pending || !state.canAuthorizeProviderRetry} onClick={() => void authorize()}
        className="primary-action min-h-12 rounded-xl px-5 py-3 disabled:opacity-50">{pending ? "Guardando…" : "Autorizar un intento"}</button>}>
      <p className="text-sm leading-6">Esta autorización no envía una consulta. La persona con permiso de captura deberá confirmar el nuevo intento.</p>
    </FormDialog>
  </div>;
}
