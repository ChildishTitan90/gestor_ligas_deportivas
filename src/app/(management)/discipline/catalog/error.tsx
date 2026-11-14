"use client";
export default function ErrorPage({ reset }: { reset: () => void }) { return <section><h1 className="text-2xl font-semibold">No se pudo cargar el catálogo</h1><p className="my-4">Vuelve a consultar antes de realizar cambios.</p><button className="primary-action min-h-12 rounded-xl px-5" onClick={reset}>Reintentar consulta</button></section>; }
