import { PasswordRecoveryForm } from "@/features/auth/components/password-recovery-form";
import { ThemeSelector } from "@/components/ui/theme-selector";

export default function Page() {
  return <main className="mx-auto min-h-svh max-w-lg space-y-5 px-6 py-10">
    <div className="flex justify-end"><ThemeSelector /></div>
    <section className="space-y-4 rounded-3xl border border-border bg-surface p-6">
      <h1 className="text-2xl font-semibold">Elige una nueva contraseña</h1>
      <PasswordRecoveryForm reset={true} />
    </section>
  </main>;
}
