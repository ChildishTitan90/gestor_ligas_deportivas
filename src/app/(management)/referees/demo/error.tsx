"use client";
export default function Error({ retry }: { retry: () => void }) {
  return <section role="alert" className="mx-auto max-w-7xl rounded-2xl border border-border bg-surface p-8">
    <h1 className="text-xl font-semibold">No se pudo abrir la demostración de arbitraje</h1><p className="mt-2 text-sm text-muted">Comprueba tu conexión y sesión. No se guardó información de negocio.</p>
    <button type="button" className="primary-action mt-5 min-h-12 rounded-xl px-5 py-3 font-semibold" onClick={retry}>Volver a consultar</button>
  </section>;
}
