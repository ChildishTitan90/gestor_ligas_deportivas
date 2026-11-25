"use client";

import { ManagementPageHeader } from "@/components/layout/management-page-header";

export default function ChargePageError({ reset }: { reset: () => void }) {
  return <section className="mx-auto max-w-6xl space-y-5">
    <ManagementPageHeader title="Tesorería temporalmente no disponible"
      description="Vuelve a intentar la consulta de cargos." back={{ href: "/access", label: "Volver al panel" }} />
    <button type="button" className="primary-action min-h-12 rounded-xl px-5 text-sm font-semibold" onClick={reset}>Reintentar consulta</button>
  </section>;
}
