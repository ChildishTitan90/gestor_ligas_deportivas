"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, secondary = false }: { children: string; secondary?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`${secondary ? "border border-border" : "primary-action"} min-h-11 rounded-xl px-4 py-2 font-semibold disabled:opacity-60`}>
    {pending ? "Guardando…" : children}
  </button>;
}
