"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { saveGovernance } from "../actions";

export function GovernanceForm({ title, description, submit, operation, leagueId, children }: {
  title: string; description: string; submit: string; operation: string; leagueId: string; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [requestId, setRequestId] = useState('');
  const reasonId = useId();
  const [, action, pending] = useActionState(async (_previous: null, form: FormData) => {
    await saveGovernance(form);
    return null;
  }, null);
  return <>
    <button type="button" onClick={() => { if (operation === "appoint") setRequestId(crypto.randomUUID()); setOpen(true); }} className="min-h-11 rounded-xl border border-border px-4 py-2 font-semibold">
      {title}
    </button>
    {open && <FormDialog open title={title} description={description}
      dirty={dirty} pending={pending} onClose={() => { setDirty(false); setOpen(false); }}>
      <form action={action} onChange={() => setDirty(true)} className="space-y-4">
        <input type="hidden" name="operation" value={operation} />
        <input type="hidden" name="leagueId" value={leagueId} />
        {operation === "appoint" && <input type="hidden" name="requestId" value={requestId} />}
        {children}
        <div>
          <label htmlFor={reasonId}>Motivo del cambio</label>
          <input id={reasonId} name="reason" required minLength={3} maxLength={300}
            className="block min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2" />
        </div>
        <button type="submit" disabled={pending} className="primary-action min-h-11 rounded-xl px-4 py-2 font-semibold disabled:opacity-60">
          {pending ? "Guardando…" : submit}
        </button>
      </form>
    </FormDialog>}
  </>;
}
