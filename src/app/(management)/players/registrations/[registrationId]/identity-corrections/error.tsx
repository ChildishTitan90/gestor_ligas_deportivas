"use client";
export default function Error({ reset }: {
    reset: () => void;
}) { return <section className="space-y-4"><h1 className="text-2xl font-semibold">Corrección de identidad deportiva</h1><p role="alert">No se pudo consultar el estado. Volver a consultar no reenvía una solicitud ni una decisión.</p><button type="button" className="min-h-12 rounded-xl border border-border px-4" onClick={reset}>Volver a consultar</button></section>; }
