import "server-only";
import type { Prisma } from "@prisma/client";
/** Serializa las capturas de una misma persona, también en partidos distintos.
 * READ COMMITTED vuelve a leer las otras cédulas después de esperar el bloqueo. */
export async function lockParticipationPeople(tx: Prisma.TransactionClient, registrationIds: string[]) {
  const isolation = await tx.$queryRaw<{ value: string }[]>`SELECT current_setting('transaction_isolation') AS value`;
  if (isolation[0]?.value !== "read committed") throw Error("PARTICIPATION_ISOLATION_REQUIRED");
  const rows = await tx.player_registrations.findMany({ where: { id: { in: registrationIds } }, select: { person_id: true } });
  for (const person of [...new Set(rows.map(row => row.person_id))].sort())
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(16, hashtext(${person}))::text`;
}
