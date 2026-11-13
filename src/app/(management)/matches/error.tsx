"use client";
export default function Error({ reset }: { reset: () => void }) { return <section role="alert"><h1>No se pudo consultar la alineación</h1><p>Comprueba tu conexión y vuelve a consultar. No se guardó ninguna alineación.</p><button className="primary-action mt-4" onClick={reset}>Volver a consultar</button></section>; }
