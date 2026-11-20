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

test("Preview con RLS genera y recupera una propuesta con préstamos aprobados", async () => {
  const fixture = JSON.parse(process.env.SCHEDULING_PREVIEW_FIXTURE!);
  const db = getPrisma();
  try {
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

    await assert.rejects(approvedSchedulePdfForActor(fixture.actor,input.operationId),SchedulePdfUnavailable);
    await assert.rejects(approvedSchedulePdfForActor(fixture.outsider,input.operationId),{message:"FORBIDDEN"});
    const saved = await listSavedScheduleProposals(fixture.actor, fixture.season, fixture.group_id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, input.operationId);
    await assert.rejects(listSavedScheduleProposals(fixture.outsider, fixture.season, fixture.group_id), { message: "FORBIDDEN" });
    const retry = await generateScheduleForActor(fixture.actor, input);
    assert.ok(retry.ok && retry.replayed);
    const submitted=await changeProposalReviewForActor(fixture.actor,{proposalId:input.operationId,expectedVersion:1,operation:"submit",reason:"Enviar a revisión en prueba"});
    assert.equal(submitted.code,"PROPOSAL_UPDATED");
    const approved=await changeProposalReviewForActor(fixture.reviewer,{proposalId:input.operationId,expectedVersion:2,operation:"approve",reason:"Aprobación de prueba PDF"});
    assert.equal(approved.code,"PROPOSAL_UPDATED");
    const document=await PDFDocument.load(await approvedSchedulePdfForActor(fixture.actor,input.operationId));
    assert.ok(document.getPageCount()>1);
    await assert.rejects(approvedSchedulePdfForActor(fixture.outsider,input.operationId),{message:"FORBIDDEN"});

  } finally {
    await db.$disconnect();
  }
});
