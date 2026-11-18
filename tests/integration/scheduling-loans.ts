import sharp from "sharp";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { getPrisma } from "../../src/server/db/prisma";
import type { PrivateDocumentTransport } from "../../src/server/files/private-document-storage";
import { cleanCancelledVenueLoanFiles } from "../../src/features/venues/server/loan-cleanup";
import { submitVenueLoanForActor, decideVenueLoanForActor, resolveLegacyVenueLoanForActor } from "../../src/features/venues/server/loans";
import { generateScheduleForActor } from "../../src/features/scheduling/server/service";

export async function verifySchedulingLoans(f: { actor: string; outsider: string; season: string; category: string; group_id: string }) {
  const db = getPrisma();
  const clubs = await db.clubs.findMany({ orderBy: { id: "asc" } });
  const venues = await db.venues.findMany({ include: { venue_availability: true } });
  await db.venues.updateMany({ data: { is_league_sports_complex: false, owner_club_id: clubs[0].id } });
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${f.actor}, true), set_config('app.reason', 'Permisos sinteticos de prestamos', true)`;
  for (const [code, action, actor] of [
    ["EXECUTIVE_PRESIDENT", "APPROVE", f.actor], ["CLUB_DELEGATE", "CREATE", f.outsider],
  ] as const) {
    const role = await tx.roles.findUniqueOrThrow({ where: { code } });
    const permission = await tx.permissions.findFirst({ where: { module: "venues", action } })
      ?? await tx.permissions.create({ data: { module: "venues", action } });
    await tx.role_permissions.createMany({ data: [{ role_id: role.id, permission_id: permission.id, context_only: true }], skipDuplicates: true });
    for (const club of code === "CLUB_DELEGATE" ? clubs : [clubs[0]]) {
      await tx.user_roles.create({ data: { user_id: actor, role_id: role.id, league_id: club.league_id,
        club_id: code === "CLUB_DELEGATE" ? club.id : null,
        delegate_position: code === "CLUB_DELEGATE" ? "PRIMARY" : null } });
    }
  }
  });
  const files = new Map<string, Uint8Array>();
  const storage: PrivateDocumentTransport = {
    async put(key, { bytes }) { files.set(key, bytes); return { replayed: false }; },
    async read(key) { const bytes = files.get(key); assert.ok(bytes); return bytes; },
    async remove(key) { files.delete(key); },
    async createDownloadUrl() { return { downloadUrl: "https://example.test/carta", expiresInSeconds: 60 }; },
  };
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Carta sintetica para generacion integrada");
  const attachment = { bytes: await pdf.save(), mimeType: "application/pdf", signature: await sharp({ create: { width: 20, height: 20, channels: 3, background: "#000000" } }).png().toBuffer() };
  const run = () => generateScheduleForActor(f.actor, { seasonId: f.season, categoryId: f.category,
    groupId: f.group_id, operationId: randomUUID(), expectedSeasonVersion: 1, reason: "Prueba integrada de prestamos" });
  const initialCount = await db.schedule_proposals.count();
  const unavailable = async () => {
    const result = await run();
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NO_AVAILABLE_SLOT");
    assert.equal(await db.schedule_proposals.count(), initialCount);
  };
  await unavailable();
  const requests = [];
  for (const club of clubs) {
    for (const venue of venues) {
      const request = { requestId: randomUUID(), seasonId: f.season, clubId: club.id, venueId: venue.id,
        windows: venue.venue_availability.map(window => ({ startsAt: window.starts_at.toISOString(), endsAt: window.ends_at.toISOString() })) };
      await submitVenueLoanForActor(f.outsider, request, attachment, storage);
      requests.push(request);
    }
  }
  await unavailable();
  const example = requests[0];
  await assert.rejects(
    submitVenueLoanForActor(f.outsider, { ...example, requestId: randomUUID() },
      { bytes: attachment.bytes, mimeType: attachment.mimeType }, storage),
    { message: "SIGNATURE_REQUIRED" },
  );
  const resolution = await resolveLegacyVenueLoanForActor(f.outsider, {
    requestId: example.requestId, clubId: example.clubId, seasonId: example.seasonId,
  }, storage);
  assert.equal(resolution.outcome, "registered");
  const cancelledId = randomUUID();
  const cancelled = await resolveLegacyVenueLoanForActor(f.outsider, {
    requestId: cancelledId, clubId: example.clubId, seasonId: example.seasonId,
  }, storage);
  assert.equal(cancelled.outcome, "cancelled");
  await assert.rejects(
    submitVenueLoanForActor(f.outsider, { ...example, requestId: cancelledId }, attachment, storage),
    { message: "REQUEST_CANCELLED" },
  );
  const retryCleanupId = randomUUID();
  const failingStorage: PrivateDocumentTransport = {
    ...storage,
    async remove() { throw new Error("SYNTHETIC_STORAGE_UNAVAILABLE"); },
  };
  await assert.rejects(resolveLegacyVenueLoanForActor(f.outsider, {
    requestId: retryCleanupId, clubId: example.clubId, seasonId: example.seasonId,
  }, failingStorage), { message: "SYNTHETIC_STORAGE_UNAVAILABLE" });
  const retriedCleanup = await resolveLegacyVenueLoanForActor(f.outsider, {
    requestId: retryCleanupId, clubId: example.clubId, seasonId: example.seasonId,
  }, storage);
  assert.equal(retriedCleanup.outcome, "cancelled");
  await assert.rejects(
    submitVenueLoanForActor(f.outsider, { ...example, requestId: retryCleanupId }, attachment, storage),
    { message: "REQUEST_CANCELLED" },
  );
  let releaseUpload!: () => void;
  let uploadStarted!: () => void;
  const started = new Promise<void>(resolve => { uploadStarted = resolve; });
  const continueUpload = new Promise<void>(resolve => { releaseUpload = resolve; });
  const delayedStorage: PrivateDocumentTransport = {
    ...storage,
    async put(key, value) {
      uploadStarted();
      await continueUpload;
      return storage.put(key, value);
    },
  };
  const racingId = randomUUID();
  const pending = submitVenueLoanForActor(f.outsider, { ...example, requestId: racingId }, attachment, delayedStorage);
  await started;
  try {
    const racingResolution = await resolveLegacyVenueLoanForActor(f.outsider, {
      requestId: racingId, clubId: example.clubId, seasonId: example.seasonId,
    }, storage);
    assert.equal(racingResolution.outcome, "cancelled");
  } finally {
    releaseUpload();
  }
  await assert.rejects(pending, { message: "REQUEST_CANCELLED" });
  assert.equal(await db.venue_loans.count({ where: { id: racingId } }), 0);
  assert.equal([...files.keys()].some(key => key.endsWith(racingId)), false);
  const pendingCleanup = await db.audit_logs.findFirstOrThrow({ where: {
    action: "VENUE_LOAN_CLEANUP_SCHEDULED", entity_id: racingId,
  } });
  const cleanupContext = pendingCleanup.new_data as { leagueId: string; seasonId: string; clubId: string };
  const staleKey = `venue-loan-letters/v1/${cleanupContext.leagueId}/${cleanupContext.seasonId}/${cleanupContext.clubId}/${f.outsider}/${racingId}`;
  files.set(staleKey, attachment.bytes);
  await assert.rejects(cleanCancelledVenueLoanFiles(storage, f.outsider), { message: "FORBIDDEN" });
  const authorizedCleanup = await cleanCancelledVenueLoanFiles(storage, f.actor);
  assert.equal(authorizedCleanup.failed, 0);
  assert.equal(files.has(staleKey), false);
  files.set(staleKey, attachment.bytes);
  const failedCleanup = await cleanCancelledVenueLoanFiles(failingStorage);
  assert.ok(failedCleanup.failed > 0);
  assert.equal(files.has(staleKey), true);
  const cleanupResult = await cleanCancelledVenueLoanFiles(storage);
  assert.equal(cleanupResult.failed, 0);
  assert.equal(files.has(staleKey), false);
  assert.equal(await db.venue_loans.count({ where: { id: example.requestId } }), 1);
  files.set(staleKey, attachment.bytes);
  assert.equal((await cleanCancelledVenueLoanFiles(storage)).failed, 0);
  assert.equal(files.has(staleKey), false);
  const recovered = await submitVenueLoanForActor(f.outsider, example, attachment, storage);
  assert.equal(recovered.id, example.requestId);
  const signedDocument = await PDFDocument.load([...files.values()][0]);
  assert.equal(signedDocument.getPageCount(), 2);
  const changedSignature = await sharp({ create: { width: 20, height: 20, channels: 3, background: "#ffffff" } }).png().toBuffer();
  await assert.rejects(
    submitVenueLoanForActor(f.outsider, example, { ...attachment, signature: changedSignature }, storage),
    { message: "REQUEST_CONFLICT" },
  );
  for (const request of requests) {
    await decideVenueLoanForActor(f.actor, { requestId: request.requestId, status: "REJECTED", reason: "Rechazo sintetico de prueba" });
  }
  await unavailable();
  for (const request of requests) {
    const requestId = randomUUID();
    await submitVenueLoanForActor(f.outsider, { ...request, requestId }, attachment, storage);
    await decideVenueLoanForActor(f.actor, { requestId, status: "APPROVED", reason: "Autorizacion sintetica de prueba" });
  }
  const result = await run();
  assert.ok(result.ok);
  const proposal = await db.schedule_proposals.findUniqueOrThrow({ where: { id: result.proposalId } });
  const matches = (proposal.parameters as { matches: { venueId: string; start: string; reservedUntil: string }[] }).matches;
  assert.equal(matches.length, 190);
  for (const match of matches) {
    const venue = venues.find(value => value.id === match.venueId);
    assert.ok(venue);
    assert.ok(venue.venue_availability.some(window =>
      +window.starts_at <= Date.parse(match.start) && Date.parse(match.reservedUntil) <= +window.ends_at));
  }
  assert.equal(await db.matches.count(), 0);
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${f.actor}, true), set_config('app.reason', 'Regla sintetica de jornadas finales', true)`;
    const rule = await tx.competition_rules.create({ data: { season_id: f.season, version_number: 2 } });
    await tx.competition_rule_parameters.create({ data: {
      competition_rule_id: rule.id, parameter_key: "calendar", validated_by: f.actor,
      parameter_value: { rounds: 1, matchDurationMinutes: 90, complexOnlyFinalRounds: 1,
        scheduling: { slotStepMinutes: 30, venueStages: [] } },
    } });
    await tx.competition_rules.update({ where: { id: rule.id }, data: {
      status: "APPROVED", approved_by: f.actor, approved_at: new Date(),
    } });
    await tx.season_categories.update({ where: { id: f.category }, data: { competition_rule_id: rule.id } });
  });
  const finalRound = await run();
  assert.equal(finalRound.ok, false);
  if (!finalRound.ok) {
    assert.equal(finalRound.code, "NO_AVAILABLE_SLOT");
    assert.ok(finalRound.conflicts.some(match => match.round === 19));
    assert.ok(finalRound.conflicts.every(match => match.round === 19));
  }
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${f.actor}, true), set_config('app.reason', 'Tramo sintetico incompatible', true)`;
    await tx.venues.update({ where: { id: venues[0].id }, data: { is_league_sports_complex: true } });
    const rule = await tx.competition_rules.create({ data: { season_id: f.season, version_number: 3 } });
    await tx.competition_rule_parameters.create({ data: {
      competition_rule_id: rule.id, parameter_key: "calendar", validated_by: f.actor,
      parameter_value: { rounds: 1, matchDurationMinutes: 90, complexOnlyFinalRounds: 1,
        scheduling: { slotStepMinutes: 30, venueStages: [
          { fromRound: 19, toRound: 19, venueIds: [venues[1].id] },
        ] } },
    } });
    await tx.competition_rules.update({ where: { id: rule.id }, data: {
      status: "APPROVED", approved_by: f.actor, approved_at: new Date(),
    } });
    await tx.season_categories.update({ where: { id: f.category }, data: { competition_rule_id: rule.id } });
  });
  const conflictingRules = await run();
  assert.equal(conflictingRules.ok, false);
  if (!conflictingRules.ok) {
    assert.equal(conflictingRules.code, "NO_AVAILABLE_SLOT");
    assert.ok(conflictingRules.conflicts.every(match => match.round === 19));
  }
}
