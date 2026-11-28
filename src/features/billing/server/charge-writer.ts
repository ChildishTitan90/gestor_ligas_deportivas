import "server-only";
import { Prisma } from "@prisma/client";
import { BillingError, isChargeConstraintConflict } from "./access";

export const billingDate = (value: string) => new Date(value + "T00:00:00Z");
export async function billingToday(tx: Prisma.TransactionClient) {
  const [row] = await tx.$queryRaw<{ today: string }[]>`SELECT (clock_timestamp() AT TIME ZONE 'America/Mexico_City')::date::text AS today`;
  return row.today;
}

type AutomaticCharge = {
  season_id: string; club_id: null; season_team_id: string; charge_concept_id: string;
  amount: Prisma.Decimal; due_on: Date; period_start_date: Date; period_end_date: Date;
  automation_source: string; automation_policy_id: string;
};

/** Alta en lote con las mismas claves/restricciones que el alta individual. Sin aritmética monetaria. */
export async function insertAutomaticCharges(tx: Prisma.TransactionClient, actorId: string, data: AutomaticCharge[]) {
  const issued = billingDate(await billingToday(tx));
  if (data.some(row => row.due_on < issued)) throw new BillingError("INVALID_DUE_DATE");
  for (const key of [...new Set(data.map(row => `charge:${row.season_id}:${row.season_team_id}`))].sort())
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key},0))::text`;
  const prior = await tx.charges.findMany({ where: { automation_source: { in: data.map(row => row.automation_source) } }, select: { automation_source: true } });
  const sources = new Set(prior.map(row => row.automation_source));
  const pending = data.filter(row => !sources.has(row.automation_source));
  if (!pending.length) return { created: 0, existing: data.length };
  // Los índices de negocio rechazan también un cargo manual incompatible.
  // El trigger original audita cada fila dentro de esta misma transacción.
  try {
    const created = await tx.charges.createMany({ data: pending.map(row => ({ ...row, currency: "MXN", issued_on: issued, created_by: actorId })) });
    return { created: created.count, existing: data.length - created.count };
  } catch (error) {
    if (isChargeConstraintConflict(error)) throw new BillingError("DUPLICATE_CHARGE");
    throw error;
  }
}

/** Único escritor de altas manuales y automáticas. El llamador autoriza dentro de la misma transacción. */
export async function insertCharge(tx: Prisma.TransactionClient, actorId: string, data: {
  season_id: string; club_id: string | null; season_team_id: string | null; charge_concept_id: string;
  amount: Prisma.Decimal; due_on: Date; period_start_date: Date; period_end_date: Date; billing_plan_id?: string;
  automation_source?: string; automation_policy_id?: string;
}) {
  const issued = await billingToday(tx);
  if (data.due_on < billingDate(issued)) throw new BillingError("INVALID_DUE_DATE");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"charge:" + data.season_id + ":" + (data.club_id ?? data.season_team_id)},0))::text`;
  // Un origen ya emitido conserva también sus correcciones posteriores.
  if (data.automation_source) {
    const origin = await tx.charges.findUnique({ where: { automation_source: data.automation_source } });
    if (origin) return { chargeId: origin.id, version: origin.version, existing: true };
  }
  const prior = await tx.charges.findFirst({ where: {
    season_id: data.season_id, club_id: data.club_id, season_team_id: data.season_team_id,
    charge_concept_id: data.charge_concept_id, period_start_date: data.period_start_date, period_end_date: data.period_end_date,
  } });
  if (prior) {
    if (prior.voided_at || !prior.amount.equals(data.amount) || prior.due_on.getTime() !== data.due_on.getTime()
      || (prior.billing_plan_id ?? null) !== (data.billing_plan_id ?? null)
      || (prior.automation_source ?? null) !== (data.automation_source ?? null)) throw new BillingError("DUPLICATE_CHARGE");
    return { chargeId: prior.id, version: prior.version, existing: true };
  }
  try {
    const charge = await tx.charges.create({ data: { ...data, currency: "MXN", issued_on: billingDate(issued), created_by: actorId }, select: { id: true, version: true } });
    return { chargeId: charge.id, version: charge.version, existing: false };
  } catch (error) {
    if (isChargeConstraintConflict(error)) throw new BillingError("DUPLICATE_CHARGE");
    throw error;
  }
}
