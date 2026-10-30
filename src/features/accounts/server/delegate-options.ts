import "server-only";
import { delegateOptionsSchema } from "../schemas";
import { delegateAvailability } from "../delegate-position";
import { AccountInputError } from "../account-errors";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertCanGrantRole, assertPermission } from "@/server/auth/authorization";
import type { DelegateAssignmentOptions } from "../types";

export async function getDelegateAssignmentOptions(input: unknown): Promise<DelegateAssignmentOptions> {
  const actor = await requireOperationalUser();
  const parsed = delegateOptionsSchema.safeParse(input);
  if (!parsed.success) throw new AccountInputError("VALIDATION_ERROR");
  const data = parsed.data;
  return getPrisma().$transaction(async tx => {
    const context = { leagueId: data.leagueId,
      ...(data.club.kind === "existing" ? { clubId: data.club.id } : {}) };
    await assertPermission(tx, actor.id, { module: "users", action: "READ", context });
    await assertPermission(tx, actor.id, { module: "users", action: "CREATE", context });
    const role = await tx.roles.findUniqueOrThrow({ where: { code: "CLUB_DELEGATE" }, select: { id: true } });
    await assertCanGrantRole(tx, actor.id, role.id, context);
    if (data.club.kind === "new")
      await assertPermission(tx, actor.id, { module: "clubs", action: "CREATE", context });
    const [{ now }] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const startsAt = data.period ? new Date(data.period.startsAt) : now;
    const endsAt = data.period?.endsAt ? new Date(data.period.endsAt) : null;
    const occupied = data.club.kind === "existing" ? await tx.$queryRaw<{ position: string | null }[]>`
      SELECT delegate_position AS position FROM sports_management.user_roles
      WHERE role_id = ${role.id}::uuid AND club_id = ${data.club.id}::uuid
        AND tstzrange(starts_at, ends_at, '[)') && tstzrange(${startsAt}::timestamptz, ${endsAt}::timestamptz, '[)')
    ` : [];
    return { period: { startsAt: startsAt.toISOString(), endsAt: endsAt?.toISOString() ?? null },
      positions: delegateAvailability(occupied.map(row => row.position)) };
  });
}
