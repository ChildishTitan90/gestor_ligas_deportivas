import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPrisma } from "../../src/server/db/prisma";
import { generateScheduleForActor } from "../../src/features/scheduling/server/service";
import { editStoredProposalForActor, editStoredProposalInTransaction } from "../../src/features/scheduling/server/stored-proposal-edit";
import { changeProposalReviewForActor } from "../../src/features/scheduling/server/adjustment";
import { readStoredProposalForActor } from "../../src/features/scheduling/server/stored-proposal";
import { storedProposalSchema } from "../../src/features/scheduling/stored-proposal";

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
    const proposal = storedProposalSchema.parse(row.parameters);
    const original = proposal.matches[0];
    const venues = await db.venues.findMany({where:{is_active:true},select:{id:true}});
    const free = venues.flatMap(venue => [0,1,2].map(hour => ({venueId:venue.id,start:Date.parse("2030-01-06T15:00:00Z")+hour*120*60000})))
      .find(slot => slot.start !== Date.parse(original.start) && !proposal.matches.some((match,index) => index !== 0 &&
        match.venueId === slot.venueId && slot.start < Date.parse(match.reservedUntil) &&
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
    assert.equal(await db.matches.count(),beforeMatches);
    assert.equal(await db.venue_reservations.count(),beforeReservations);
  } finally {
    await db.schedule_proposals.delete({where:{id}});
  }
}
