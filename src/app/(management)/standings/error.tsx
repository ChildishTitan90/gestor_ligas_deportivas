'use client';
export default function Error({ reset }: { reset: () => void }) {
  return <section className="space-y-4 p-6"><h1 className="text-2xl font-semibold">Clasificación no disponible</h1>
    <p role="alert">No se pudo cargar la clasificación. Comprueba tu conexión e intenta nuevamente.</p>
    <button onClick={reset} className="primary-action min-h-12 rounded-xl px-5 py-3">Reintentar consulta</button>
  </section>;
}
