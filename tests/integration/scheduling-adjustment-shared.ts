import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { approvedSchedulePdfForActor, SchedulePdfUnavailable } from "../../src/features/scheduling/server/schedule-pdf";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../src/server/db/prisma";
import { generateScheduleForActor } from "../../src/features/scheduling/server/service";
import { editStoredProposalForActor, editStoredProposalInTransaction } from "../../src/features/scheduling/server/stored-proposal-edit";
import { changeProposalReviewForActor, activatePreviouslyApprovedProposalForActor } from "../../src/features/scheduling/server/adjustment";
import { readStoredProposalForActor } from "../../src/features/scheduling/server/stored-proposal";
import { storedProposalSchema } from "../../src/features/scheduling/stored-proposal";
import { saveTeamSwapInTransaction } from "../../src/features/scheduling/server/team-swap";
import { proposeTeamSwap } from "../../src/features/scheduling/team-swap";
import { rescheduleAbsentMatchInTransaction } from "../../src/features/matches/server/reschedule";
import { updatedSchedulePdfForActor } from "../../src/features/scheduling/server/updated-schedule-pdf";
import { venueLocalTime } from "../../src/features/venues/time";
import { transitionMatchInTransaction } from "../../src/features/matches/server/transition";

/** Propuesta real de PDGLD-24 + validador compartido, sin sustituir restricciones. */
export async function verifySharedProposalEditing(f: {actor:string;outsider:string;season:string;category:string;group_id:string}) {
  const db = getPrisma();
  const generated = await generateScheduleForActor(f.actor, {
    seasonId:f.season, categoryId:f.category, groupId:f.group_id, expectedSeasonVersion:1,
    operationId:randomUUID(), reason:"Recorrido integrado de ajustes PDGLD-25",
  });
  assert.ok(generated.ok);
  const id = generated.proposalId;
  const beforeMatches = await db.matches.count();
  const beforeReservations = await db.venue_reservations.count();
  try {
    const row = await db.schedule_proposals.findUniqueOrThrow({where:{id}});
    await assert.rejects(approvedSchedulePdfForActor(f.actor,id),SchedulePdfUnavailable);
    await assert.rejects(approvedSchedulePdfForActor(f.outsider,id),{message:"FORBIDDEN"});
    const proposal = storedProposalSchema.parse(row.parameters);
    const dayOne=proposal.matches.filter(match=>match.round===proposal.matches[0].round);
    const firstSwap={round:dayOne[0].round,first:dayOne[0].home,second:dayOne[1].home};
    const firstPass=proposeTeamSwap(proposal.matches,firstSwap.round,firstSwap.first,firstSwap.second).map(entry=>({...entry.before,home:entry.home,away:entry.away}));
    const afterDay=firstPass.filter(match=>match.round===firstSwap.round);
    const second={round:firstSwap.round,first:afterDay[0].home,second:afterDay[1].away};
    const swap={proposalId:id,expectedVersion:row.version,swaps:[firstSwap,second],reason:"Intercambio de equipos de prueba"};
    const expected=proposeTeamSwap(firstPass,second.round,second.first,second.second).map((entry,index)=>({...entry,changed:entry.home!==proposal.matches[index].home || entry.away!==proposal.matches[index].away}));
    const rollbackSwap=new Error("ROLLBACK_INTERCAMBIO");
    await assert.rejects(db.$transaction(async tx=>{
      await assert.rejects(saveTeamSwapInTransaction(tx,f.outsider,swap),{message:"FORBIDDEN"});
      const saved=await saveTeamSwapInTransaction(tx,f.actor,swap);
      assert.equal(saved.code,"ADJUSTMENT_SAVED");
      const after=await tx.schedule_proposals.findUniqueOrThrow({where:{id}});
      assert.equal(after.version,row.version+1);
      const changed=storedProposalSchema.parse(after.parameters);
      expected.forEach((entry,index)=>{
        assert.equal(changed.matches[index].home,entry.home);
        assert.equal(changed.matches[index].away,entry.away);
        if(entry.changed) {assert.equal(changed.matches[index].venueId,null);assert.equal(changed.matches[index].start,null);}
        else assert.deepEqual(changed.matches[index],proposal.matches[index]);
      });
      assert.equal((await saveTeamSwapInTransaction(tx,f.actor,swap)).code,"STALE_PROPOSAL");
      assert.equal(await tx.audit_logs.count({where:{entity_id:id,action:"UPDATE",reason:swap.reason}}),1);
      throw rollbackSwap;
    },{isolationLevel:"Serializable",timeout:30000}),error=>error===rollbackSwap);
    const original = proposal.matches[0];
    assert.ok(original.start);
    const venues = await db.venues.findMany({where:{is_active:true},select:{id:true}});
    const free = venues.flatMap(venue => [0,1,2].map(hour => ({venueId:venue.id,start:Date.parse("2030-01-06T15:00:00Z")+hour*120*60000})))
      .find(slot => slot.start !== Date.parse(original.start) && !proposal.matches.some((match,index) => index !== 0 &&
        match.venueId === slot.venueId && match.start && match.reservedUntil && slot.start < Date.parse(match.reservedUntil) &&
        Date.parse(match.start) < slot.start + 120*60000));
    assert.ok(free,"La fixture debe ofrecer un horario alternativo libre");
    const first = {...original,venueId:free.venueId,start:new Date(free.start).toISOString(),
      end:new Date(free.start+90*60000).toISOString(),reservedUntil:new Date(free.start+120*60000).toISOString()};
    const input = { proposalId:id, expectedVersion:1, encounterIndex:0, venueId:first.venueId,
      startsAt:first.start, swapHomeAway:true, reason:"Intercambio de localía validado" };
    // La lectura autorizada incluye autor y calendario completo.
    const detail = await readStoredProposalForActor(f.actor, {proposalId:id});
    assert.equal(detail.code,"PROPOSAL_DETAIL");
    if (detail.code === "PROPOSAL_DETAIL") {
      assert.equal(detail.authorId,f.actor);
      assert.equal(detail.proposal.matches.length,190);
    }
    await assert.rejects(editStoredProposalForActor(f.outsider,input), {message:"FORBIDDEN"});
    const saved = await editStoredProposalForActor(f.actor,input);
    assert.equal(saved.code,"ADJUSTMENT_SAVED");
    // Guardado confirmado en servidor pero respuesta descartada por el cliente.
    const replay = await editStoredProposalForActor(f.actor,input);
    assert.equal(replay.code,"STALE_PROPOSAL");
    const stored = await db.schedule_proposals.findUniqueOrThrow({where:{id}});
    const edited = storedProposalSchema.parse(stored.parameters);
    assert.equal(stored.version,2);
    assert.equal(edited.matches[0].home,first.away);
    assert.equal(edited.matches[0].away,first.home);
    assert.equal(edited.matches[0].start,first.start);
    assert.equal(edited.matches[0].venueId,first.venueId);
    assert.equal(edited.matches[0].end,first.end);
    assert.equal(edited.matches[0].reservedUntil,first.reservedUntil);
    assert.equal(edited.requestHash,proposal.requestHash);
    assert.deepEqual(edited.byes,proposal.byes);
    assert.equal(await db.audit_logs.count({where:{entity_id:id,reason:input.reason,action:"UPDATE"}}),1);

    const rollback = Error("ROLLBACK_BLOQUEO_PDGLD25");
    await assert.rejects(db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Bloqueo sintético para ajuste',true)`;
      await tx.venue_availability.create({data:{venue_id:first.venueId,starts_at:new Date(first.start),ends_at:new Date(first.reservedUntil),type:"BLOCK",reason:"Bloqueo posterior a generación"}});
      const blocked = await editStoredProposalInTransaction(tx,f.actor,{...input,expectedVersion:2,swapHomeAway:false});
      assert.equal(blocked.code,"INVALID_SCHEDULE");
      assert.ok("conflicts" in blocked && blocked.conflicts?.some(conflict=>conflict.code==="VENUE_BLOCK"));
      assert.equal((await tx.schedule_proposals.findUniqueOrThrow({where:{id}})).version,2);
      throw rollback;
    },{isolationLevel:"Serializable",timeout:30000}),error=>error===rollback);

    const block = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Bloqueo previo al envío',true)`;
      return tx.venue_availability.create({data:{venue_id:first.venueId,starts_at:new Date(first.start),ends_at:new Date(first.reservedUntil),type:"BLOCK",reason:"Bloqueo posterior a edición"}});
    });
    try {
      const rejected = await changeProposalReviewForActor(f.actor,{proposalId:id,expectedVersion:2,operation:"submit",reason:"Envío con bloqueo sobrevenido"});
      assert.equal(rejected.code,"INVALID_SCHEDULE");
      const unchanged = await db.schedule_proposals.findUniqueOrThrow({where:{id}});
      assert.equal(unchanged.version,2);
      assert.equal(unchanged.status,"DRAFT");
    } finally {
      await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Retirar bloqueo sintético',true)`;
        await tx.venue_availability.delete({where:{id:block.id}});
      });
    }

    const concurrent = await Promise.all([0,1].map(()=>editStoredProposalForActor(f.actor,{...input,expectedVersion:2,swapHomeAway:false})));
    assert.equal(concurrent.filter(result=>result.code==="ADJUSTMENT_SAVED").length,1);
    assert.ok(concurrent.some(result=>["STALE_PROPOSAL","ADJUSTMENT_CONFLICT"].includes(result.code)));
    assert.equal((await db.schedule_proposals.findUniqueOrThrow({where:{id}})).version,3);
    assert.equal((await changeProposalReviewForActor(f.actor,{proposalId:id,expectedVersion:2,operation:"submit",reason:"Envío con versión antigua"})).code,"STALE_PROPOSAL");
    const sent = await changeProposalReviewForActor(f.actor,{proposalId:id,expectedVersion:3,operation:"submit",reason:"Calendario revalidado para revisión"});
    assert.equal(sent.code,"PROPOSAL_UPDATED");
    const reviewed = await db.schedule_proposals.findUniqueOrThrow({where:{id}});
    assert.equal(reviewed.status,"IN_REVIEW");
    assert.equal(reviewed.version,4);
    assert.equal((await editStoredProposalForActor(f.actor,{...input,expectedVersion:4})).code,"INVALID_PROPOSAL_TRANSITION");
    const [reviewer] = await db.$queryRaw<{reviewer:string}[]>`SELECT reviewer FROM public.scheduling_fixture`;
    await assert.rejects(changeProposalReviewForActor(f.actor,{proposalId:id,expectedVersion:4,operation:"approve",reason:"No debe aprobar el programador"}),{message:"FORBIDDEN"});
    const approved = await changeProposalReviewForActor(reviewer.reviewer,{proposalId:id,expectedVersion:4,operation:"approve",reason:"Revisión con permiso exclusivo de aprobación"});
    assert.equal(approved.code,"PROPOSAL_UPDATED");
    assert.equal((await db.schedule_proposals.findUniqueOrThrow({where:{id}})).status,"APPROVED");
    const pdf=await PDFDocument.load(await approvedSchedulePdfForActor(f.actor,id));
    assert.ok(pdf.getPageCount()>0);
    assert.equal(pdf.getTitle(),"Programación de jornadas");
    await assert.rejects(approvedSchedulePdfForActor(f.outsider,id),{message:"FORBIDDEN"});
    assert.equal(await db.matches.count(),beforeMatches+proposal.matches.length);
    assert.equal(await db.venue_reservations.count(),beforeReservations+proposal.matches.length);
    assert.equal(await db.matches.count({where:{schedule_proposal_id:id,match_statuses:{code:"SCHEDULED"}}}),proposal.matches.length);
    const operational=await db.matches.findMany({where:{schedule_proposal_id:id},select:{id:true,version:true,venue_id:true,starts_at:true,ends_at:true,reserved_until:true,home_team_id:true,away_team_id:true}});
    const match=operational.find(m=>m.starts_at?.toISOString().startsWith("2030-01-06"));
    assert.ok(match);
    const candidates=venues.flatMap(venue=>[0,1,2].map(hour=>({venueId:venue.id,start:Date.parse("2030-01-06T15:00:00Z")+hour*120*60000})));
    const slot=candidates.find(candidate=>candidate.start!==match.starts_at!.getTime() && operational.every(other=>other.id===match.id || !other.starts_at || !other.ends_at || !other.reserved_until ||
      !((other.venue_id===candidate.venueId && candidate.start<+other.reserved_until && +other.starts_at<candidate.start+120*60000) ||
      ([other.home_team_id,other.away_team_id].some(team=>[match.home_team_id,match.away_team_id].includes(team)) && candidate.start<+other.ends_at && +other.starts_at<candidate.start+90*60000))));
    assert.ok(slot,"Debe haber horario libre para la reprogramación");
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Preparar programador sintético',true)`;
      const scheduler=await tx.roles.findUniqueOrThrow({where:{code:"SCHEDULER"}});
      for(const action of ["READ","UPDATE"] as const) {
        const permission=await tx.permissions.findUniqueOrThrow({where:{module_action:{module:"scheduling",action}}});
        await tx.role_permissions.createMany({data:[{role_id:scheduler.id,permission_id:permission.id,context_only:true}],skipDuplicates:true});
      }
      const season=await tx.seasons.findUniqueOrThrow({where:{id:f.season}});
      await tx.user_roles.create({data:{user_id:f.actor,role_id:scheduler.id,league_id:season.league_id}});
    });
    const change={matchId:match.id,operationId:randomUUID(),expectedVersion:match.version,venueId:slot.venueId,
      startsAtLocal:venueLocalTime(new Date(slot.start),"America/Mexico_City").slice(0,16),reason:"Cambio por lluvia de prueba"};
    const moved=await db.$transaction(tx=>rescheduleAbsentMatchInTransaction(tx,f.actor,change),{isolationLevel:"Serializable",timeout:30000});
    assert.equal(moved.pdfVersion,2);
    assert.equal((await db.$transaction(tx=>rescheduleAbsentMatchInTransaction(tx,f.actor,change),{isolationLevel:"Serializable",timeout:30000})).pdfVersion,2);
    const version2=await db.audit_logs.findFirstOrThrow({where:{table_name:"schedule_proposals",entity_id:id,action:"SCHEDULE_VERSION"},select:{id:true,new_data:true}});
    const current=await db.matches.findMany({where:{schedule_proposal_id:id},select:{id:true,venue_id:true,starts_at:true,ends_at:true,reserved_until:true,home_team_id:true,away_team_id:true}});
    const nextSlot=candidates.find(candidate=>(candidate.start!==slot.start || candidate.venueId!==slot.venueId) && current.every(other=>other.id===match.id || !other.starts_at || !other.ends_at || !other.reserved_until ||
      !((other.venue_id===candidate.venueId && candidate.start<+other.reserved_until && +other.starts_at<candidate.start+120*60000) ||
      ([other.home_team_id,other.away_team_id].some(team=>[match.home_team_id,match.away_team_id].includes(team)) && candidate.start<+other.ends_at && +other.starts_at<candidate.start+90*60000))));
    assert.ok(nextSlot);
    const secondMove={...change,operationId:randomUUID(),expectedVersion:moved.appliedVersion,venueId:nextSlot.venueId,startsAtLocal:venueLocalTime(new Date(nextSlot.start),"America/Mexico_City").slice(0,16)};
    assert.equal((await db.$transaction(tx=>rescheduleAbsentMatchInTransaction(tx,f.actor,secondMove),{isolationLevel:"Serializable",timeout:30000})).pdfVersion,3);
    assert.deepEqual((await db.audit_logs.findUniqueOrThrow({where:{id:version2.id},select:{new_data:true}})).new_data,version2.new_data);
    const pending={matchId:match.id,operationId:randomUUID(),expectedVersion:moved.appliedVersion+1,toStatus:"UNSCHEDULED",reason:"Espera una cancha disponible"};
    await db.$transaction(tx=>transitionMatchInTransaction(tx,f.actor,pending),{isolationLevel:"Serializable",timeout:30000});
    const versions=await db.audit_logs.findMany({where:{table_name:"schedule_proposals",entity_id:id,action:"SCHEDULE_VERSION"},select:{new_data:true}});
    const version4=versions.map(v=>v.new_data as {version:number;matches:{start:string|null}[]}).find(v=>v.version===4);
    assert.ok(version4?.matches.some(m=>m.start===null),"El PDF actualizado conserva el partido pendiente");
    const updated=await PDFDocument.load(await updatedSchedulePdfForActor(f.actor,id));
    assert.equal(updated.getSubject(),"Programación actualizada");
    await assert.rejects(updatedSchedulePdfForActor(f.outsider,id),{message:"FORBIDDEN"});
  } finally {
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Limpieza de datos sintéticos',true)`;
      await tx.matches.updateMany({where:{schedule_proposal_id:id},data:{deleted_at:new Date(),schedule_proposal_id:null}});
    });
    await db.schedule_proposals.delete({where:{id}});
  }
  // Una aprobación anterior a la integración necesita activarse una sola vez.
  const legacyId=randomUUID(), legacy=storedProposalSchema.parse(generated.proposal);
  await db.schedule_proposals.create({data:{id:legacyId,season_id:f.season,matchday_id:legacy.matches[0].matchdayId,
    competition_rule_id:legacy.ruleId,created_by:f.actor,status:"APPROVED",parameters:JSON.parse(JSON.stringify(legacy))}});
  try {
    const [reviewer]=await db.$queryRaw<{reviewer:string}[]>`SELECT reviewer FROM public.scheduling_fixture`;
    const activation={proposalId:legacyId,expectedVersion:1,reason:"Activar aprobación anterior"};
    await assert.rejects(activatePreviouslyApprovedProposalForActor(f.outsider,activation),{message:"FORBIDDEN"});
    assert.equal((await activatePreviouslyApprovedProposalForActor(reviewer.reviewer,activation)).code,"SCHEDULE_ACTIVATED");
    assert.equal(await db.matches.count({where:{schedule_proposal_id:legacyId}}),legacy.matches.length);
    assert.equal((await activatePreviouslyApprovedProposalForActor(reviewer.reviewer,activation)).code,"PROPOSAL_ALREADY_MATERIALIZED");
  } finally {
    await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT set_config('app.user_id',${f.actor},true),set_config('app.reason','Limpieza de datos sintéticos',true)`;
      await tx.matches.updateMany({where:{schedule_proposal_id:legacyId},data:{deleted_at:new Date(),schedule_proposal_id:null}});
    });
    await db.schedule_proposals.delete({where:{id:legacyId}});
  }
}
