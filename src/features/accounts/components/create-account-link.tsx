import { ActionLink } from "@/components/ui/action-link";
import { getAccountCreationOptions } from "../server/service";

export async function CreateAccountLink() {
  let allowed = false;
  try {
    const options = await getAccountCreationOptions();
    allowed = options.roles.length > 0;
  } catch { /* La navegación no concede permisos ni bloquea el resto del panel. */ }
  return allowed ? <ActionLink href="/accounts/new" className="mt-4 w-full">Crear cuenta</ActionLink> : null;
}
