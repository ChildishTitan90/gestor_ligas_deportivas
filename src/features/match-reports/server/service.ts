import { capturedScore } from "../score";
import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { AuthorizationError, getPermissionGrants } from "@/server/auth/authorization";
import { evaluateAuthorizedMatchInTransaction } from "@/features/matches/server/eligibility";
import { draftSchema, reportCommandSchema, ReportError, unsignedDraft, type ReportCommand, type ReportDraft, type ReportReceipt } from "../contract";
import { assertCaptureState, readCaptureMatchIds, reportAccess, reportReadAccess } from "./access";
import { applyConfirmationEffects, getConfirmationAvailability, getConfirmationEffects } from "./confirmation-effects";
import { validateSignatureReferences } from "./signatures";
import { buildPresentation, readMatchLabels } from "./queries";
import { currentPitch, dismissalEvents, formationLines, formationSlots, keeperKit, participationPeriods } from "../tactics";
import { lineupSealIssues, lineupFingerprint } from "../lineup-rules";
import { readLineupLock } from "./lineup-lock";
import { advanceMatchClock, breakEventError, matchClockSchema, type MatchClock } from "../match-clock";
import { startReportMatchInTransaction } from "@/features/matches/server/report-start";
import { invalidCaptainTransitions } from "../captaincy";
import { participationTimesSchema } from "@/features/matches/eligibility";

export const digest = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const signatureBinding = (draft: ReportDraft): string => digest(unsignedDraft(draftSchema.parse(draft)));

export async function mutateReport(actorId: string, input: unknown): Promise<ReportReceipt> {
  const parsed = reportCommandSchema.safeParse(input);
  if (!parsed.success) throw new ReportError("INVALID_PAYLOAD", 400);
  return getPrisma().$transaction(tx => mutateReportInTransaction(tx, actorId, parsed.data), { timeout: 30000 });
}

