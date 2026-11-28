import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { lockAuthorization } from "@/server/auth/authorization";
import { billingCommandSchema, type BillingCommand } from "../schemas";
import type { BillingReceipt, BillingResult } from "../types";
import { authorizeRecipient, BillingError, recipientOf, isChargeConstraintConflict } from "./access";
import { insertCharge } from "./charge-writer";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map(canonical));
  if (value !== null && typeof value === "object")
    return JSON.stringify(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return JSON.stringify(value);
}
const fingerprint = (command: BillingCommand) => createHash("sha256").update(canonical(command)).digest("hex");
const date = (value: string) => new Date(value + "T00:00:00Z");
const receiptSchema = z.object({
  operationId: z.uuid(), chargeId: z.uuid().optional(), planId: z.uuid().optional(),
  version: z.number().int().positive().optional(), existing: z.boolean(),
});

async function operationLock(tx: Prisma.TransactionClient, operationId: string) {
  await lockAuthorization(tx);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"billing:" + operationId},0))::text`;
}
async function authorizeCommand(tx: Prisma.TransactionClient, actorId: string, command: BillingCommand) {
  if (command.action === "CREATE") {
    await authorizeRecipient(tx, actorId, "CREATE", command.input.seasonId, command.input.recipient);
    return;
  }
  const row = command.action === "MODIFY"
    ? await tx.charges.findUnique({ where: { id: command.input.chargeId } })
    : await tx.billing_plans.findUnique({ where: { id: command.input.planId } });
  if (!row) throw new BillingError("CONTEXT_CHANGED");
  await authorizeRecipient(tx, actorId, command.action === "MODIFY" ? "UPDATE" : "CREATE", row.season_id, recipientOf(row));
}
async function existingReceipt(tx: Prisma.TransactionClient, actorId: string, command: BillingCommand): Promise<BillingReceipt | null> {
  const row = await tx.audit_logs.findUnique({ where: { id: command.input.operationId }, select: { user_id: true, action: true, new_data: true } });
  if (!row) return null;
  const data = row.new_data as { hash?: string; receipt?: unknown } | null;
  if (row.user_id !== actorId || row.action !== "BILLING_OPERATION" || data?.hash !== fingerprint(command))
    throw new BillingError("OPERATION_KEY_REUSED");
  return receiptSchema.parse(data.receipt);
}

/** Devuelve el acuse exacto después de volver a comprobar identidad, acción y ámbito. */
export async function readBillingOperation(input: unknown): Promise<BillingResult> {
  const command = billingCommandSchema.parse(input);
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    await operationLock(tx, command.input.operationId);
    await authorizeCommand(tx, actor.id, command);
    const receipt = await existingReceipt(tx, actor.id, command);
    return receipt ? { status: "CONFIRMED", receipt } : { status: "NOT_APPLIED" };
  }, { timeout: 15000 });
}

/** Una intención se confirma junto con su efecto; el trigger conserva la auditoría de la entidad. */
export async function executeBillingCommand(input: unknown): Promise<BillingReceipt> {
  const command = billingCommandSchema.parse(input);
  const actor = await requireOperationalUser();
  try {
    return await getPrisma().$transaction(async tx => {
      await operationLock(tx, command.input.operationId);
      await authorizeCommand(tx, actor.id, command);
      const prior = await existingReceipt(tx, actor.id, command);
      if (prior) return prior;
      await tx.$queryRaw`SELECT set_config('app.user_id',${actor.id},true),set_config('app.reason',${command.input.reason},true)`;
      let result: Omit<BillingReceipt, "operationId">;
      if (command.action === "MODIFY") result = await modifyCharge(tx, command.input);
      else if (command.action === "GENERATE") result = await generateCharge(tx, actor.id, command.input);
      else result = await createCharge(tx, actor.id, command.input);
      const receipt = { ...result, operationId: command.input.operationId };
      await tx.audit_logs.create({ data: {
        id: receipt.operationId, user_id: actor.id, action: "BILLING_OPERATION", table_name: "billing_operations",
        entity_id: receipt.chargeId ?? receipt.planId, reason: command.input.reason,
        new_data: { kind: command.action, hash: fingerprint(command), receipt }, correlation_id: receipt.operationId,
      } });
      return receipt;
    }, { timeout: 15000 });
  } catch (error) {
    if (isChargeConstraintConflict(error)) throw new BillingError("DUPLICATE_CHARGE");
    throw error;
  }
}

async function createCharge(tx: Prisma.TransactionClient, actorId: string, input: Extract<BillingCommand, { action: "CREATE" }>["input"]) {
  // PDGLD-27 todavía no publica el contrato de resolución firme y sanción exigible.
  if (input.concept === "FINE") throw new BillingError("RESOLUTION_UNAVAILABLE");
  const concept = await tx.charge_concepts.findUnique({ where: { code: input.concept }, select: { id: true } });
  if (!concept) throw new BillingError("CONTEXT_CHANGED");
  const target = input.recipient.kind === "CLUB" ? { club_id: input.recipient.clubId, season_team_id: null }
    : { club_id: null, season_team_id: input.recipient.seasonTeamId };
  const data = { ...target, season_id: input.seasonId, charge_concept_id: concept.id, amount: new Prisma.Decimal(input.amount) };
  if (input.frequency === "WEEKLY") {
    const plan = await tx.billing_plans.create({ data: { ...data, frequency: "WEEKLY",
      starts_at: date(input.periodStart), ends_at: date(input.periodEnd), created_by: actorId }, select: { id: true } });
    return { planId: plan.id, existing: false };
  }
  return insertCharge(tx, actorId, { ...data, due_on: date(input.dueOn), period_start_date: date(input.periodStart), period_end_date: date(input.periodEnd) });
}

async function generateCharge(tx: Prisma.TransactionClient, actorId: string, input: Extract<BillingCommand, { action: "GENERATE" }>["input"]) {
  await tx.$queryRaw`SELECT id FROM sports_management.billing_plans WHERE id=${input.planId}::uuid FOR SHARE`;
  const plan = await tx.billing_plans.findUniqueOrThrow({ where: { id: input.planId } });
  const concept = await tx.charge_concepts.findUniqueOrThrow({ where: { id: plan.charge_concept_id }, select: { code: true } });
  if (concept.code === "FINE") throw new BillingError("RESOLUTION_UNAVAILABLE");
  if (plan.frequency !== "WEEKLY" || date(input.periodStart) < plan.starts_at || !plan.ends_at || date(input.periodEnd) > plan.ends_at)
    throw new BillingError("INVALID_PERIOD");
  const charge = await insertCharge(tx, actorId, {
    season_id: plan.season_id, club_id: plan.club_id, season_team_id: plan.season_team_id,
    charge_concept_id: plan.charge_concept_id, amount: plan.amount, due_on: date(input.dueOn),
    period_start_date: date(input.periodStart), period_end_date: date(input.periodEnd), billing_plan_id: plan.id,
  });
  return { ...charge, planId: plan.id };
}

async function modifyCharge(tx: Prisma.TransactionClient, input: Extract<BillingCommand, { action: "MODIFY" }>["input"]) {
  await tx.$queryRaw`SELECT id FROM sports_management.charges WHERE id=${input.chargeId}::uuid FOR UPDATE`;
  const charge = await tx.charges.findUniqueOrThrow({ where: { id: input.chargeId } });
  if (charge.version !== input.version) throw new BillingError("VERSION_CONFLICT");
  if (charge.voided_at || charge.sanction_id) throw new BillingError("POLICY_UNCONFIRMED");
  if (await tx.payments.count({ where: { charge_id: charge.id } })) throw new BillingError("CHARGE_HAS_PAYMENTS");
  if (date(input.dueOn) < charge.issued_on) throw new BillingError("INVALID_DUE_DATE");
  const updated = await tx.charges.update({ where: { id: charge.id }, data: {
    amount: new Prisma.Decimal(input.amount), due_on: date(input.dueOn), version: { increment: 1 },
  }, select: { version: true } });
  return { chargeId: charge.id, version: updated.version, existing: false };
}
