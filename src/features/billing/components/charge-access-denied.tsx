import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { chargesPath } from "../navigation";

export function ChargeAccessDenied({ creating = false, back = chargesPath }: { creating?: boolean; back?: string }) {
  return <section className="mx-auto max-w-6xl space-y-5">
    <ManagementPageHeader title={creating ? "Nuevo cargo" : "Cargos"} description="Tesorería de la liga"
      back={{ href: creating ? back : "/access", label: creating ? "Volver a cargos" : "Volver al panel" }} />
    <div className="rounded-2xl border border-border bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-primary">Acceso denegado</h2>
      <p className="mt-2 text-sm text-muted">{creating ? "El alta requiere el permiso de creación de Cobranza en este ámbito." : "Tu cuenta requiere permiso de consulta de Cobranza en este ámbito."}</p>
    </div>
  </section>;
}