export async function mutateReportInTransaction(tx: Prisma.TransactionClient, actorId: string, command: ReportCommand): Promise<ReportReceipt> {
  const existing = await tx.match_reports.findUnique({ where: { match_id: command.matchId }, select: { id: true } });
  let match = await reportAccess(tx, actorId, command.matchId, existing ? "UPDATE" : "CREATE");
  if (!existing && await tx.match_reports.findUnique({ where: { match_id: match.id }, select: { id: true } })) await reportAccess(tx, actorId, match.id, "UPDATE");
  const hash = digest(command);
  const previous = await tx.match_report_syncs.findUnique({ where: { client_id: command.operationId } });
  if (previous) {
    const payload = previous.private_payload as unknown as { hash: string; receipt: ReportReceipt };
    if (previous.user_id !== actorId || payload.hash !== hash || payload.receipt.matchId !== command.matchId) throw new ReportError("OPERATION_KEY_REUSED");
    return payload.receipt;
  }
  assertCaptureState(match);
  const current = await tx.match_reports.findUnique({ where: { match_id: match.id } });
  if (match.version !== command.expectedMatchVersion || (current?.version ?? 0) !== command.expectedReportVersion) throw new ReportError("STALE_VERSION");
  if (current && current.status !== "DRAFT") throw new ReportError("REPORT_LOCKED");
  const sealed = current ? await readLineupLock(tx, current.id) : null;
  const storedClock = (current?.draft_data as { clock?: unknown } | undefined)?.clock;
  let clock: MatchClock | null = null;
  if (storedClock) { const parsed = matchClockSchema.safeParse(storedClock); if (!parsed.success) throw new ReportError("CLOCK_EVIDENCE_UNAVAILABLE"); clock = parsed.data; }
  const evaluation = await evaluateAuthorizedMatchInTransaction(tx, match);
  const draft = command.draft;
  const breakProblem = breakEventError(clock, (current?.draft_data as { draft?: ReportDraft } | undefined)?.draft?.events ?? [], draft.events);
  if (breakProblem) throw new ReportError(breakProblem, 400);
  for (const event of draft.events) {
    if (event.periodMinute !== undefined && (!clock || ![1, 2].includes(event.periodNumber ?? 0) || event.minute !== event.periodMinute + (event.periodNumber === 2 ? clock.halfMinutes : 0))) throw new ReportError("INVALID_EVENT_CLOCK_TIME", 400);
  }
  const selected = draft.lineups.filter(row => row.selected);
  if (match.match_statuses.code === "CONFIRMED" && (draft.events.length || draft.lineups.some(r => r.periods.length) || draft.score.home !== null || draft.score.away !== null || Object.values(draft.signatures).some(Boolean))) throw new ReportError("PREMATCH_LINEUPS_ONLY", 400);
  for (const row of selected) {
    const player = evaluation.players.find(player => player.registrationId === row.playerId && player.seasonTeamId === row.teamId);
    if (!player?.eligible) throw new ReportError("PLAYER_NOT_ELIGIBLE");
    if (row.matchJersey === null) throw new ReportError("JERSEY_REQUIRED", 400);
  }
  for (const teamId of [match.home_team_id, match.away_team_id]) {
    const jerseys = selected.filter(row => row.teamId === teamId).map(row => row.matchJersey);
    if (new Set(jerseys).size !== jerseys.length) throw new ReportError("DUPLICATE_JERSEY", 400);
    if (selected.filter(row => row.teamId === teamId && row.starter).length > 11) throw new ReportError("TOO_MANY_STARTERS", 400);
  }
  for (const [teamId, tactics] of Object.entries(draft.tactics ?? {})) {
    if (![match.home_team_id, match.away_team_id].includes(teamId)) throw new ReportError("TACTICS_TEAM_OUT_OF_SCOPE", 400);
    const assigned = tactics.slots.flatMap(s => s.playerId ? [s.playerId] : []);
    const starters = selected.filter(r => r.teamId === teamId && r.starter);
    if (starters.length !== assigned.length || starters.some(r => !assigned.includes(r.playerId))) throw new ReportError("TACTICS_LINEUP_MISMATCH", 400);
    if (tactics.formation === "CUSTOM" && tactics.customFormation && !formationLines(tactics.customFormation)) throw new ReportError("INVALID_FORMATION", 400);
    if (tactics.kit && JSON.stringify(keeperKit(tactics).primary) === JSON.stringify(tactics.kit.primary)) throw new ReportError("KEEPER_KIT_CONFLICT", 400);
  }
  if (sealed && lineupFingerprint(draft) !== sealed.fingerprint) throw new ReportError("LINEUPS_LOCKED");
  if (command.kind === "lock-lineups" && !sealed) {
    const preview = await buildPresentation(tx, match, current ?? { id: match.id, version: 0, status: "DRAFT", confirmed_at: null }, draft, evaluation);
    if (lineupSealIssues(preview, preview.report).length) throw new ReportError("LINEUPS_INCOMPLETE", 400);
  }
  if (command.kind === "clock") {
    if (!sealed) throw new ReportError("LINEUPS_NOT_LOCKED");
    try { clock = advanceMatchClock(clock, command.clockAction!, new Date().toISOString()); }
    catch (error) { throw new ReportError(error instanceof Error ? error.message : "CLOCK_PHASE_CONFLICT"); }
    if (command.clockAction?.type === "start") {
      const started = await startReportMatchInTransaction(tx, actorId, match, command.operationId);
      if (started) match = { ...match, ...started };
    }
  }
  for (const teamId of [match.home_team_id, match.away_team_id]) {
    const starters = selected.filter(row => row.teamId === teamId && row.starter);
    const slots = draft.tactics?.[teamId]?.slots ?? formationSlots("4-4-2").map((slot, index) => ({ ...slot, playerId: starters[index]?.playerId ?? null }));
    if (currentPitch(slots, draft.events, teamId).problems.length) throw new ReportError("INVALID_SUBSTITUTION_ORDER", 400);
    if (invalidCaptainTransitions(draft.captains[teamId], slots, draft.events, teamId)) throw new ReportError("REPLACEMENT_CAPTAIN_REQUIRED", 400);
  }
  for (const [teamId, captainId] of Object.entries(draft.captains)) {
    if (![match.home_team_id, match.away_team_id].includes(teamId) || !selected.some(row => row.teamId === teamId && row.playerId === captainId)) throw new ReportError("INVALID_CAPTAIN", 400);
  }
  const sport = await tx.seasons.findUniqueOrThrow({ where: { id: match.season_id }, select: { sport_id: true } });
  const catalogue = await tx.event_types.findMany({ where: { sport_id: sport.sport_id } });
  for (const event of draft.events) {
    const type = catalogue.find(type => type.code === event.typeCode);
    if (!type || (event.teamId && ![match.home_team_id, match.away_team_id].includes(event.teamId))) throw new ReportError("INVALID_EVENT", 400);
    const playerRequired = ["GOAL", "OWN_GOAL", "ASSIST", "CAUTION", "SENDING_OFF", "SUBSTITUTION", "INJURY"].includes(type.code);
    if (playerRequired && (!event.teamId || !event.playerId)) throw new ReportError("EVENT_PLAYER_REQUIRED", 400);
    if (type.requires_disciplinary_case && !event.description.trim()) throw new ReportError("INCIDENT_DESCRIPTION_REQUIRED", 400);
    for (const id of [event.playerId, event.outgoingPlayerId, event.replacementCaptainId].filter(Boolean)) {
      if (!selected.some(row => row.playerId === id && row.teamId === event.teamId)) throw new ReportError("EVENT_PLAYER_OUT_OF_SCOPE", 400);
    }
    if (type.code === "SUBSTITUTION" && (!event.outgoingPlayerId || event.outgoingPlayerId === event.playerId)) throw new ReportError("INVALID_SUBSTITUTION", 400);
    if (event.replacementCaptainId && !["SUBSTITUTION", "CAUTION", "SENDING_OFF"].includes(type.code)) throw new ReportError("INVALID_CAPTAIN", 400);
    if (type.code !== "SUBSTITUTION" && event.outgoingPlayerId) throw new ReportError("INVALID_EVENT", 400);
  }
  for (const side of ["home","away"] as const) {
    const goals = capturedScore(draft.events,match.home_team_id,match.away_team_id)[side];
    if (draft.score[side] !== null && draft.score[side] !== goals) throw new ReportError("SCORE_EVENTS_MISMATCH", 400);
  }
  if (!sealed && command.kind !== "lock-lineups" && (draft.events.length || command.kind === "confirm")) throw new ReportError("LINEUPS_NOT_LOCKED");
  await validateSignatureReferences(tx, actorId, match, draft);
  if (command.kind === "confirm" && clock && clock.phase !== "ENDED") throw new ReportError("CLOCK_STILL_RUNNING");
  if (command.kind === "confirm" && ([match.home_team_id, match.away_team_id].some(id => !draft.captains[id] || !draft.signatures[id]) || draft.score.home === null || draft.score.away === null)) throw new ReportError("INCOMPLETE_REPORT", 400);
  const effects = command.kind === "confirm" ? getConfirmationEffects() : null;
  // Sin receptores efectivos no se escribe ningún efecto de confirmación, ni siquiera el borrador.
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','Captura online de cédula',true)`;
  const report = current
    ? await tx.match_reports.update({ where: { id: current.id }, data: { version: { increment: 1 }, home_captain_signature_file_id: draft.signatures[match.home_team_id] ?? null, away_captain_signature_file_id: draft.signatures[match.away_team_id] ?? null, remarks: draft.remarks } })
    : await tx.match_reports.create({ data: { match_id: match.id, client_id: command.operationId, captured_by: actorId, source: "MOBILE", remarks: draft.remarks, home_captain_signature_file_id: draft.signatures[match.home_team_id] ?? null, away_captain_signature_file_id: draft.signatures[match.away_team_id] ?? null } });
  const old = await tx.lineups.findMany({ where: { match_report_id: report.id }, select: { id: true } });
  await tx.match_events.deleteMany({ where: { match_report_id: report.id } });
  await tx.player_period_participations.deleteMany({ where: { lineup_id: { in: old.map(row => row.id) } } });
  await tx.lineups.deleteMany({ where: { match_report_id: report.id } });
  const lineups = new Map<string, string>();
  for (const row of selected) {
    const lineup = await tx.lineups.create({ data: { match_report_id: report.id, registration_id: row.playerId, season_team_id: row.teamId, jersey_number: row.matchJersey, is_starter: row.starter, is_captain: draft.captains[row.teamId] === row.playerId, validated_by: actorId } });
    lineups.set(row.playerId, lineup.id);
    const periods = participationTimesSchema.safeParse(participationPeriods(row, draft.events));
    if (!periods.success) throw new ReportError("INVALID_PARTICIPATION_TIMES", 400);
    if (periods.data.length) await tx.player_period_participations.createMany({ data: periods.data.map(p => ({ lineup_id: lineup.id, period_number: p.periodNumber, entry_minute: p.entryMinute, exit_minute: p.exitMinute })) });
  }
  // Proyección SQL explícita, incluida la precisión adicional. No depende de
  // que un proceso next dev anterior haya recargado los delegados generados.
  for (const event of draft.events) await tx.$executeRaw`
    INSERT INTO sports_management.match_events(id,match_report_id,event_type_id,season_team_id,lineup_id,outgoing_lineup_id,period_number,minute,second,description)
    VALUES (${event.id}::uuid,${report.id}::uuid,${catalogue.find(type => type.code === event.typeCode)!.id}::uuid,${event.teamId}::uuid,${event.playerId ? lineups.get(event.playerId) ?? null : null}::uuid,${event.outgoingPlayerId ? lineups.get(event.outgoingPlayerId) ?? null : null}::uuid,${event.periodNumber},${event.minute},${event.second ?? null}::smallint,${event.description})`;

  const presentation = await buildPresentation(tx, match, report, draft, evaluation);
  const lineupsLock = sealed?.lock ?? (command.kind === "lock-lineups" ? { operationId: command.operationId, lockedAt: new Date().toISOString() } : undefined);
  if (lineupsLock) presentation.report.lineupsLock = lineupsLock;
  if (clock) presentation.report.clock = clock;
  await tx.match_reports.update({ where: { id: report.id }, data: { draft_data: { formatVersion: 1, draft, presentation, ...(clock ? { clock } : {}) } as unknown as Prisma.InputJsonValue } });
  const receipt: ReportReceipt = effects ? await applyConfirmationEffects(tx, { actorId, matchId: match.id, reportId: report.id, operationId: command.operationId, expectedMatchVersion: match.version, homeScore: draft.score.home!, awayScore: draft.score.away!, eventIds: draft.events.map(e => e.id), dismissals: dismissalEvents(draft.events).map(e => ({ eventId: e.id, playerId: e.playerId!, teamId: e.teamId!, reason: e.typeCode === "CAUTION" ? "SECOND_CAUTION" : "DIRECT_RED" })) }, effects)
    : { formatVersion: 1, operationId: command.operationId, matchId: match.id, reportId: report.id, reportVersion: report.version, matchVersion: match.version, status: "DRAFT", ...(lineupsLock ? { lineupsLock } : {}), ...(clock ? { clock } : {}) };
  await tx.match_report_syncs.create({ data: { client_id: command.operationId, match_report_id: report.id, user_id: actorId, base_version: command.expectedReportVersion, status: "APPLIED", private_payload: { hash, command, receipt } as unknown as Prisma.InputJsonValue } });
  return receipt;
}

