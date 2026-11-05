"use client";
export default function Error({reset}:{reset:()=>void}){return <section className="space-y-4 p-6"><h1 className="text-2xl font-semibold">Configuración no disponible</h1><p>No se pudo consultar esta configuración o tu cuenta no tiene acceso.</p><button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3" onClick={reset}>Volver a consultar</button></section>;}
