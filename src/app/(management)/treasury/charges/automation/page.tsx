import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { ChargeAccessDenied } from "@/features/billing/components/charge-access-denied";
import { AutomationSettings } from "@/features/billing/components/automation-settings";
import { readAutomationWorkspace } from "@/features/billing/server/automation-service";
import { billingPageQuery } from "@/features/billing/server/page-access";

export const metadata = { title: "Cargos automáticos" };
export default async function AutomationPage() {
  const workspace = await billingPageQuery(readAutomationWorkspace);
  if (!workspace) return <ChargeAccessDenied />;
  return <section className="mx-auto max-w-4xl space-y-6">
    <ManagementPageHeader title="Cargos automáticos" description="Autoriza importes y vencimientos por temporada para afiliación, inscripción y arbitraje."
      back={{ href: "/treasury/charges", label: "Volver a cargos" }} />
    <AutomationSettings {...workspace} />
  </section>;
}
