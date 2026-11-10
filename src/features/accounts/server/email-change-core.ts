import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { AccountMaintenanceError, isAccountIdentifierConflict } from "../maintenance-contract";
import { emailChangeConfirmationSchema, emailChangeRequestSchema, type EmailChangeResult, type EmailDelivery } from "../email-change-contract";
import type { AccountEmail, EmailTransport } from "@/server/email/transport";

export type EmailAccount = { id: string; email: string; revision: number; version: number; active: boolean; blocked: boolean };
export type EmailRequest = {
  id: string; userId: string; actorId: string; operationKey: string; inputHash: string;
  oldEmail: string; newEmail: string; tokenHash: string; revision: number; userVersion: number;
  reason: string; expiresAt: Date; createdAt: Date; usedAt: Date | null;
  status: "PENDING" | "CONFIRMED" | "SUPERSEDED";
  confirmationDelivery: EmailDelivery; previousNoticeDelivery: EmailDelivery; completionNoticeDelivery: EmailDelivery;
};
// Puerto del caso de uso; la implementación SQL conserva todas las escrituras en la misma transacción.
export interface EmailChangeTransaction {
  authorize(actorId: string): Promise<void>;
  lockAccount(id: string): Promise<EmailAccount | null>;
  now(): Promise<Date>;
  operation(actor: string, key: string): Promise<EmailRequest | null>;
  findToken(hash: string): Promise<EmailRequest | null>;
  latest(userId: string): Promise<EmailRequest | null>;
  countRecent(userId: string, since: Date): Promise<number>;
  assertUnique(userId: string, email: string): Promise<void>;
  insert(request: EmailRequest): Promise<void>;
  supersede(userId: string): Promise<void>;
  advanceRevision(userId: string): Promise<void>;
  confirm(request: EmailRequest, now: Date): Promise<void>;
  audit(request: EmailRequest, phase: "REQUESTED" | "CONFIRMED"): Promise<void>;
}
export interface EmailChangeDependencies {
  actor(): Promise<string>;
  transaction<T>(work: (tx: EmailChangeTransaction) => Promise<T>): Promise<T>;
  delivery(id: string, field: "confirmationDelivery" | "previousNoticeDelivery" | "completionNoticeDelivery", state: EmailDelivery): Promise<void>;
  transport: EmailTransport | null;
}
export const hashEmailToken = (token: string) => createHash("sha256").update(`EMAIL_CHANGE:${token}`).digest("hex");
function result(row: EmailRequest): EmailChangeResult {
  return { id: row.id, status: row.status, revision: row.revision + (row.status === "CONFIRMED" ? 1 : 0), expiresAt: row.expiresAt.toISOString(),
    confirmationDelivery: row.confirmationDelivery, previousNoticeDelivery: row.previousNoticeDelivery,
    completionNoticeDelivery: row.completionNoticeDelivery };
}
const invalid = () => new AccountMaintenanceError("EMAIL_CHANGE_INVALID", 409);
export function createEmailChangeService(deps: EmailChangeDependencies) {
  async function send(row: EmailRequest, field: "confirmationDelivery" | "previousNoticeDelivery" | "completionNoticeDelivery", message: AccountEmail) {
    let state: EmailDelivery = "NOT_CONFIGURED";
    if (deps.transport) {
      try { state = await deps.transport.send(message); } catch { state = "UNKNOWN"; }
    }
    // Un fallo de persistencia después de enviar deja PENDING: entrega incierta, nunca reenviar automáticamente.
    try { await deps.delivery(row.id, field, state); row[field] = state; }
    catch { row[field] = "UNKNOWN"; }
  }
  async function request(userId: string, input: unknown): Promise<EmailChangeResult> {
    const actorId = await deps.actor();
    const parsed = emailChangeRequestSchema.safeParse(input);
    if (!parsed.success || !z.uuid().safeParse(userId).success) throw new AccountMaintenanceError("VALIDATION_ERROR");
    const data = parsed.data;
    const inputHash = createHash("sha256").update(JSON.stringify([userId, data])).digest("hex");
    const token = `ec1_${randomBytes(32).toString("base64url")}`;
    const prepared = await deps.transaction(async tx => {
      await tx.authorize(actorId);
      const account = await tx.lockAccount(userId);
      if (!account) throw new AccountMaintenanceError("ACCOUNT_NOT_FOUND", 404);
      const prior = await tx.operation(actorId, data.operationKey);
      if (prior) {
        if (prior.inputHash !== inputHash) throw new AccountMaintenanceError("EMAIL_OPERATION_CONFLICT", 409);
        return { row: prior, fresh: false };
      }
      if (!account.active || account.blocked) throw new AccountMaintenanceError("ACCOUNT_NOT_OPERATIONAL", 409);
      if (account.revision !== data.expectedRevision) throw new AccountMaintenanceError("ACCOUNT_CHANGED", 409);
      if (account.email.toLowerCase() === data.email) throw new AccountMaintenanceError("ACCOUNT_IDENTIFIERS_UNCHANGED", 409);
      const now = await tx.now();
      const latest = await tx.latest(userId);
      if ((latest && now.getTime() - latest.createdAt.getTime() < 60_000) ||
          await tx.countRecent(userId, new Date(now.getTime() - 3_600_000)) >= 5)
        throw new AccountMaintenanceError("EMAIL_CHANGE_RATE_LIMITED", 429);
      await tx.assertUnique(userId, data.email);
      const row: EmailRequest = { id: randomUUID(), userId, actorId, operationKey: data.operationKey, inputHash,
        oldEmail: account.email, newEmail: data.email, tokenHash: hashEmailToken(token),
        revision: account.revision + 1, userVersion: account.version, reason: data.reason,
        createdAt: now, expiresAt: new Date(now.getTime() + 30 * 60_000), usedAt: null, status: "PENDING",
        confirmationDelivery: deps.transport ? "PENDING" : "NOT_CONFIGURED",
        previousNoticeDelivery: deps.transport ? "PENDING" : "NOT_CONFIGURED", completionNoticeDelivery: "NOT_CONFIGURED" };
      await tx.supersede(userId);
      await tx.advanceRevision(userId);
      await tx.insert(row);
      await tx.audit(row, "REQUESTED");
      return { row, fresh: true };
    });
    if (prepared.fresh) {
      const row = prepared.row;
      await send(row, "confirmationDelivery", { kind: "EMAIL_CHANGE_CONFIRMATION", to: row.newEmail, token,
        expiresAt: row.expiresAt, idempotencyKey: `${row.id}:confirmation` });
      await send(row, "previousNoticeDelivery", { kind: "EMAIL_CHANGE_REQUESTED", to: row.oldEmail, idempotencyKey: `${row.id}:requested` });
    }
    return result(prepared.row);
  }
  async function confirm(input: unknown): Promise<{ status: "CONFIRMED"; revision: number; sessionsRevoked: true; completionNoticeDelivery: EmailDelivery }> {
    const parsed = emailChangeConfirmationSchema.safeParse(input);
    if (!parsed.success) throw new AccountMaintenanceError("EMAIL_CHANGE_INVALID", 409);
    let row: EmailRequest;
    try {
      row = await deps.transaction(async tx => {
        const current = await tx.findToken(hashEmailToken(parsed.data.token));
        if (!current || current.status !== "PENDING" || current.usedAt) throw invalid();
        // Autoridad del solicitante guardado, no un id/rol enviado por quien porta el token.
        await tx.authorize(current.actorId);
        const account = await tx.lockAccount(current.userId);
        const now = await tx.now();
        if (!account || !account.active || account.blocked || account.version !== current.userVersion ||
            account.revision !== current.revision || account.email !== current.oldEmail || current.expiresAt <= now) throw invalid();
        await tx.assertUnique(current.userId, current.newEmail);
        await tx.confirm(current, now);
        await tx.audit(current, "CONFIRMED");
        return { ...current, status: "CONFIRMED" as const, usedAt: now, revision: current.revision + 1,
          completionNoticeDelivery: deps.transport ? "PENDING" as const : "NOT_CONFIGURED" as const };
      });
    } catch (error) {
      if (isAccountIdentifierConflict(error)) throw new AccountMaintenanceError("DUPLICATE_ACCOUNT", 409);
      throw error;
    }
    await send(row, "completionNoticeDelivery", { kind: "EMAIL_CHANGE_COMPLETED", to: row.oldEmail, idempotencyKey: `${row.id}:completed` });
    return { status: "CONFIRMED", revision: row.revision, sessionsRevoked: true, completionNoticeDelivery: row.completionNoticeDelivery };
  }
  async function status(userId: string, operationKey: string) {
    const actorId = await deps.actor();
    if (!z.uuid().safeParse(userId).success || !z.uuid().safeParse(operationKey).success)
      throw new AccountMaintenanceError("VALIDATION_ERROR");
    return deps.transaction(async tx => {
      await tx.authorize(actorId);
      const row = await tx.operation(actorId, operationKey);
      if (!row || row.userId !== userId) throw new AccountMaintenanceError("EMAIL_CHANGE_NOT_FOUND", 404);
      return result(row);
    });
  }
  return { request, confirm, status };
}
