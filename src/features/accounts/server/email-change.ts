import "server-only";
import { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { assertPermission, lockAuthorization } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { getEmailTransport, type EmailTransport } from "@/server/email/transport";
import { AccountMaintenanceError } from "../maintenance-contract";
import type { EmailDelivery } from "../email-change-contract";
import { createEmailChangeService, type EmailChangeTransaction, type EmailAccount, type EmailRequest } from "./email-change-core";

const columns = Prisma.sql`id, user_id AS "userId", actor_id AS "actorId", operation_key AS "operationKey",
  input_hash AS "inputHash", old_email AS "oldEmail", new_email AS "newEmail", token_hash AS "tokenHash",
  expected_revision AS revision, user_version AS "userVersion", reason, created_at AS "createdAt",
  expires_at AS "expiresAt", used_at AS "usedAt", status, confirmation_delivery AS "confirmationDelivery",
  previous_notice_delivery AS "previousNoticeDelivery", completion_notice_delivery AS "completionNoticeDelivery"`;

function store(tx: Prisma.TransactionClient, transport: EmailTransport | null): EmailChangeTransaction {
  return {
    async authorize(actorId) { await assertPermission(tx, actorId, { module: "users", action: "UPDATE", context: {} }); },
    async lockAccount(id) {
      const [row] = await tx.$queryRaw<EmailAccount[]>`SELECT id,email,maintenance_revision AS revision,version,
        is_active AS active, coalesce(locked_until > clock_timestamp(),false) AS blocked
        FROM sports_management.users WHERE id=${id}::uuid FOR UPDATE`;
      return row ?? null;
    },
    async now() { const [row] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`; return row.now; },
    async operation(actor, key) {
      const [row] = await tx.$queryRaw<EmailRequest[]>`SELECT ${columns} FROM sports_management.account_email_changes
        WHERE actor_id=${actor}::uuid AND operation_key=${key}::uuid FOR UPDATE`;
      return row ?? null;
    },
    async findToken(hash) {
      const [row] = await tx.$queryRaw<EmailRequest[]>`SELECT ${columns} FROM sports_management.account_email_changes
        WHERE token_hash=${hash} FOR UPDATE`;
      return row ?? null;
    },
    async latest(userId) {
      const [row] = await tx.$queryRaw<EmailRequest[]>`SELECT ${columns} FROM sports_management.account_email_changes
        WHERE user_id=${userId}::uuid ORDER BY created_at DESC,id DESC LIMIT 1`;
      return row ?? null;
    },
    async countRecent(userId, since) {
      const [row] = await tx.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM sports_management.account_email_changes
        WHERE user_id=${userId}::uuid AND created_at>=${since}`;
      return row.count;
    },
    async assertUnique(userId, email) {
      const [row] = await tx.$queryRaw<{ found: boolean }[]>`SELECT EXISTS(SELECT 1 FROM sports_management.users
        WHERE id<>${userId}::uuid AND (lower(email)=lower(${email}) OR lower(username)=lower(${email}))) AS found`;
      if (row.found) throw new AccountMaintenanceError("DUPLICATE_ACCOUNT", 409);
    },
    async supersede(userId) { await tx.$executeRaw`UPDATE sports_management.account_email_changes SET status='SUPERSEDED'
      WHERE user_id=${userId}::uuid AND status='PENDING'`; },
    async advanceRevision(userId) { await tx.$executeRaw`UPDATE sports_management.users SET maintenance_revision=maintenance_revision+1
      WHERE id=${userId}::uuid`; },
    async insert(row) {
      await tx.$executeRaw`INSERT INTO sports_management.account_email_changes
        (id,user_id,actor_id,operation_key,input_hash,old_email,new_email,token_hash,expected_revision,user_version,
         reason,created_at,expires_at,status,confirmation_delivery,previous_notice_delivery,completion_notice_delivery)
        VALUES (${row.id}::uuid,${row.userId}::uuid,${row.actorId}::uuid,${row.operationKey}::uuid,${row.inputHash},
          ${row.oldEmail},${row.newEmail},${row.tokenHash},${row.revision},${row.userVersion},${row.reason},${row.createdAt},
          ${row.expiresAt},'PENDING',${row.confirmationDelivery},${row.previousNoticeDelivery},${row.completionNoticeDelivery})`;
    },
    async confirm(row, now) {
      await tx.$executeRaw`UPDATE sports_management.users SET email=${row.newEmail},email_verified_at=${now},
        maintenance_revision=maintenance_revision+1,version=version+1 WHERE id=${row.userId}::uuid`;
      await tx.sessions.updateMany({ where: { user_id: row.userId, revoked_at: null }, data: { revoked_at: now } });
      // Ningún reset anterior puede conservar autoridad sobre el destino sustituido.
      await tx.$executeRaw`UPDATE sports_management.password_resets SET used_at=${now}
        WHERE user_id=${row.userId}::uuid AND used_at IS NULL`;
      await tx.$executeRaw`UPDATE sports_management.account_email_changes SET status='CONFIRMED',used_at=${now},
        completion_notice_delivery=${transport ? "PENDING" : "NOT_CONFIGURED"} WHERE id=${row.id}::uuid`;
    },
    async audit(row, phase) {
      await tx.audit_logs.create({ data: { user_id: row.actorId, action: `ACCOUNT_EMAIL_${phase}`, table_name: "users",
        entity_id: row.userId, reason: row.reason, previous_data: { maintenance_revision: row.revision - (phase === "REQUESTED" ? 1 : 0) },
        new_data: { operation_id: row.id, maintenance_revision: row.revision + (phase === "CONFIRMED" ? 1 : 0),
          sessions_revoked: phase === "CONFIRMED" } } });
    },
  };
}
const deliveryColumns = {
  confirmationDelivery: Prisma.sql`confirmation_delivery`, previousNoticeDelivery: Prisma.sql`previous_notice_delivery`,
  completionNoticeDelivery: Prisma.sql`completion_notice_delivery`,
};
// Inyección de transporte solo por código de servidor, nunca por env/JSON del navegador.
export function createDatabaseEmailChanges(prisma: ReturnType<typeof getPrisma>, actor: () => Promise<string>, transport: EmailTransport | null) {
  return createEmailChangeService({
    actor,
    transaction: work => prisma.$transaction(async tx => {
      // Orden común a estado/username; serializa solicitud, reemplazo y confirmación.
      await lockAuthorization(tx, "exclusive");
      return work(store(tx, transport));
    }),
    async delivery(id, field, state: EmailDelivery) {
      await prisma.$executeRaw`UPDATE sports_management.account_email_changes SET ${deliveryColumns[field]}=${state} WHERE id=${id}::uuid`;
    },
    transport,
  });
}
export function accountEmailChanges() {
  return createDatabaseEmailChanges(getPrisma(), async () => (await requireOperationalUser()).id, getEmailTransport());
}
