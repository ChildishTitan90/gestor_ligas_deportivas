import "server-only";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { getActorPermissionGrants, AuthorizationError } from "@/server/auth/authorization";
import { chargeConcept } from "../schemas";
import type { BillingQuery } from "../navigation";
import type { BillingPlan, BillingSeason, ChargeDetail, ChargeFilters, ChargeSummary } from "../types";
import { authorizeRecipient, billingCatalog, BillingError, recipientOf } from "./access";

const optionalId = z.preprocess(value => value === "" ? undefined : value, z.uuid().optional());
const filtersSchema = z.object({
  season: optionalId, recipient: optionalId, concept: z.preprocess(value => value === "" ? undefined : value, chargeConcept.optional()),
  league: z.string().max(200).optional(),
  period: z.preprocess(value => value === "" ? undefined : value, z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional()),
  page: z.string().regex(/^[1-9]\d{0,5}$/).optional(),
});
const selection = {
  id: true, season_id: true, club_id: true, season_team_id: true, amount: true, due_on: true,
  period_start_date: true, period_end_date: true, currency: true, version: true, issued_on: true,
  billing_plan_id: true, sanction_id: true, voided_at: true,
  charge_concepts: { select: { code: true } }, billing_plans: { select: { frequency: true } },
  payments: { select: { amount: true, payment_voids: { select: { id: true } } } },
} satisfies Prisma.chargesSelect;
type ChargeRow = Prisma.chargesGetPayload<{ select: typeof selection }>;
const iso = (value: Date) => value.toISOString().slice(0, 10);

