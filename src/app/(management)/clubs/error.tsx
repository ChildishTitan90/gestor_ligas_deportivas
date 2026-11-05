"use client";
export default function Error({ reset }: { reset: () => void }) {
  return <div role="alert"><p>No se pudieron cargar los clubes y equipos.</p><button onClick={reset} className="primary-action mt-4 min-h-12 rounded-xl px-5 py-3">Volver a intentar</button></div>;
}
