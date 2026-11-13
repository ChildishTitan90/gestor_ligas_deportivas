"use client";

export default function RecordingError({ reset }: { reset: () => void }) {
  return <section role="alert">
    <h1>No se pudo consultar el registro de partidos</h1>
    <p>Comprueba tu conexión y vuelve a consultar el estado de los partidos.</p>
    <button type="button" className="primary-action mt-4" onClick={reset}>Volver a consultar</button>
  </section>;
}