export async function readReportOperation(actorId: string, matchId: string, operationId: string) {
  return getPrisma().$transaction(async tx => {
    await reportAccess(tx, actorId, matchId, "CREATE");
    const row = await tx.match_report_syncs.findUnique({ where: { client_id: operationId } });
    if (!row) return { status: "UNKNOWN" as const };
    const payload = row.private_payload as unknown as { receipt: ReportReceipt };
    if (row.user_id !== actorId || payload.receipt.matchId !== matchId) throw new AuthorizationError();
    return { status: "APPLIED" as const, receipt: payload.receipt };
  }, { timeout: 30000 });
}

export async function getReportPage(actorId: string, matchId: string) {
  return getPrisma().$transaction(async tx => {
    const match = await reportReadAccess(tx, actorId, matchId);
    const report = await tx.match_reports.findUnique({ where: { match_id: match.id } });
    if (!report && (match.match_statuses.code === "FINISHED" || match.season.status === "CLOSED")) throw new ReportError("HISTORICAL_EVIDENCE_UNAVAILABLE");
    if (report && (report.status !== "DRAFT" || match.season.status === "CLOSED" || match.match_statuses.code === "FINISHED")) {
      const stored = report.draft_data as unknown as { presentation?: import("../types").ReportDemoData };
      if (!stored.presentation) throw new ReportError("HISTORICAL_EVIDENCE_UNAVAILABLE", 409);
      stored.presentation.match.status = { code: match.match_statuses.code, label: match.match_statuses.name, captureAllowed: false };
      stored.presentation.match.version = match.version;
      stored.presentation.confirmation = getConfirmationAvailability();
      return stored.presentation;
    }
    try { await reportAccess(tx, actorId, matchId, "CREATE"); }
    catch (error) {
      if (!(error instanceof AuthorizationError)) throw error;
      const stored = report?.draft_data as unknown as { presentation?: import("../types").ReportDemoData } | undefined;
      if (!stored?.presentation) throw new AuthorizationError();
      stored.presentation.match.status = { code: match.match_statuses.code, label: match.match_statuses.name, captureAllowed: false };
      stored.presentation.match.version = match.version;
      stored.presentation.confirmation = getConfirmationAvailability();
      return stored.presentation;
    }
    const evaluation = await evaluateAuthorizedMatchInTransaction(tx, match);
    const stored = report?.draft_data as unknown as { draft?: ReportDraft } | undefined;
    const draft: ReportDraft = stored?.draft ?? { lineups: [], captains: {}, events: [], score: { home: null, away: null }, remarks: "", incidents: "", signatures: {} };
    return buildPresentation(tx, match, report ?? { id: match.id, version: 0, status: "DRAFT", confirmed_at: null }, draft, evaluation);
  }, { timeout: 30000 });
}

export async function getCaptureMatches(actorId: string) {
  return getPrisma().$transaction(async tx => {
    const candidates = await readCaptureMatchIds(tx, actorId);
    const matches = [];
    for (const candidate of candidates) {
      try { const match = await reportAccess(tx, actorId, candidate.id); matches.push({ id: match.id, number: match.number, status: match.match_statuses.name, statusCode: match.match_statuses.code, startsAt: match.starts_at?.toISOString() ?? null, ...(await readMatchLabels(tx, match)) }); }
      catch (error) { if (!(error instanceof AuthorizationError)) throw error; }
    }
    return matches;
  }, { timeout: 30000 });
}

export async function canUseReportWorkspace(actorId: string) {
  return getPrisma().$transaction(async tx => (await getPermissionGrants(tx, actorId, "match-reports", "CREATE")).length > 0);
}
