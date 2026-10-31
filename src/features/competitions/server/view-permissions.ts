import "server-only";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { getPrisma } from "@/server/db/prisma";

export async function getConfigurationCapabilities(seasonId: string) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    async function allowed(module: "competitions" | "clubs", action: "CREATE" | "UPDATE" | "APPROVE") {
      try { await assertPermission(tx, actor.id, { module, action, context: { seasonId } }); return true; }
      catch (error) { if (error instanceof AuthorizationError) return false; throw error; }
    }
    return { create: await allowed("competitions", "CREATE"), update: await allowed("competitions", "UPDATE"), distribute: await allowed("clubs", "APPROVE") };
  });
}
