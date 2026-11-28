import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { authorizeRecipient, BillingError, recipientOf } from "./access";

/** Contrato privado para PDGLD-78/79/82. El actor proviene de una entrada autenticada de servidor. */
export async function readChargeBalanceForActor(actorId: string, chargeId: string) {
  if (!z.uuid().safeParse(chargeId).success) throw new BillingError("INVALID_INPUT");
  return getPrisma().$transaction(async tx => {
    const charge = await tx.charges.findUnique({ where: { id: chargeId },
      select: { id: true, season_id: true, club_id: true, season_team_id: true, amount: true, due_on: true, voided_at: true, version: true,
        payments: { select: { amount: true, payment_voids: { select: { id: true } } } } } });
    if (!charge) throw new BillingError("CONTEXT_CHANGED");
    await authorizeRecipient(tx, actorId, "READ", charge.season_id, recipientOf(charge));
    const paid = charge.payments.filter(payment => !payment.payment_voids).reduce((sum, payment) => sum.plus(payment.amount), new Prisma.Decimal(0));
    return { chargeId: charge.id, version: charge.version, currency: "MXN" as const, amount: charge.amount.toFixed(2),
      paid: paid.toFixed(2), balance: charge.amount.minus(paid).toFixed(2), dueOn: charge.due_on.toISOString().slice(0, 10), voided: !!charge.voided_at };
  });
}

/** Evento confirmado para PDGLD-83. El descubrimiento, la entrega y deduplicación de avisos pertenecen a su historia. */
export async function readChargeCreatedEventForActor(actorId: string, eventId: string) {
  if (!z.uuid().safeParse(eventId).success) throw new BillingError("INVALID_INPUT");
  return getPrisma().$transaction(async tx => {
    const event = await tx.audit_logs.findFirst({ where: { id: eventId, action: "INSERT", table_name: "charges" },
      select: { id: true, entity_id: true } });
    if (!event?.entity_id) throw new BillingError("CONTEXT_CHANGED");
    const charge = await tx.charges.findUniqueOrThrow({ where: { id: event.entity_id },
      select: { season_id: true, club_id: true, season_team_id: true } });
    await authorizeRecipient(tx, actorId, "READ", charge.season_id, recipientOf(charge));
    return { eventId: event.id, kind: "CHARGE_CREATED" as const, chargeId: event.entity_id };
  });
}
