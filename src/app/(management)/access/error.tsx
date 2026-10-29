"use client";

import { ActionLink } from "@/components/ui/action-link";

export default function AccessError({ reset }: { reset: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col py-10">
      <section aria-labelledby="access-error-title" className="rounded-3xl border border-border bg-surface p-6 sm:p-9">
        <h1 id="access-error-title" className="text-2xl font-semibold text-primary">No pudimos cargar tus funciones</h1>
        <p className="mt-4 text-sm leading-7 text-muted">Revisa tu conexión e inténtalo de nuevo.</p>
        <button type="button" onClick={reset} className="mt-6 min-h-12 w-full rounded-xl primary-action px-5 py-3 text-sm font-semibold">Reintentar</button>
        <ActionLink href="/futbol" variant="secondary" className="mt-3 w-full">Ver portal de fútbol</ActionLink>
      </section>
    </div>
  );
}
