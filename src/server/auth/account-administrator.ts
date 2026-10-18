import "server-only";
import type { Prisma } from "@prisma/client";
import { assertPermission, type AuthorizationContext } from "./authorization";

/** Adaptador del alta existente; no interpreta nombres de roles. */
export function assertAccountAdministrator(
  tx: Prisma.TransactionClient, actorId: string, action: "READ" | "CREATE", context: AuthorizationContext,
) {
  return assertPermission(tx, actorId, { module: "accounts", action, context });
}


