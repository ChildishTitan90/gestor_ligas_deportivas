"use client";
export default function Error({ reset }: { reset: () => void }) {
  return <div role="alert"><p>No se pudieron cargar las cuentas.</p><button className="primary-action mt-4 min-h-12 rounded-xl px-5 py-3" onClick={reset}>Volver a consultar</button></div>;
}
