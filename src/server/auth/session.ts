import "server-only";

import { getServerSession } from "next-auth";
import type { AuthIdentity } from "@/features/auth/types";
import { getAuthOptions } from "./options";

export class AuthAccessError extends Error {
  constructor(public readonly code: "UNAUTHENTICATED" | "PASSWORD_CHANGE_REQUIRED") {
    super(code);
  }
  get status() { return this.code === "UNAUTHENTICATED" ? 401 : 403; }
}

export function getAuthSession() {
  // jwt callback consulta la cuenta vigente en cada invocación, sin caché compartida.
  return getServerSession(getAuthOptions());
}

/** Solo identidad: también permite la sesión restringida del cambio de contraseña. */
export async function requireAuthenticatedUser(): Promise<AuthIdentity> {
  const session = await getAuthSession();
  if (!session?.user) throw new AuthAccessError("UNAUTHENTICATED");
  return session.user;
}

/** Prerrequisito de negocio; cada servicio debe verificar además permiso y alcance. */
export async function requireOperationalUser(): Promise<AuthIdentity> {
  const user = await requireAuthenticatedUser();
  if (user.mustChangePassword) throw new AuthAccessError("PASSWORD_CHANGE_REQUIRED");
  return user;
}
