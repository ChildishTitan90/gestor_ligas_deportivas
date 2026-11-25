import { PasswordRecoveryForm } from "@/features/auth/components/password-recovery-form";

export const metadata = { title: "Recuperar contraseña" };

export default function Page() {
  return <>
    <h1 className="text-2xl font-semibold tracking-tight text-primary">Recuperar contraseña</h1>
    <PasswordRecoveryForm reset={false} />
  </>;
}
