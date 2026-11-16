"use client";

export default function Error({ reset }: { reset: () => void }) {
  return <section role="alert" className="space-y-4 rounded-2xl border border-border bg-surface p-6"><h1 className="text-xl font-semibold text-primary">No se pudo abrir la demostración</h1><p>Vuelve a consultar. La captura de esta demo solo permanece en memoria; no existe un borrador persistido para recuperar.</p><button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold" onClick={reset}>Volver a consultar</button></section>;
}
