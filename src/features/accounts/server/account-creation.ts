import "server-only";
import type { Prisma } from "@prisma/client";

/** Persistencia compartida. El servicio llamador autoriza y bloquea la Persona. */
export async function insertAccountForPerson(tx: Prisma.TransactionClient, input: {
  actorId: string; personId: string; username: string; email: string; passwordHash: string; reason: string;
}) {
  const user = await tx.users.create({
    data: { person_id: input.personId, username: input.username, email: input.email,
      password_hash: input.passwordHash, is_active: true, must_change_password: true },
    select: { id: true, version: true, must_change_password: true },
  });
  // users no tiene trigger record_audit. Nunca incluir credenciales o PII.
  await tx.audit_logs.create({ data: {
    user_id: input.actorId, action: "INSERT", table_name: "users", entity_id: user.id,
    new_data: { person_id: input.personId, is_active: true, must_change_password: true }, reason: input.reason,
  } });
  return user;
}
