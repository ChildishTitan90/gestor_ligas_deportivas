import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { chargesPath } from "@/features/billing/demo-data";

export default function ChargeNotFound() {
  return <section className="mx-auto max-w-6xl">
    <ManagementPageHeader title="Cargo de ejemplo no encontrado"
      description="Abre un cargo desde el listado de demostración." back={{ href: chargesPath, label: "Volver a cargos" }} />
  </section>;
}
