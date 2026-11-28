import { redirect } from "next/navigation";
import { getAuthSession } from "@/server/auth/session";
import { TwoFactorWorkspace } from "@/features/auth/components/two-factor-workspace";
import { ThemeSelector } from "@/components/ui/theme-selector";
export default async function TwoFactorPage() {
  const session = await getAuthSession();
  if (!session?.user) redirect("/login");
  if (!session.user.secondFactor || session.user.secondFactor === "VERIFIED")
    redirect("/access");
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-primary">
          Verifica tu acceso
        </h1>
        <ThemeSelector />
      </div>
      <TwoFactorWorkspace
        challenge
        recovery={session.user.secondFactor === "RECOVERY"}
      />
    </main>
  );
}
