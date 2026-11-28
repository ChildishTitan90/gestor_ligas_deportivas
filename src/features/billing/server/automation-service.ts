import "server-only";
import { createHash } from "node:crypto";
import { Prisma, type billing_automation_policies } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { automationPolicySchema, type AutomationPolicyView, type AutomationPolicyInput } from "../automation";
import { authorizeRecipient, BillingError } from "./access";
import { billingDate, billingToday, insertAutomaticCharges, insertCharge } from "./charge-writer";

type Policy = billing_automation_policies;
type Kind = AutomationPolicyInput["kind"];
export function policyView(row: Policy): AutomationPolicyView {
  return { id: row.id, seasonId: row.season_id, kind: row.kind as Kind, revision: row.revision,
    enabled: row.enabled, amount: row.amount.toFixed(2), dueDays: row.due_days,
    firstMatchday: row.first_matchday, lastMatchday: row.last_matchday };
}
async function policyLock(tx: Prisma.TransactionClient, seasonId: string, kind: Kind) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`billing-policy:${seasonId}:${kind}`},0))::text`;
}
async function seasonLock(tx: Prisma.TransactionClient, seasonId: string) {
  // El programador ya toma temporada antes del partido. Mantener ese orden
  // también en configuración/Cron evita un ciclo temporada↔mandato.
  await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${seasonId}::uuid FOR SHARE`;
}
async function seasonAuthority(tx: Prisma.TransactionClient, actorId: string, seasonId: string, action: "CREATE" | "READ" | "UPDATE") {
  const grants = await assertPermission(tx, actorId, { module: "billing", action, context: { seasonId } });
  if (!grants.some(grant => !grant.clubId)) throw new AuthorizationError();
}
export async function saveAutomationPolicy(input: unknown) {
  const actor = await requireOperationalUser();
  return saveAutomationPolicyForActor(actor.id, input);
}
/** Entrada deliberada de servidor; actorId nunca procede del cuerpo HTTP. */
export async function saveAutomationPolicyForActor(actorId: string, input: unknown) {
  const data = automationPolicySchema.parse(input);
  const hash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    await seasonLock(tx, data.seasonId);
    await policyLock(tx, data.seasonId, data.kind);
    await seasonAuthority(tx, actorId, data.seasonId, "CREATE");
    const existing = await tx.billing_automation_policies.findUnique({ where: { id: data.operationId } });
    if (existing) {
      if (existing.created_by !== actorId || existing.request_hash !== hash) throw new BillingError("OPERATION_KEY_REUSED");
      if (existing.revision > 1) await seasonAuthority(tx, actorId, data.seasonId, "UPDATE");
      return policyView(existing);
    }
    const prior = await tx.billing_automation_policies.findFirst({ where: { season_id: data.seasonId, kind: data.kind }, orderBy: { revision: "desc" } });
    if (prior) await seasonAuthority(tx, actorId, data.seasonId, "UPDATE");
    if ((prior?.revision ?? 0) !== data.expectedRevision) throw new BillingError("VERSION_CONFLICT");
    const season = await tx.seasons.findUniqueOrThrow({ where: { id: data.seasonId }, select: { status: true } });
    if (season.status === "CLOSED") throw new BillingError("SEASON_CLOSED");
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${data.reason},true)`;
    const row = await tx.billing_automation_policies.create({ data: {
      id: data.operationId, season_id: data.seasonId, kind: data.kind, revision: data.expectedRevision + 1,
      enabled: data.enabled, amount: new Prisma.Decimal(data.amount), due_days: data.dueDays,
      first_matchday: data.firstMatchday, last_matchday: data.lastMatchday,
      created_by: actorId, reason: data.reason, request_hash: hash,
    } });
    if (data.kind === "REFEREE_MATCHDAY" && data.enabled) await chargeScheduledMatchesInTransaction(tx, data.seasonId);
    return policyView(row);
  }, { timeout: 15000 });
}

export async function readAutomationWorkspace() {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(async tx => {
    await lockAuthorization(tx);
    const seasons = await tx.seasons.findMany({ where: { leagues: { is_active: true } },
      select: { id: true, name: true, leagues: { select: { name: true } } }, orderBy: { start_date: "desc" } });
    const allowed = [];
    for (const season of seasons) {
      try {
        await seasonAuthority(tx, actor.id, season.id, "READ");
        await seasonAuthority(tx, actor.id, season.id, "CREATE");
        allowed.push({ id: season.id, name: season.name, league: season.leagues.name });
      }
      catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
    if (!allowed.length) throw new AuthorizationError();
    const policies = await tx.billing_automation_policies.findMany({ where: { season_id: { in: allowed.map(s => s.id) } }, orderBy: { revision: "desc" } });
    // La revisión muestra la configuración vigente; las revisiones anteriores son inmutables.
    const latest = policies.filter((p, i) => !policies.slice(0, i).some(prior => prior.season_id === p.season_id && prior.kind === p.kind));
    return { seasons: allowed, policies: latest.map(policyView) };
  });
}

async function mandateCharge(tx: Prisma.TransactionClient, policy: Policy, source: string,
  recipient: { kind: "CLUB"; clubId: string } | { kind: "TEAM"; seasonTeamId: string }, start: Date, end: Date) {
  // Revalidar el mandato vigente impide que Cron herede una autorización revocada.
  await seasonAuthority(tx, policy.created_by, policy.season_id, "CREATE");
  await authorizeRecipient(tx, policy.created_by, "CREATE", policy.season_id, recipient);
  const concept = await tx.charge_concepts.findUniqueOrThrow({ where: { code: policy.kind === "REFEREE_MATCHDAY" ? "REFEREE_FEE" : "REGISTRATION" }, select: { id: true } });
  const [settings] = await tx.$queryRaw<{ actor: string | null; reason: string | null }[]>`SELECT current_setting('app.user_id',true) actor,current_setting('app.reason',true) reason`;
  await tx.$queryRaw`SELECT set_config('app.user_id',${policy.created_by},true),set_config('app.reason',${`Automático: ${source}. Mandato ${policy.id}. ${policy.reason}`},true)`;
    const due = billingDate(await billingToday(tx));
    due.setUTCDate(due.getUTCDate() + policy.due_days);
    const result = await insertCharge(tx, policy.created_by, {
      season_id: policy.season_id, club_id: recipient.kind === "CLUB" ? recipient.clubId : null,
      season_team_id: recipient.kind === "TEAM" ? recipient.seasonTeamId : null,
      charge_concept_id: concept.id, amount: policy.amount, due_on: due,
      period_start_date: start, period_end_date: end, automation_source: source, automation_policy_id: policy.id,
    });
    await tx.$queryRaw`SELECT set_config('app.user_id',${settings.actor ?? ""},true),set_config('app.reason',${settings.reason ?? ""},true)`;
    return result;
}

/** Se ejecuta dentro de la aprobación/inscripción real y comparte su rollback. No cobra trámites anteriores a la habilitación. */
export async function chargeRegistrationInTransaction(tx: Prisma.TransactionClient, kind: "CLUB_AFFILIATION" | "TEAM_ENROLLMENT", id: string) {
  await lockAuthorization(tx);
  const event = kind === "CLUB_AFFILIATION"
    ? await tx.club_affiliations.findUnique({ where: { id }, select: { season_id: true, club_id: true, status: true, reviewed_at: true } })
    : await tx.season_teams.findUnique({ where: { id }, select: { season_id: true, club_id: true, status: true, enrolled_at: true } });
  if (!event) throw new BillingError("CONTEXT_CHANGED");
  await seasonLock(tx, event.season_id);
  await policyLock(tx, event.season_id, kind);
  const policy = await tx.billing_automation_policies.findFirst({ where: { season_id: event.season_id, kind }, orderBy: { revision: "desc" } });
  const at = "reviewed_at" in event ? event.reviewed_at : event.enrolled_at;
  // Solo lo llaman las transiciones nuevas; sus recuperaciones retornan antes del hook.
  // No comparar relojes Node/PostgreSQL para decidir si un trámite recién confirmado cobra.
  if (!policy?.enabled || !at || event.status !== (kind === "CLUB_AFFILIATION" ? "APPROVED" : "REGISTERED")) return null;
  const season = await tx.seasons.findUniqueOrThrow({ where: { id: event.season_id }, select: { start_date: true, end_date: true, status: true } });
  if (season.status === "CLOSED") return null;
  return mandateCharge(tx, policy, `${kind}:${id}`, kind === "CLUB_AFFILIATION"
    ? { kind: "CLUB", clubId: event.club_id } : { kind: "TEAM", seasonTeamId: id }, season.start_date, season.end_date);
}

/** Una cuota por equipo/jornada, aunque haya varios partidos; descanso y DRAFT no producen deuda. */
export async function chargeScheduledMatchesInTransaction(tx: Prisma.TransactionClient, seasonId: string, proposalId?: string, matchId?: string) {
  await lockAuthorization(tx);
  await seasonLock(tx, seasonId);
  await policyLock(tx, seasonId, "REFEREE_MATCHDAY");
  const policies = await tx.billing_automation_policies.findMany({ where: { season_id: seasonId, kind: "REFEREE_MATCHDAY" }, orderBy: { revision: "desc" } });
  if (!policies.length) return { created: 0, existing: 0 };
  const season = await tx.seasons.findUniqueOrThrow({ where: { id: seasonId }, select: { status: true } });
  if (season.status === "CLOSED") return { created: 0, existing: 0 };
  const matches = await tx.matches.findMany({ where: { season_id: seasonId, deleted_at: null, stage_id: null,
    starts_at: { not: null }, venue_id: { not: null }, match_statuses: { code: { in: ["SCHEDULED", "CONFIRMED", "RESCHEDULED"] } },
    ...(matchId ? { id: matchId } : {}),
    ...(proposalId ? { schedule_proposal_id: proposalId } : {}) },
    select: { home_team_id: true, away_team_id: true, group_id: true, matchday_id: true,
      matchdays: { select: { number: true, start_date: true, end_date: true } },
      groups: { select: { season_category_id: true } } }, orderBy: [{ matchday_id: "asc" }, { id: "asc" }] });
  const stages = await tx.competition_stages.findMany({ where: { season_id: seasonId }, select: { season_category_id: true, format: true } });
  const playoffCategories = new Set(stages.filter(stage =>
    typeof stage.format === "object" && stage.format !== null && !Array.isArray(stage.format) && stage.format.kind === "PLAYOFF_8")
    .map(stage => stage.season_category_id));
  const existing = new Set((await tx.charges.findMany({ where: { season_id: seasonId, automation_source: { not: null } }, select: { automation_source: true } })).map(row => row.automation_source));
  const seen = new Set<string>();
  const batches = new Map<Policy, { source: string; team: string; start: Date; end: Date }[]>();
  const result = { created: 0, existing: 0 };
  for (const match of matches) {
    if (playoffCategories.has(match.groups.season_category_id)) continue;
    const policy = policies.find(p => p.first_matchday <= match.matchdays.number);
    if (!policy?.enabled || match.matchdays.number > policy.last_matchday) continue;
    for (const team of [match.home_team_id, match.away_team_id].sort()) {
      const source = `REFEREE_MATCHDAY:${seasonId}:${match.matchday_id}:${team}`;
      if (seen.has(source)) continue;
      seen.add(source);
      if (existing.has(source)) {
        result.existing++; continue;
      }
      const tasks = batches.get(policy) ?? [];
      tasks.push({ source, team, start: match.matchdays.start_date, end: match.matchdays.end_date });
      batches.set(policy, tasks);
    }
  }
  for (const [policy, tasks] of batches) {
    await seasonAuthority(tx, policy.created_by, seasonId, "CREATE");
    for (const team of [...new Set(tasks.map(task => task.team))].sort())
      await authorizeRecipient(tx, policy.created_by, "CREATE", seasonId, { kind: "TEAM", seasonTeamId: team });
    const concept = await tx.charge_concepts.findUniqueOrThrow({ where: { code: "REFEREE_FEE" }, select: { id: true } });
    const due = billingDate(await billingToday(tx)); due.setUTCDate(due.getUTCDate() + policy.due_days);
    const [settings] = await tx.$queryRaw<{ actor: string | null; reason: string | null }[]>`SELECT current_setting('app.user_id',true) actor,current_setting('app.reason',true) reason`;
    await tx.$queryRaw`SELECT set_config('app.user_id',${policy.created_by},true),set_config('app.reason',${`Arbitraje automático. Mandato ${policy.id}. ${policy.reason}`},true)`;
      const written = await insertAutomaticCharges(tx, policy.created_by, tasks.map(task => ({
        season_id: seasonId, club_id: null, season_team_id: task.team, charge_concept_id: concept.id,
        amount: policy.amount, due_on: due, period_start_date: task.start, period_end_date: task.end,
        automation_source: task.source, automation_policy_id: policy.id,
      })));
      result.created += written.created; result.existing += written.existing;
      await tx.$queryRaw`SELECT set_config('app.user_id',${settings.actor ?? ""},true),set_config('app.reason',${settings.reason ?? ""},true)`;
  }
  return result;
}

/** Reconciliación programada: no inventa periodos ni cambia cargos. Cada temporada es atómica y reintentable. */
export async function reconcileBillingAutomation() {
  const seasons = await getPrisma().billing_automation_policies.findMany({ where: { kind: "REFEREE_MATCHDAY" }, distinct: ["season_id"], select: { season_id: true } });
  let created = 0, failed = 0;
  for (const season of seasons) {
    try {
      const result = await getPrisma().$transaction(tx => chargeScheduledMatchesInTransaction(tx, season.season_id), { timeout: 20000 });
      created += result.created;
    } catch { failed++; }
  }
  return { created, failed };
}
