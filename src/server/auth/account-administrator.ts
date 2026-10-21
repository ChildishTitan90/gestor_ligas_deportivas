import "server-only";
import type { Prisma } from "@prisma/client";
import { assertPermission, type AuthorizationContext } from "./authorization";

/** El alta existente consume Usuarios y roles de RF22 sin interpretar roles. */
export function assertAccountAdministrator(
  tx: Prisma.TransactionClient, actorId: string, action: "READ" | "CREATE", context: AuthorizationContext,
) {
  return assertPermission(tx, actorId, { module: "users", action, context });
}


