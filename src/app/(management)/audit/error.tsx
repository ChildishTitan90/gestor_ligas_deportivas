"use client";
import Link from "next/link";
export default function AuditError({reset}:{reset:()=>void}) {
  return <div className="space-y-4 p-6"><p role="alert">No se pudo cargar la consulta. Inténtalo de nuevo.</p>
    <button type="button" className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold" onClick={reset}>Reintentar consulta</button>
    <Link href="/access" className="ml-4 underline">Volver a mi panel</Link></div>;
}
