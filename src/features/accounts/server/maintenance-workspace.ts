import "server-only";
import { listAccounts } from "./maintenance";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { getPrisma } from "@/server/db/prisma";

/** Reuses the same global boundary as maintenance endpoints; no role matrix. */
export async function canReadAccountMaintenance() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    await assertPermission(tx, actor.id, { module: "users", action: "READ", context: {} });
    return true;
  });
}
export async function getAccountMaintenanceWorkspace(input: unknown) {
  const actor = await requireOperationalUser();
  const list = await listAccounts(input);
  const canUpdate = await getPrisma().$transaction(async tx => {
    try { await assertPermission(tx, actor.id, { module: "users", action: "UPDATE", context: {} }); return true; }
    catch (error) { if (error instanceof AuthorizationError) return false; throw error; }
  });
  return { list, actorId: actor.id, canUpdate };
}
