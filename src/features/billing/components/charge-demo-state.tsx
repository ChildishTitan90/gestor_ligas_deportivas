import { Info } from "lucide-react";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ActionLink } from "@/components/ui/action-link";
import { chargesPath } from "../demo-data";

export function ChargeDemoNotice({ capture = false }: { capture?: boolean }) {
  return <div className="flex items-start gap-3 rounded-xl border border-border bg-soft px-4 py-3 text-sm leading-6 text-primary">
    <Info size={19} aria-hidden="true" className="mt-0.5 shrink-0" />
    <p><strong className="font-semibold">Demostración de tesorería.</strong> {capture
      ? "Los datos y las respuestas son sintéticos. La captura se pierde al salir o recargar."
      : "Los cargos, saldos e historial son ejemplos sintéticos."}</p>
  </div>;
}

export function ChargeAccessDenied({ creating = false, back = chargesPath }: { creating?: boolean; back?: string }) {
  return <section className="mx-auto max-w-6xl space-y-5">
    <ManagementPageHeader title={creating ? "Nuevo cargo" : "Cargos"} description="Tesorería de la liga"
      back={{ href: creating ? back : "/access", label: creating ? "Volver a cargos" : "Volver al panel" }} />
    <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-primary">Acceso denegado</h2>
      <p className="mt-2 text-sm text-muted">{creating ? "Tu cuenta tiene acceso de consulta. El alta requiere el permiso de creación de Cobranza." : "Esta demostración requiere permiso de consulta de Cobranza para el ámbito de liga."}</p>
    </div>
  </section>;
}

export function ChargeListError() {
  return <div className="space-y-3 rounded-2xl border border-border bg-surface p-5 sm:p-6">
    <h2 className="text-lg font-semibold text-primary">No se pudo consultar el listado</h2>
    <p className="text-sm text-muted">Este escenario de demostración simula un fallo de consulta. Puedes volver a cargar los ejemplos.</p>
    <ActionLink href={chargesPath} variant="secondary">Reintentar consulta</ActionLink>
  </div>;
}
