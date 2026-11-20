import { listSavedScheduleProposals } from "../../src/features/scheduling/server/saved-proposals";
import { verifySchedulingLoans } from "./scheduling-loans";
import { verifySharedProposalEditing } from "./scheduling-adjustment-shared";
import { editStoredProposalInTransaction } from "../../src/features/scheduling/server/stored-proposal-edit";
import { storedProposalSchema } from "../../src/features/scheduling/stored-proposal";
import { changeProposalReviewForActor } from "../../src/features/scheduling/server/adjustment";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../../src/server/db/prisma";
import { generateScheduleForActor, generateScheduleInTransaction, validateScheduleProposalInTransaction } from "../../src/features/scheduling/server/service";

test("generación real: permisos, persistencia, reintento y rollback", async t => {
 const db=getPrisma();
 try {
  const [f]=await db.$queryRaw<{actor:string;outsider:string;season:string;category:string;group_id:string}[]>`SELECT * FROM public.scheduling_fixture`;
  const input={seasonId:f.season,categoryId:f.category,groupId:f.group_id,operationId:randomUUID(),expectedSeasonVersion:1,reason:"Prueba aislada de generacion"};
  const run=(actor=f.actor,data=input)=>db.$transaction(tx=>generateScheduleInTransaction(tx,actor,data),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
  // Cada escenario revierte sus cambios, incluidas las propuestas creadas.
  const rollback = new Error("ROLLBACK_ESCENARIO_FORMATO");
  for (const format of ["GENERAL_TABLE", "GROUP_STAGE"] as const) {
   for (const count of [4, 5]) {
    await assert.rejects(db.$transaction(async tx => {
     await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Prueba de formatos',true)`;
     const teams=await tx.season_teams.findMany({where:{season_category_id:f.category},orderBy:{id:"asc"},select:{id:true,season_id:true,team_id:true,club_id:true}});
     const selected=teams.slice(0,count).map(team=>team.id);
     if(format==="GROUP_STAGE") {
      await tx.season_teams.deleteMany({where:{season_category_id:f.category}});
      await tx.season_categories.update({where:{id:f.category},data:{competition_format:format}});
      const other=await tx.groups.create({data:{season_id:f.season,season_category_id:f.category,name:"Grupo B"}});
      const otherTeams=teams.slice(count,count+2).map(team=>team.id);
      for(const team of teams.slice(0,count+2)) {
       await tx.season_teams.create({data:{...team,season_category_id:f.category}});
       if(team.id!==otherTeams[0]) await tx.season_teams.update({where:{id:team.id},data:{group_id:selected.includes(team.id)?f.group_id:other.id}});
      }
      // No se puede generar si queda un equipo activo sin distribuir.
      await assert.rejects(generateScheduleInTransaction(tx,f.actor,{...input,operationId:randomUUID()}),{message:"DISTRIBUTION_PENDING"});
      await tx.season_teams.update({where:{id:otherTeams[0]},data:{group_id:other.id}});
     } else {
      await tx.season_teams.updateMany({where:{season_category_id:f.category},data:{status:"WITHDRAWN"}});
      await tx.season_teams.updateMany({where:{id:{in:selected}},data:{status:"REGISTERED",group_id:f.group_id}});
     }
     const result=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:randomUUID()});
     assert.ok(result.ok,`${format}, ${count} equipos`);
     assert.equal(result.replayed,false);
     const {matches,byes}=result.proposal as {matches:{round:number;home:string;away:string}[];byes:{round:number;teamId:string}[]};
     assert.equal(matches.length,count*(count-1)/2);
     const pairs=new Set(matches.map(match=>[match.home,match.away].sort().join("/")));
     assert.equal(pairs.size,matches.length);
     const rounds=count%2?count:count-1;
     assert.equal(byes.length,count%2?count:0);
     for(let round=1;round<=rounds;round++) {
      const playing=matches.filter(match=>match.round===round).flatMap(match=>[match.home,match.away]);
      const resting=byes.filter(bye=>bye.round===round).map(bye=>bye.teamId);
      assert.equal(resting.length,count%2);
      assert.deepEqual([...playing,...resting].sort(),[...selected].sort());
     }
     if(count%2) assert.deepEqual(byes.map(bye=>bye.teamId).sort(),[...selected].sort());
     throw rollback;
    },{timeout:30000}),error=>error===rollback);
    t.diagnostic(`${format}: ${count} equipos; encuentros, jornadas y descansos verificados.`);
   }
  }
  await assert.rejects(db.$transaction(async tx => {
   await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Prueba integrada de restricciones',true)`;
   const teams=await tx.season_teams.findMany({where:{season_category_id:f.category},orderBy:{id:"asc"},take:4,select:{id:true}});
   await tx.season_teams.updateMany({where:{season_category_id:f.category},data:{status:"WITHDRAWN"}});
   await tx.season_teams.updateMany({where:{id:{in:teams.map(team=>team.id)}},data:{status:"REGISTERED"}});
   const venue=await tx.venues.findFirstOrThrow({orderBy:{id:"asc"}});
   const openings=await tx.venue_availability.findMany({where:{venue_id:venue.id,type:"AVAILABLE"}});
   const block={start:new Date("2030-01-06T15:00:00Z"),end:new Date("2030-01-06T17:00:00Z")};
   const closure=await tx.venue_availability.create({data:{venue_id:venue.id,starts_at:block.start,ends_at:block.end,type:"BLOCK",reason:"Bloqueo sintético"}});
   const rule=await tx.competition_rules.create({data:{season_id:f.season,version_number:2}});
   await tx.competition_rule_parameters.create({data:{competition_rule_id:rule.id,parameter_key:"calendar",validated_by:f.actor,
    parameter_value:{rounds:2,matchDurationMinutes:90,complexOnlyFinalRounds:1,
     scheduling:{slotStepMinutes:30,venueStages:[{fromRound:1,toRound:6,venueIds:[venue.id]}]}}}});
   await tx.competition_rules.update({where:{id:rule.id},data:{status:"APPROVED",approved_by:f.actor,approved_at:new Date()}});
   await tx.season_categories.update({where:{id:f.category},data:{competition_rule_id:rule.id}});
   const result=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:randomUUID()});
   assert.ok(result.ok);
   assert.equal(result.replayed,false);
   const {matches}=result.proposal as {matches:{round:number;matchdayId:string;home:string;away:string;venueId:string;start:string;end:string;reservedUntil:string}[]};
   assert.equal(matches.length,12);
   for(const match of matches) {
    const start=Date.parse(match.start),end=Date.parse(match.end),reserved=Date.parse(match.reservedUntil);
    assert.equal(match.venueId,venue.id);
    assert.equal(end-start,90*60000);
    assert.equal(reserved-end,30*60000);
    assert.ok(openings.some(window=>+window.starts_at<=start && reserved<=+window.ends_at));
    assert.ok(reserved<=+block.start || start>=+block.end);
    assert.ok(matches.some(other=>other.round===match.round+3 && other.home===match.away && other.away===match.home) ||
     matches.some(other=>other.round===match.round-3 && other.home===match.away && other.away===match.home));
   }
   for(let i=0;i<matches.length;i++) for(let j=i+1;j<matches.length;j++) {
    const a=matches[i],b=matches[j];
    assert.ok(Date.parse(a.reservedUntil)<=Date.parse(b.start) || Date.parse(b.reservedUntil)<=Date.parse(a.start),"Cancha compartida sin traslapes");
    if([a.home,a.away].some(team=>team===b.home || team===b.away))
     assert.ok(Date.parse(a.end)<=Date.parse(b.start) || Date.parse(b.end)<=Date.parse(a.start),"Equipo sin traslapes");
   }
   await tx.venue_availability.update({where:{id:closure.id},data:{ends_at:new Date("2030-01-06T21:00:00Z")}});
   const editableMatches=matches.map(({round,matchdayId,home,away,venueId,start})=>({round,matchdayId,home,away,venueId,start}));
   const recheck=await validateScheduleProposalInTransaction(tx,f.actor,{proposalId:result.proposalId,expectedSeasonVersion:1,matches:editableMatches});
   assert.ok(!recheck.ok && recheck.conflicts.some(conflict=>conflict.code==="VENUE_BLOCK"),"El ajuste revalida bloqueos actuales");
   const blockedId=randomUUID();
   const blocked=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:blockedId});
   assert.equal(blocked.ok,false);
   if(!blocked.ok && blocked.code==="NO_AVAILABLE_SLOT") {
    const firstRound=blocked.conflicts.filter(match=>match.round===1);
    assert.equal(firstRound.length,2);
    assert.ok(firstRound.every(match=>"factors" in match && Array.isArray(match.factors) && match.factors.includes("VENUE_BLOCK")));
   } else assert.fail("El bloqueo completo debe impedir los encuentros de la primera jornada");
   assert.equal(await tx.schedule_proposals.count({where:{id:blockedId}}),0);
   const pending=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:randomUUID(),allowPending:true});
   assert.ok(pending.ok);
   const pendingProposal=await tx.schedule_proposals.findUniqueOrThrow({where:{id:pending.proposalId}});
   const pendingData=pendingProposal.parameters as { matches:{round:number;matchdayId:string;home:string;away:string;venueId:string|null;start:string|null}[] };
   assert.ok(pendingData.matches.some(match=>match.venueId===null && match.start===null));
   assert.ok(pendingData.matches.some(match=>match.venueId!==null && match.start!==null));
   const pendingWithReasons=storedProposalSchema.parse(pendingProposal.parameters);
   assert.ok(pendingWithReasons.matches.some(match=>match.venueId===null && match.factors?.includes("VENUE_BLOCK")));
   const pendingValidation=await validateScheduleProposalInTransaction(tx,f.actor,{proposalId:pending.proposalId,expectedSeasonVersion:1,matches:pendingData.matches.map(({round,matchdayId,home,away,venueId,start})=>({round,matchdayId,home,away,venueId,start}))});
   assert.ok(pendingValidation.ok,"La propuesta con encuentros pendientes puede revisarse");
   await tx.venue_availability.delete({where:{id:closure.id}});
   const availableMatch=matches.find(match=>pendingData.matches.some(p=>p.round===match.round && p.home===match.home && p.away===match.away && p.venueId===null))!;
   const index=pendingData.matches.findIndex(match=>match.round===availableMatch.round && match.home===availableMatch.home && match.away===availableMatch.away);
   assert.ok(index>=0);
   const fixed=await editStoredProposalInTransaction(tx,f.actor,{proposalId:pending.proposalId,expectedVersion:1,encounterIndex:index,
     venueId:availableMatch.venueId,startsAt:availableMatch.start,reason:"Asignar cancha disponible"});
   assert.equal(fixed.code,"ADJUSTMENT_SAVED");
   const updated=storedProposalSchema.parse((await tx.schedule_proposals.findUniqueOrThrow({where:{id:pending.proposalId}})).parameters);
   assert.equal(updated.matches[index].venueId,availableMatch.venueId);
   assert.ok(updated.matches.some(match=>match.venueId===null));
   assert.ok(updated.matches.some(match=>match.venueId===null && match.factors?.includes("VENUE_BLOCK")),"Los motivos restantes sobreviven al ajuste");
   await tx.venue_availability.create({data:{id:closure.id,venue_id:venue.id,starts_at:block.start,ends_at:new Date("2030-01-06T21:00:00Z"),type:"BLOCK",reason:"Bloqueo sintético"}});
   // Cada encuentro tiene un horario candidato, pero dos partidos necesitan
   // el mismo único intervalo de la cancha en la primera jornada.
   await tx.venue_availability.deleteMany({where:{venue_id:venue.id,type:"BLOCK"}});
   const firstOpening=openings.find(window=>+window.starts_at===+block.start);
   assert.ok(firstOpening);
   await tx.venue_availability.update({where:{id:firstOpening.id},data:{ends_at:block.end}});
   const failedId=randomUUID();
   const countBefore=await tx.schedule_proposals.count();
   const impossible=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:failedId});
   assert.equal(impossible.ok,false);
   if(!impossible.ok) {
    assert.equal(impossible.code,"NO_SOLUTION");
    assert.ok(impossible.conflicts.some(match=>match.round===1));
    assert.ok(impossible.conflicts.every(match=>match.home && match.away));
   }
   assert.equal(await tx.schedule_proposals.count(),countBefore);
   assert.equal(await tx.schedule_proposals.count({where:{id:failedId}}),0);
   const partial=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:randomUUID(),allowPending:true});
   assert.ok(partial.ok,"Un conflicto entre encuentros permite conservar una propuesta parcial");
   const partialData=storedProposalSchema.parse((await tx.schedule_proposals.findUniqueOrThrow({where:{id:partial.proposalId}})).parameters);
   const firstRound=partialData.matches.filter(match=>match.round===1);
   assert.equal(firstRound.filter(match=>match.venueId!==null).length,1);
   assert.equal(firstRound.filter(match=>match.venueId===null).length,1);
   assert.ok(partialData.matches.some(match=>match.round>1 && match.venueId!==null));
   throw rollback;
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000}),error=>error===rollback);
  t.diagnostic("Dos vueltas en cancha compartida: disponibilidad, bloqueo, tramos, localías y ausencia de traslapes verificados.");
  await assert.rejects(run(f.outsider),{message:"FORBIDDEN"});
  await assert.rejects(db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Prueba de ámbito de programación',true)`;
   const assignment=await tx.user_roles.findFirstOrThrow({where:{user_id:f.actor},select:{role_id:true}});
   const league=await tx.leagues.create({data:{name:"Liga ajena sintética"}});
   await tx.user_roles.create({data:{user_id:f.outsider,role_id:assignment.role_id,league_id:league.id}});
   await assert.rejects(generateScheduleInTransaction(tx,f.outsider,{...input,operationId:randomUUID()}),{message:"FORBIDDEN"});
   assert.equal(await tx.schedule_proposals.count(),0);
   throw rollback;
  },{timeout:30000}),error=>error===rollback);
  t.diagnostic("Acceso denegado sin permiso y con permiso de otra liga.");
  const start=performance.now();
  const first=await run();
  const elapsed=performance.now()-start;
  t.diagnostic(`Servicio completo, 20 equipos/19 jornadas/190 partidos/4 canchas: ${elapsed.toFixed(1)} ms.`);
  assert.ok(elapsed<30000);
  assert.equal(first.ok,true);
  await verifySharedProposalEditing(f);
  t.diagnostic("PDGLD-25: generar, recuperar, ajustar, revalidar, enviar; bloqueo, respuesta perdida y concurrencia reales verificados.");
  const stored=await db.schedule_proposals.findUniqueOrThrow({where:{id:input.operationId}});
  assert.equal((stored.parameters as {matches:unknown[]}).matches.length,190);
  const generated=(stored.parameters as {matches:{round:number;matchdayId:string;home:string;away:string;venueId:string;start:string}[]}).matches;
  const editable=generated.map(({round,matchdayId,home,away,venueId,start})=>({round,matchdayId,home,away,venueId,start}));
  const validate=(matches=editable,actor=f.actor,version=1)=>db.$transaction(tx=>validateScheduleProposalInTransaction(tx,actor,
    {proposalId:input.operationId,expectedSeasonVersion:version,matches}),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
  const unchanged=await validate();
  assert.ok(unchanged.ok);
  assert.equal(unchanged.matches.length,190);
  const swapped=editable.map((match,index)=>index===0?{...match,home:match.away,away:match.home}:match);
  assert.ok((await validate(swapped)).ok,"Puede invertir local y visitante en una vuelta");
  const availableVenues=await db.venues.findMany({select:{id:true}});
  const firstMatch=editable[0],firstStart=Date.parse(firstMatch.start);
  const openings=[0,1,2].flatMap(hour=>availableVenues.map(venue=>({venueId:venue.id,start:Date.parse("2030-01-06T15:00:00Z")+hour*120*60000})));
  const alternate=openings.find(option=>option.start!==firstStart && editable.slice(1).every(match=>
    match.venueId!==option.venueId || Date.parse(match.start)+120*60000<=option.start || option.start+120*60000<=Date.parse(match.start)));
  assert.ok(alternate,"El escenario ofrece otro horario disponible");
  const moved=editable.map((match,index)=>index===0?{...match,venueId:alternate.venueId,start:new Date(alternate.start).toISOString()}:match);
  const movedResult=await validate(moved);
  assert.ok(movedResult.ok,"Puede cambiar cancha y horario a una opción válida");
  const normalized=movedResult.matches.find(match=>match.round===firstMatch.round&&match.home===firstMatch.home&&match.away===firstMatch.away)!;
  assert.ok(normalized.start && normalized.end && normalized.reservedUntil);
  assert.equal(Date.parse(normalized.end)-Date.parse(normalized.start),90*60000);
  assert.equal(Date.parse(normalized.reservedUntil)-Date.parse(normalized.end),30*60000);
  const badVenue=editable.map((match,index)=>index===0?{...match,venueId:randomUUID()}:match);
  const invalidVenue=await validate(badVenue);
  assert.ok(!invalidVenue.ok && invalidVenue.conflicts.some(conflict=>conflict.code==="INVALID_VENUE"));
  const overlap=editable.map((match,index)=>index===1?{...match,venueId:editable[0].venueId,start:editable[0].start}:match);
  const overlapping=await validate(overlap);
  assert.ok(!overlapping.ok && overlapping.conflicts.some(conflict=>conflict.code==="SLOT_CONFLICT"));
  const duplicate=editable.map((match,index)=>index===1?{...match,home:editable[0].home}:match);
  assert.ok(!(await validate(duplicate)).ok);
  await assert.rejects(validate(editable,f.outsider),{message:"FORBIDDEN"});
  await assert.rejects(validate(editable,f.actor,999),{message:"STALE_CONFIGURATION"});
  await assert.rejects(db.$transaction(tx=>validateScheduleProposalInTransaction(tx,f.actor,
    {proposalId:input.operationId,expectedSeasonVersion:1,matches:editable})),{message:"SERIALIZABLE_TRANSACTION_REQUIRED"});
  assert.equal(await db.schedule_proposals.count(),1);
  t.diagnostic("Validador compartido: propuesta íntegra, cambio de localía, cancha inválida, traslape, permisos y versión.");
  assert.equal(await db.schedule_proposals.count(),1);
  const listed = await listSavedScheduleProposals(f.actor, f.season, f.group_id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, input.operationId);
  assert.equal(listed[0].proposal.matches.length, 190);
  await assert.rejects(listSavedScheduleProposals(f.outsider, f.season, f.group_id), { message: "FORBIDDEN" });
  await assert.rejects(listSavedScheduleProposals(f.actor, f.season, randomUUID()), { message: "FORBIDDEN" });
  const replay=await run();
  assert.equal(replay.ok,true);
  if(replay.ok) assert.equal(replay.replayed,true);
  assert.equal(await db.schedule_proposals.count(),1);
  await assert.rejects(run(f.actor,{...input,reason:"Otro contenido de la misma operacion"}),{message:"OPERATION_KEY_REUSED"});
  await assert.rejects(db.$transaction(async tx=>{
    await generateScheduleInTransaction(tx,f.actor,{...input,operationId:randomUUID()});
    throw new Error("SYNTHETIC_ROLLBACK");
  },{timeout:30000}),{message:"SYNTHETIC_ROLLBACK"});
  assert.equal(await db.schedule_proposals.count(),1);
  assert.equal(await db.matches.count(),0);
  const concurrent={...input,operationId:randomUUID()};
  const raced=await Promise.all([generateScheduleForActor(f.actor,concurrent),generateScheduleForActor(f.actor,concurrent)]);
  assert.ok(raced.every(result=>result.ok));
  assert.equal(raced.filter(result=>result.ok&&result.replayed).length,1);
  assert.equal(await db.schedule_proposals.count(),2);
  const secondGrant=await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Segundo programador sintético',true)`;
   const assignment=await tx.user_roles.findFirstOrThrow({where:{user_id:f.actor},select:{role_id:true,league_id:true}});
   return tx.user_roles.create({data:{user_id:f.outsider,role_id:assignment.role_id,league_id:assignment.league_id},select:{id:true}});
  });
  try {
   const concurrentInputs=[{...input,operationId:randomUUID()},{...input,operationId:randomUUID()}];
   const independent=await Promise.all([generateScheduleForActor(f.actor,concurrentInputs[0]),generateScheduleForActor(f.outsider,concurrentInputs[1])]);
   assert.ok(independent.every(result=>result.ok&&!result.replayed));
   assert.equal(await db.schedule_proposals.count({where:{id:{in:concurrentInputs.map(value=>value.operationId)}}}),2);
   const shared={...input,operationId:randomUUID()};
   const collision=await Promise.allSettled([generateScheduleForActor(f.actor,shared),generateScheduleForActor(f.outsider,shared)]);
   assert.equal(collision.filter(result=>result.status==="fulfilled"&&result.value.ok).length,1);
   assert.equal(collision.filter(result=>result.status==="rejected"&&result.reason?.message==="OPERATION_KEY_REUSED").length,1);
   assert.equal(await db.schedule_proposals.count({where:{id:shared.operationId}}),1);
   t.diagnostic("Dos programadores: solicitudes distintas guardan dos propuestas; una clave compartida no permite recuperar la operación ajena.");
  } finally {
   await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Retirar permiso sintético',true)`;
    await tx.user_roles.delete({where:{id:secondGrant.id}});
   });
  }
  assert.equal(await db.schedule_proposals.count(),5);
  const previewRole=process.env.SCHEDULING_TEST_ROLE;
  assert.match(previewRole??'',/^pdgld135_role_[a-f0-9]+$/);
  await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(`SET LOCAL ROLE "${previewRole}"`);
    const saved=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:randomUUID()});
    assert.equal(saved.ok,true);
    assert.ok(saved.ok);
    const complete=storedProposalSchema.parse(saved.proposal);
    const firstMatch=complete.matches[0];
    const adjusted=await editStoredProposalInTransaction(tx,f.actor,{
      proposalId:saved.proposalId,expectedVersion:1,encounterIndex:0,
      venueId:firstMatch.venueId,startsAt:firstMatch.start,swapHomeAway:true,
      reason:"Ajuste con rol SQL limitado",
    });
    assert.equal(adjusted.code,"ADJUSTMENT_SAVED");
    const receipt=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:saved.ok?saved.proposalId:input.operationId});
    assert.equal(receipt.ok&&receipt.replayed,true);
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
  assert.equal(await db.schedule_proposals.count(),6);
  await assert.rejects(run(f.actor,{...input,operationId:randomUUID(),expectedSeasonVersion:999}),{message:"STALE_CONFIGURATION"});
  await verifySchedulingLoans(f);
  t.diagnostic('Prestamos reales pendientes/rechazados excluidos; aprobados generan 190 partidos en canchas compartidas.');
  await db.venue_availability.deleteMany();
  const impossible=await run(f.actor,{...input,operationId:randomUUID()});
  assert.equal(impossible.ok,false);
  if(!impossible.ok) {
    assert.equal(impossible.code,"NO_AVAILABLE_SLOT");
    assert.equal(impossible.conflicts.length,190);
    assert.ok(impossible.conflicts.every(match=>match.round && match.home && match.away));
    assert.ok(impossible.conflicts.every(match=>"factors" in match && Array.isArray(match.factors) && match.factors.includes("NO_OPENING")));
  }
  assert.equal(await db.schedule_proposals.count(),7);
  const pending=await generateScheduleForActor(f.actor,{...input,operationId:randomUUID(),allowPending:true});
  assert.ok(pending.ok);
  const saved=await db.schedule_proposals.findUniqueOrThrow({where:{id:pending.proposalId}});
  const draft=storedProposalSchema.parse(saved.parameters);
  assert.ok(draft.matches.every(match=>match.venueId===null));
  const sent=await changeProposalReviewForActor(f.actor,{proposalId:pending.proposalId,expectedVersion:1,operation:"submit",reason:"Revisión de canchas pendientes"});
  assert.equal(sent.code,"PROPOSAL_UPDATED");
  const [reviewer]=await db.$queryRaw<{reviewer:string}[]>`SELECT reviewer FROM public.scheduling_fixture`;
  const approved=await changeProposalReviewForActor(reviewer.reviewer,{proposalId:pending.proposalId,expectedVersion:2,operation:"approve",reason:"Aprobación de propuesta pendiente"});
  assert.equal(approved.code,"INCOMPLETE_PROPOSAL_MATCH");
 } finally { await db.$disconnect(); }
});
