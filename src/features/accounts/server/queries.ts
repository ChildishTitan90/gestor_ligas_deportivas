import "server-only";
import { getAccountCreationOptions } from "./service";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError } from "@/server/auth/authorization";
import { getPrisma } from "@/server/db/prisma";

export async function getAccountFormData() {
  const options = await getAccountCreationOptions();
  if (!options.roles.length) throw new AuthorizationError();
  const actor = await requireOperationalUser();
  const capabilities = await getPrisma().$transaction(async (tx) => {
    async function allows(module: string, leagueId?: string) {
      try {
        await assertPermission(tx, actor.id, { module, action: "CREATE", context: { leagueId } });
        return true;
      } catch (error) {
        if (error instanceof AuthorizationError) return false;
        throw error;
      }
    }
    const canReusePerson = await allows("users");
    const createClubLeagues: string[] = [];
    for (const league of options.leagues) if (await allows("clubs", league.id)) createClubLeagues.push(league.id);
    return { canReusePerson, createClubLeagues };
  });
  return { options, ...capabilities };
}