function summary(row: ChargeRow, catalog: readonly BillingSeason[]): ChargeSummary {
  const season = catalog.find(item => item.id === row.season_id)!;
  const recipient = season.recipients.find(item => item.id === (row.club_id ?? row.season_team_id))!;
  const paid = row.payments.filter(payment => !payment.payment_voids).reduce((total, payment) => total.plus(payment.amount), new Prisma.Decimal(0));
  return {
    id: row.id, version: row.version, season: { id: season.id, name: season.name, league: season.league }, recipient,
    concept: chargeConcept.parse(row.charge_concepts.code), frequency: row.billing_plans?.frequency === "WEEKLY" ? "WEEKLY" : "ONCE",
    amount: row.amount.toFixed(2), currency: "MXN", dueOn: iso(row.due_on),
    periodStart: iso(row.period_start_date), periodEnd: iso(row.period_end_date),
    payment: { paid: paid.toFixed(2), balance: row.amount.minus(paid).toFixed(2) },
  };
}
function scopeWhere(catalog: readonly BillingSeason[]) {
  return { OR: catalog.map(season => ({
    season_id: season.id, OR: [
      { club_id: { in: season.recipients.filter(item => item.kind === "CLUB").map(item => item.id) } },
      { season_team_id: { in: season.recipients.filter(item => item.kind === "TEAM").map(item => item.id) } },
    ],
  })) };
}
export async function canReadCharges() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => (await getActorPermissionGrants(tx, actor.id)).some(grant =>
    grant.module === "billing" && grant.action === "READ" && (!grant.contextOnly || grant.leagueId || grant.clubId)));
}
export async function getChargeList(query: BillingQuery) {
  const actor = await requireOperationalUser();
  const parsed = filtersSchema.safeParse(query);
  if (!parsed.success) throw new BillingError("INVALID_FILTERS");
  const filters: ChargeFilters = parsed.data;
  return getPrisma().$transaction(async tx => {
    const catalog = await billingCatalog(tx, actor.id);
    if (filters.season && !catalog.some(item => item.id === filters.season)) throw new AuthorizationError();
    const leagues = [...new Set(catalog.map(item => item.league))];
    if (filters.league && !leagues.includes(filters.league)) throw new AuthorizationError();
    const league = filters.league ?? (leagues.length === 1 ? leagues[0] : undefined);
    const selected = catalog.filter(item => item.league === league);
    if (filters.season && !selected.some(item => item.id === filters.season)) throw new AuthorizationError();
    if (filters.recipient && !selected.some(item => item.recipients.some(recipient => recipient.id === filters.recipient))) throw new AuthorizationError();
    const active = selected.filter(item => !filters.season || item.id === filters.season);
    const where: Prisma.chargesWhereInput = {
      AND: [scopeWhere(active)], voided_at: null,
      ...(filters.recipient ? { OR: [{ club_id: filters.recipient }, { season_team_id: filters.recipient }] } : {}),
      ...(filters.concept ? { charge_concepts: { code: filters.concept } } : {}),
    };
    if (filters.period) {
      const start = new Date(filters.period + "-01T00:00:00Z");
      const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + 1);
      where.period_start_date = { lt: end };
      where.period_end_date = { gte: start };
    }
    const page = Number(filters.page ?? "1");
    const rows = await tx.charges.findMany({ where, select: selection, orderBy: [{ issued_on: "desc" }, { id: "asc" }], take: 25, skip: (page - 1) * 25 });
    const total = await tx.charges.count({ where });
    const planRows = await tx.billing_plans.findMany({ where: { AND: [scopeWhere(active)], frequency: "WEEKLY" },
      select: { id: true, season_id: true, club_id: true, season_team_id: true, amount: true, starts_at: true, ends_at: true, charge_concepts: { select: { code: true } } },
      orderBy: [{ starts_at: "desc" }, { id: "asc" }] });
    const createCatalog = await billingCatalog(tx, actor.id, "CREATE").catch(error => {
      if (error instanceof AuthorizationError) return [];
      throw error;
    });
    const plans: BillingPlan[] = planRows.map(row => {
      const season = selected.find(item => item.id === row.season_id)!;
      return { id: row.id, season, recipient: season.recipients.find(item => item.id === (row.club_id ?? row.season_team_id))!,
        concept: chargeConcept.parse(row.charge_concepts.code), amount: row.amount.toFixed(2), currency: "MXN",
        frequency: "WEEKLY", periodStart: iso(row.starts_at), periodEnd: row.ends_at ? iso(row.ends_at) : "", dueOn: iso(row.starts_at) };
    });
    return { filters: { ...filters, league }, league, leagues, seasons: selected, season: selected.find(item => item.id === filters.season),
      canCreate: createCatalog.length > 0, plans: plans.map(plan => ({ ...plan, canGenerate: createCatalog.some(item => item.id === plan.season.id && item.recipients.some(target => target.id === plan.recipient.id)) })),
      charges: rows.map(row => summary(row, selected)), total, page };
  }, { timeout: 15000 });
}
export async function getChargeCapture(query: BillingQuery) {
  const actor = await requireOperationalUser();
  const parsed = filtersSchema.safeParse(query);
  if (!parsed.success) throw new BillingError("INVALID_FILTERS");
  return getPrisma().$transaction(async tx => {
    const seasons = (await billingCatalog(tx, actor.id, "CREATE")).filter(season => !parsed.data.league || season.league === parsed.data.league);
    if (parsed.data.season && !seasons.some(item => item.id === parsed.data.season)) throw new AuthorizationError();
    return { status: "READY" as const, filters: parsed.data, seasons };
  });
}
export async function getChargeDetail(chargeId: string, query: BillingQuery = {}) {
  const actor = await requireOperationalUser();
  if (!z.uuid().safeParse(chargeId).success) return { status: "READ" as const, charge: undefined };
  return getPrisma().$transaction(async tx => {
    const row = await tx.charges.findUnique({ where: { id: chargeId }, select: selection });
    if (!row) return { status: "READ" as const, charge: undefined };
    await authorizeRecipient(tx, actor.id, "READ", row.season_id, recipientOf(row));
    const catalog = await billingCatalog(tx, actor.id);
    const history = await tx.audit_logs.findMany({ where: { table_name: "charges", entity_id: chargeId, action: { in: ["INSERT", "UPDATE", "DELETE"] } },
      select: { id: true, action: true, occurred_at: true, reason: true, previous_data: true, new_data: true, users: { select: { username: true } } },
      orderBy: [{ occurred_at: "desc" }, { id: "desc" }] });
    let canModify = true;
    try { await authorizeRecipient(tx, actor.id, "UPDATE", row.season_id, recipientOf(row)); }
    catch (error) { if (error instanceof AuthorizationError) canModify = false; else throw error; }
    const charge: ChargeDetail = {
      ...summary(row, catalog), issuedOn: iso(row.issued_on), billingPlanId: row.billing_plan_id ?? undefined,
      history: history.map(entry => ({ id: entry.id, at: entry.occurred_at.toISOString(), reason: entry.reason,
        actorLabel: entry.users ? "@" + entry.users.username : "Actor del historial", event: entry.action === "INSERT" ? "CREATED" : "UPDATED",
        change: historyChange(entry.previous_data, entry.new_data) })),
      canModify: canModify && !row.payments.length && !row.voided_at && !row.sanction_id,
      modificationBlocked: row.payments.length ? "La modificación está bloqueada porque el cargo tiene pagos asociados. El tratamiento se acordará con PDGLD-78." : undefined,
    };
    const parsed = filtersSchema.safeParse(query);
    return { status: "READ" as const, charge, filters: parsed.success ? parsed.data : {} };
  }, { timeout: 15000 });
}

function historyChange(previous: Prisma.JsonValue, next: Prisma.JsonValue) {
  const fields = z.object({ amount: z.union([z.string(), z.number()]), due_on: z.string() });
  const before = fields.safeParse(previous);
  const after = fields.safeParse(next);
  if (!before.success || !after.success) return undefined;
  const changes: string[] = [];
  if (String(before.data.amount) !== String(after.data.amount))
    changes.push(`Importe de ${new Prisma.Decimal(before.data.amount).toFixed(2)} a ${new Prisma.Decimal(after.data.amount).toFixed(2)} MXN.`);
  if (before.data.due_on !== after.data.due_on) changes.push(`Vencimiento de ${before.data.due_on.slice(0, 10)} a ${after.data.due_on.slice(0, 10)}.`);
  return changes.join(" ") || undefined;
}
