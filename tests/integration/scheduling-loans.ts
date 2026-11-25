import sharp from "sharp";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { getPrisma } from "../../src/server/db/prisma";
import type { PrivateDocumentTransport } from "../../src/server/files/private-document-storage";
import { cleanCancelledVenueLoanFiles } from "../../src/features/venues/server/loan-cleanup";
import { submitVenueLoanForActor, decideVenueLoanForActor, resolveLegacyVenueLoanForActor } from "../../src/features/venues/server/loans";
import { generateScheduleForActor, generateScheduleInTransaction } from "../../src/features/scheduling/server/service";
import { loadApprovedLoanWindows } from "../../src/features/scheduling/server/loan-windows";
import { fitsLoanWindow } from "../../src/features/scheduling/loan-windows";
import { validateSlot, type SlotContext } from "../../src/features/scheduling/slot-validation";
import { editStoredProposalForActor, editStoredProposalInTransaction } from "../../src/features/scheduling/server/stored-proposal-edit";
import { storedProposalSchema } from "../../src/features/scheduling/stored-proposal";

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
    for (const club of code === "CLUB_DELEGATE" ? clubs.filter(c => c.id !== clubs[0].id) : [clubs[0]]) {
      await tx.user_roles.create({ data: { user_id: actor, role_id: role.id, league_id: club.league_id,
        club_id: code === "CLUB_DELEGATE" ? club.id : null,
        delegate_position: code === "CLUB_DELEGATE" ? "PRIMARY" : null } });
    }
  }
  const delegate = await tx.roles.findUniqueOrThrow({ where: { code: "CLUB_DELEGATE" } });
  await tx.user_roles.create({ data: { user_id: f.actor, role_id: delegate.id, league_id: clubs[0].league_id,
    club_id: clubs[0].id, delegate_position: "PRIMARY" } });
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
  // Club dueño, solicitante y liga usan identidades distintas para probar el orden.
  const [{reviewer:leagueActor}] = await db.$queryRaw<{reviewer:string}[]>`SELECT reviewer FROM public.scheduling_fixture`;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.user_id', ${f.actor}, true), set_config('app.reason', 'Permiso de liga sintetico', true)`;
    const role = await tx.roles.findUniqueOrThrow({where:{code:"EXECUTIVE_PRESIDENT"}});
    await tx.user_roles.create({data:{user_id:leagueActor,role_id:role.id,league_id:clubs[0].league_id}});
  });
  const borrower=clubs.find(club=>club.id!==clubs[0].id)!;
  const selectedVenue=venues[0], window=selectedVenue.venue_availability[0];
  assert.ok(window);
  const inputForDecision=()=>({requestId:randomUUID(),seasonId:f.season,clubId:borrower.id,venueId:selectedVenue.id,
    windows:[{startsAt:window.starts_at.toISOString(),endsAt:window.ends_at.toISOString()}]});
  const availableWindows=()=>db.$transaction(tx=>loadApprovedLoanWindows(tx,f.season,[borrower.id]));
  const hasApproval=async(id:string)=>(await availableWindows()).some(value=>value.id===id);

  const deniedByOwner=inputForDecision();
  await submitVenueLoanForActor(f.outsider,deniedByOwner,attachment,storage);
  await assert.rejects(decideVenueLoanForActor(leagueActor,{requestId:deniedByOwner.requestId,status:"APPROVED",reason:"La liga intenta decidir primero"}),{message:"FORBIDDEN"});
  await decideVenueLoanForActor(f.actor,{requestId:deniedByOwner.requestId,status:"REJECTED",reason:"El dueño rechaza la solicitud"});
  assert.equal(await hasApproval(deniedByOwner.requestId),false,"Rechazo del dueño no autoriza la cancha");

  const deniedByLeague=inputForDecision();
  await submitVenueLoanForActor(f.outsider,deniedByLeague,attachment,storage);
  await decideVenueLoanForActor(f.actor,{requestId:deniedByLeague.requestId,status:"APPROVED",reason:"El dueño acepta la solicitud"});
  assert.equal(await hasApproval(deniedByLeague.requestId),false,"La aprobación del dueño por sí sola no habilita");
  await decideVenueLoanForActor(leagueActor,{requestId:deniedByLeague.requestId,status:"REJECTED",reason:"La liga rechaza la solicitud"});
  assert.equal(await hasApproval(deniedByLeague.requestId),false,"Rechazo de la liga no autoriza la cancha");

  const approved=inputForDecision();
  await submitVenueLoanForActor(f.outsider,approved,attachment,storage);
  await decideVenueLoanForActor(f.actor,{requestId:approved.requestId,status:"APPROVED",reason:"El dueño autoriza el periodo"});
  assert.equal(await hasApproval(approved.requestId),false);
  await decideVenueLoanForActor(leagueActor,{requestId:approved.requestId,status:"APPROVED",reason:"La liga autoriza el periodo"});
  const granted=(await availableWindows()).find(value=>value.id===approved.requestId);
  assert.ok(granted,"Las dos decisiones habilitan la consulta del préstamo");
  const start=+window.starts_at, duration=120*60000;
  assert.ok(fitsLoanWindow(granted.windows,start,start+duration));
  assert.equal(fitsLoanWindow(granted.windows,start-60000,start+duration),false);
  assert.equal(fitsLoanWindow(granted.windows,+window.ends_at-duration+60000,+window.ends_at+60000),false);
  const date=new Date(start); const day=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate()));
  const slotContext:SlotContext={seasonId:f.season,timezone:"UTC",seasonStart:new Date("2030-01-01"),seasonEnd:new Date("2030-12-31"),
    day:{start_date:day,end_date:day},home:"home",away:"away",homeClub:borrower.id,matchDurationMinutes:90,complexOnly:false,breaks:[],sanctions:[],
    venue:{id:selectedVenue.id,is_league_sports_complex:false,owner_club_id:clubs[0].id,match_duration_minutes:90,buffer_minutes:30,
      venue_availability:selectedVenue.venue_availability,home_venue_assignments:[]},loanWindows:granted.windows};
  assert.ok(validateSlot(slotContext,start).ok,"El generador acepta un horario dentro del periodo autorizado");
  const outside=validateSlot({...slotContext,venue:{...slotContext.venue,venue_availability:[{starts_at:new Date(start-3600000),ends_at:window.ends_at,type:"AVAILABLE"}]}},start-60000);
  assert.ok(!outside.ok && outside.factor==="LOAN_WINDOW","El generador rechaza un horario fuera del periodo autorizado");
  // Una decisión real espera a que termine la transacción que generó la propuesta.
  const secondVenue=venues[1];
  assert.ok(secondVenue);
  const racingRequest={...inputForDecision(),venueId:secondVenue.id,
    windows:secondVenue.venue_availability.map(w=>({startsAt:w.starts_at.toISOString(),endsAt:w.ends_at.toISOString()}))};
  await submitVenueLoanForActor(f.outsider,racingRequest,attachment,storage);
  await decideVenueLoanForActor(f.actor,{requestId:racingRequest.requestId,status:"APPROVED",reason:"Dueño acepta para prueba concurrente"});
  let release!:()=>void, signalReady!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}), ready=new Promise<void>(resolve=>{signalReady=resolve;});
  const operationId=randomUUID();
  let generatingPid=0;
  const generation=db.$transaction(async tx=>{
    generatingPid=(await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
    const result=await generateScheduleInTransaction(tx,f.actor,{seasonId:f.season,categoryId:f.category,groupId:f.group_id,
      operationId,expectedSeasonVersion:1,reason:"Generación concurrente sintética",allowPending:true});
    assert.ok(result.ok);
    const saved=await tx.schedule_proposals.findUniqueOrThrow({where:{id:operationId}});
    const data=saved.parameters as {matches:{home:string;venueId:string|null}[]};
    const borrowerTeams=await tx.season_teams.findMany({where:{club_id:borrower.id,season_id:f.season},select:{id:true}});
    assert.ok(data.matches.every(m=>!borrowerTeams.some(t=>t.id===m.home) || m.venueId!==secondVenue.id),"No se utiliza el préstamo pendiente");
    signalReady();
    await gate;
    return result;
  },{isolationLevel:"Serializable",timeout:30000});
  await Promise.race([ready,generation.then(()=>{throw Error("GENERATION_FINISHED_UNEXPECTEDLY");})]);
  const decision=decideVenueLoanForActor(leagueActor,{requestId:racingRequest.requestId,status:"APPROVED",reason:"Liga autoriza después de generación"});
  try {
    let blocked=false;
    for(let i=0;i<100;i++) {
      const rows=await db.$queryRaw<{blocked:boolean}[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE ${generatingPid}=ANY(pg_blocking_pids(a.pid))) AS blocked`;
      if(rows[0].blocked){blocked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(blocked,true,"PostgreSQL confirma que la decisión espera a la generación");
    assert.equal(await hasApproval(racingRequest.requestId),false,"La autorización no se adelanta al commit");
  } finally { release(); }
  await generation;
  await decision;
  assert.equal(await hasApproval(racingRequest.requestId),true,"La decisión se aplica después de terminar la generación");
  await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Eliminar propuesta sintética concurrente',true)`;
    await tx.schedule_proposals.delete({where:{id:operationId}});
  });
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
  for (const club of clubs.filter(club => club.id !== clubs[0].id)) {
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
    await decideVenueLoanForActor(f.actor, { requestId, status: "APPROVED", reason: "Autorizacion del club propietario" });
    await decideVenueLoanForActor(f.actor, { requestId, status: "APPROVED", reason: "Autorizacion de la liga" });
  }
  const result = await run();
  assert.ok(result.ok);
  const proposal = await db.schedule_proposals.findUniqueOrThrow({ where: { id: result.proposalId } });
  // Una autorización que llega durante el ajuste no puede cambiar su validación.
  const extraVenue=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Cancha sintética para ajuste concurrente',true)`;
    return tx.venues.create({data:{league_id:clubs[0].league_id,code:randomUUID(),name:"Cancha concurrente",address:"Sintética",
      owner_club_id:clubs[0].id,is_league_sports_complex:false,match_duration_minutes:90,buffer_minutes:30,
      venue_availability:{create:selectedVenue.venue_availability.map(w=>({starts_at:w.starts_at,ends_at:w.ends_at,type:w.type,reason:w.reason}))}}});
  });
  const concurrentRequest={...inputForDecision(),venueId:extraVenue.id,
    windows:selectedVenue.venue_availability.map(w=>({startsAt:w.starts_at.toISOString(),endsAt:w.ends_at.toISOString()}))};
  await submitVenueLoanForActor(f.outsider,concurrentRequest,attachment,storage);
  await decideVenueLoanForActor(f.actor,{requestId:concurrentRequest.requestId,status:"APPROVED",reason:"Dueño autoriza ajuste concurrente"});
  const draft=storedProposalSchema.parse(proposal.parameters);
  const borrowerTeams=await db.season_teams.findMany({where:{club_id:borrower.id,season_id:f.season},select:{id:true}});
  const targetIndex=draft.matches.findIndex(m=>m.start && borrowerTeams.some(t=>t.id===m.home));
  assert.ok(targetIndex>=0);
  const target=draft.matches[targetIndex];
  assert.ok(target.start);
  const adjustment={proposalId:proposal.id,expectedVersion:proposal.version,encounterIndex:targetIndex,venueId:extraVenue.id,
    startsAt:target.start,reason:"Ajuste concurrente de cancha"};
  let releaseEdit!:()=>void, editReady!:()=>void, editingPid=0;
  const editGate=new Promise<void>(resolve=>{releaseEdit=resolve;}), editLocked=new Promise<void>(resolve=>{editReady=resolve;});
  const editing=db.$transaction(async tx=>{
    editingPid=(await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`)[0].pid;
    const rejected=await editStoredProposalInTransaction(tx,f.actor,adjustment);
    assert.equal(rejected.code,"INVALID_SCHEDULE");
    assert.ok("conflicts" in rejected && rejected.conflicts?.some(c=>c.code==="LOAN_WINDOW"));
    assert.equal((await tx.schedule_proposals.findUniqueOrThrow({where:{id:proposal.id}})).version,proposal.version);
    editReady();
    await editGate;
  },{isolationLevel:"Serializable",timeout:30000});
  await Promise.race([editLocked,editing.then(()=>{throw Error("EDIT_FINISHED_UNEXPECTEDLY");})]);
  const concurrentDecision=decideVenueLoanForActor(leagueActor,{requestId:concurrentRequest.requestId,status:"APPROVED",reason:"Liga autoriza después del ajuste"});
  try {
    let blocked=false;
    for(let i=0;i<100;i++) {
      const rows=await db.$queryRaw<{blocked:boolean}[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE ${editingPid}=ANY(pg_blocking_pids(a.pid))) AS blocked`;
      if(rows[0].blocked){blocked=true;break;}
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(blocked,true,"PostgreSQL confirma que la decisión espera al ajuste");
    assert.equal(await hasApproval(concurrentRequest.requestId),false);
  } finally { releaseEdit(); }
  await editing;
  await concurrentDecision;
  assert.equal(await hasApproval(concurrentRequest.requestId),true);
  assert.equal((await db.schedule_proposals.findUniqueOrThrow({where:{id:proposal.id}})).version,proposal.version,"El ajuste rechazado no guardó cambios");
  const retried=await editStoredProposalForActor(f.actor,adjustment);
  assert.equal(retried.code,"ADJUSTMENT_SAVED","Con aprobación confirmada, el mismo ajuste se revalida y guarda");
  const finalDraft=storedProposalSchema.parse((await db.schedule_proposals.findUniqueOrThrow({where:{id:proposal.id}})).parameters);
  assert.equal(finalDraft.matches[targetIndex].venueId,extraVenue.id);
  const matches = (proposal.parameters as { matches: { venueId: string; start: string; reservedUntil: string }[] }).matches;
  assert.equal(matches.length, 190);
  for (const match of matches) {
    const venue = venues.find(value => value.id === match.venueId);
    assert.ok(venue);
    assert.ok(venue.venue_availability.some(window =>
      +window.starts_at <= Date.parse(match.start) && Date.parse(match.reservedUntil) <= +window.ends_at));
  }
  assert.equal(await db.matches.count({where:{deleted_at:null}}), 0);
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
