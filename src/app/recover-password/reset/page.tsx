import { PasswordRecoveryForm } from "@/features/auth/components/password-recovery-form";

export const metadata = { title: "Elige una nueva contraseña" };

export default function Page() {
  return <>
    <h1 className="text-2xl font-semibold tracking-tight text-primary">Elige una nueva contraseña</h1>
    <PasswordRecoveryForm reset={true} />
  </>;
}
