import { requireOperationalUser } from "@/server/auth/session";
import { ManagementPageHeader } from "@/components/layout/management-page-header";
import { TwoFactorWorkspace } from "@/features/auth/components/two-factor-workspace";
export default async function SecurityPage() {
  await requireOperationalUser();
  return (
    <div className="space-y-6">
      <ManagementPageHeader
        title="Verificación en dos pasos"
        description="Configura la protección de tu cuenta y conserva tus códigos de respaldo."
        back={{ href: "/access", label: "Mi panel" }}
      />
      <TwoFactorWorkspace />
    </div>
  );
}
