import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { approvedSchedulePdfForActor, SchedulePdfUnavailable } from "../../src/features/scheduling/server/schedule-pdf";
import { changeProposalReviewForActor } from "../../src/features/scheduling/server/adjustment";
import { listSavedScheduleProposals } from "../../src/features/scheduling/server/saved-proposals";
import { getPrisma } from "../../src/server/db/prisma";
import { generateScheduleForActor, validateScheduleProposalInTransaction, previewStoredVenueOptionsForActor } from "../../src/features/scheduling/server/service";
import { rescheduleAbsentMatchInTransaction } from "../../src/features/matches/server/reschedule";
import { updatedSchedulePdfForActor } from "../../src/features/scheduling/server/updated-schedule-pdf";
import { venueLocalTime } from "../../src/features/venues/time";
import { editStoredProposalForActor } from "../../src/features/scheduling/server/stored-proposal-edit";
import { saveTeamSwapInTransaction } from "../../src/features/scheduling/server/team-swap";

test("Preview con RLS genera y recupera una propuesta con préstamos aprobados", async () => {
  const fixture = JSON.parse(process.env.SCHEDULING_PREVIEW_FIXTURE!);
  const db = getPrisma();
  try {
    const [identity]=await db.$queryRaw<{role:string;rls:boolean}[]>`SELECT current_user::text AS role, row_security_active('sports_management.schedule_proposals') AS rls`;
    assert.equal(identity.role,"gestor_ligas_preview");
    assert.equal(identity.rls,true);
    const input = { seasonId: fixture.season, categoryId: fixture.category, groupId: fixture.group_id,
      operationId: randomUUID(), expectedSeasonVersion: 1, reason: "Prueba Preview sintetica" };
    await assert.rejects(generateScheduleForActor(fixture.outsider, input), { message: "FORBIDDEN" });
    const first = await generateScheduleForActor(fixture.actor, input);
    assert.ok(first.ok, first.ok ? "" : first.code);
    if (first.ok) assert.equal((first.proposal as { matches: unknown[] }).matches.length, 190);
    const raw=(first.proposal as {matches:{round:number;matchdayId:string;home:string;away:string;venueId:string;start:string}[]}).matches;
    const matches=raw.map(({round,matchdayId,home,away,venueId,start})=>({round,matchdayId,home,away,venueId,start}));
    const valid=await db.$transaction(tx=>validateScheduleProposalInTransaction(tx,fixture.actor,
      {proposalId:input.operationId,expectedSeasonVersion:1,matches}),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
    assert.ok(valid.ok,"El rol limitado puede validar una propuesta sin modificarla");
    const query={proposalId:input.operationId,expectedVersion:1,encounterIndex:0,startsAt:matches[0].start,swapHomeAway:false};
    await assert.rejects(previewStoredVenueOptionsForActor(fixture.outsider,query),{message:"FORBIDDEN"});
    const options=await previewStoredVenueOptionsForActor(fixture.actor,query);
    assert.equal(options.code,"VENUE_OPTIONS");
    assert.ok(options.code==="VENUE_OPTIONS" && options.venues.some(venue=>venue.venueId===matches[0].venueId));
    const other=matches.find((match,index)=>index!==0 && match.round===matches[0].round && match.venueId && match.start);
    assert.ok(other);
    const occupied=await previewStoredVenueOptionsForActor(fixture.actor,{...query,startsAt:other.start});
    assert.ok(occupied.code==="VENUE_OPTIONS" && !occupied.venues.some(venue=>venue.venueId===other.venueId));
    assert.equal((await previewStoredVenueOptionsForActor(fixture.actor,{...query,expectedVersion:2})).code,"STALE_PROPOSAL");
    const unavailable=await previewStoredVenueOptionsForActor(fixture.actor,{...query,startsAt:"2020-01-01T12:00:00.000Z"});
    assert.ok(unavailable.code==="VENUE_OPTIONS" && unavailable.venues.length===0);

    const day=matches.filter(match=>match.round===matches[0].round);
    const swap={proposalId:input.operationId,expectedVersion:1,swaps:[{round:day[0].round,first:day[0].home,second:day[1].home}],reason:"Intercambio sintético con RLS"};
    const rollbackSwap=Error("ROLLBACK_PREVIEW_SWAP");
    await assert.rejects(db.$transaction(async tx=>{
      await assert.rejects(saveTeamSwapInTransaction(tx,fixture.outsider,swap),{message:"FORBIDDEN"});
      assert.equal((await saveTeamSwapInTransaction(tx,fixture.actor,swap)).code,"ADJUSTMENT_SAVED");
      throw rollbackSwap;
    },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000}),error=>error===rollbackSwap);
    const edit={proposalId:input.operationId,expectedVersion:1,encounterIndex:0,venueId:matches[0].venueId,
      startsAt:matches[0].start,swapHomeAway:false,reason:"Ajuste sintético con RLS"};
    await assert.rejects(editStoredProposalForActor(fixture.outsider,edit),{message:"FORBIDDEN"});
    await assert.rejects(editStoredProposalForActor(fixture.reviewer,edit),{message:"FORBIDDEN"});
    assert.equal((await editStoredProposalForActor(fixture.actor,edit)).code,"ADJUSTMENT_SAVED");
    assert.equal((await editStoredProposalForActor(fixture.actor,edit)).code,"STALE_PROPOSAL");

    await assert.rejects(approvedSchedulePdfForActor(fixture.actor,input.operationId),SchedulePdfUnavailable);
    await assert.rejects(approvedSchedulePdfForActor(fixture.outsider,input.operationId),{message:"FORBIDDEN"});

    const saved = await listSavedScheduleProposals(fixture.actor, fixture.season, fixture.group_id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, input.operationId);
    await assert.rejects(listSavedScheduleProposals(fixture.outsider, fixture.season, fixture.group_id), { message: "FORBIDDEN" });
    const retry = await generateScheduleForActor(fixture.actor, input);
    assert.ok(retry.ok && retry.replayed);
    await assert.rejects(changeProposalReviewForActor(fixture.outsider,{proposalId:input.operationId,expectedVersion:2,operation:"submit",reason:"Intento sin permiso"}),{message:"FORBIDDEN"});
    const submitted=await changeProposalReviewForActor(fixture.actor,{proposalId:input.operationId,expectedVersion:2,operation:"submit",reason:"Enviar a revisión en prueba"});
    assert.equal(submitted.code,"PROPOSAL_UPDATED");
    await assert.rejects(changeProposalReviewForActor(fixture.actor,{proposalId:input.operationId,expectedVersion:3,operation:"approve",reason:"Programador no aprueba"}),{message:"FORBIDDEN"});
    await assert.rejects(changeProposalReviewForActor(fixture.outsider,{proposalId:input.operationId,expectedVersion:3,operation:"return",reason:"Intento sin permiso"}),{message:"FORBIDDEN"});
    const approved=await changeProposalReviewForActor(fixture.reviewer,{proposalId:input.operationId,expectedVersion:3,operation:"approve",reason:"Aprobación de prueba PDF"});
    assert.equal(approved.code,"PROPOSAL_UPDATED");
    const document=await PDFDocument.load(await approvedSchedulePdfForActor(fixture.actor,input.operationId));
    assert.ok(document.getPageCount()>1);
    await assert.rejects(approvedSchedulePdfForActor(fixture.outsider,input.operationId),{message:"FORBIDDEN"});
    const created=await db.matches.findMany({where:{schedule_proposal_id:input.operationId},select:{id:true,version:true,starts_at:true,ends_at:true,reserved_until:true,venue_id:true,home_team_id:true,away_team_id:true}});
    assert.equal(created.length,190);
    const match=created.find(m=>m.starts_at?.toISOString().startsWith("2030-01-06")); assert.ok(match);
    const venues=await db.venues.findMany({select:{id:true}});
    const slots=venues.flatMap(venue=>[0,1,2].map(hour=>({venueId:venue.id,start:Date.parse("2030-01-06T15:00:00Z")+hour*120*60000})));
    const free=slots.find(slot=>slot.start!==match.starts_at!.getTime() && created.every(other=>other.id===match.id || !other.starts_at || !other.ends_at || !other.reserved_until ||
      !((other.venue_id===slot.venueId && slot.start<+other.reserved_until && +other.starts_at<slot.start+120*60000) ||
      ([other.home_team_id,other.away_team_id].some(id=>[match.home_team_id,match.away_team_id].includes(id)) && slot.start<+other.ends_at && +other.starts_at<slot.start+90*60000))));
    assert.ok(free);
    const move={matchId:match.id,operationId:randomUUID(),expectedVersion:match.version,venueId:free.venueId,
      startsAtLocal:venueLocalTime(new Date(free.start),"America/Mexico_City").slice(0,16),reason:"Cambio sintético por lluvia"};
    const moved=await db.$transaction(tx=>rescheduleAbsentMatchInTransaction(tx,fixture.actor,move),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
    assert.equal(moved.pdfVersion,2);
    assert.equal((await PDFDocument.load(await updatedSchedulePdfForActor(fixture.actor,input.operationId))).getSubject(),"Programación actualizada");
    await assert.rejects(updatedSchedulePdfForActor(fixture.outsider,input.operationId),{message:"FORBIDDEN"});

  } finally {
    await db.$disconnect();
  }
});
