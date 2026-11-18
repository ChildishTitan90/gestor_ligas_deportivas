import { listSavedScheduleProposals } from "../../src/features/scheduling/server/saved-proposals";
import { verifySchedulingLoans } from "./scheduling-loans";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma } from "../../src/server/db/prisma";
import { generateScheduleForActor, generateScheduleInTransaction } from "../../src/features/scheduling/server/service";

test("generación real: permisos, persistencia, reintento y rollback", async t => {
 const db=getPrisma();
 try {
  const [f]=await db.$queryRaw<{actor:string;outsider:string;season:string;category:string;group_id:string}[]>`SELECT * FROM public.scheduling_fixture`;
  const input={seasonId:f.season,categoryId:f.category,groupId:f.group_id,operationId:randomUUID(),expectedSeasonVersion:1,reason:"Prueba aislada de generacion"};
  const run=(actor=f.actor,data=input)=>db.$transaction(tx=>generateScheduleInTransaction(tx,actor,data),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
  await assert.rejects(run(f.outsider),{message:"FORBIDDEN"});
  const start=performance.now();
  const first=await run();
  const elapsed=performance.now()-start;
  t.diagnostic(`Servicio completo, 20 equipos/19 jornadas/190 partidos/4 canchas: ${elapsed.toFixed(1)} ms.`);
  assert.ok(elapsed<30000);
  assert.equal(first.ok,true);
  const stored=await db.schedule_proposals.findUniqueOrThrow({where:{id:input.operationId}});
  assert.equal((stored.parameters as {matches:unknown[]}).matches.length,190);
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
  const previewRole=process.env.SCHEDULING_TEST_ROLE;
  assert.match(previewRole??'',/^pdgld135_role_[a-f0-9]+$/);
  await db.$transaction(async tx=>{
    await tx.$executeRawUnsafe(`SET LOCAL ROLE "${previewRole}"`);
    const saved=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:randomUUID()});
    assert.equal(saved.ok,true);
    const receipt=await generateScheduleInTransaction(tx,f.actor,{...input,operationId:saved.ok?saved.proposalId:input.operationId});
    assert.equal(receipt.ok&&receipt.replayed,true);
  },{timeout:30000});
  assert.equal(await db.schedule_proposals.count(),3);
  await assert.rejects(run(f.actor,{...input,operationId:randomUUID(),expectedSeasonVersion:999}),{message:"STALE_CONFIGURATION"});
  await verifySchedulingLoans(f);
  t.diagnostic('Prestamos reales pendientes/rechazados excluidos; aprobados generan 190 partidos en canchas compartidas.');
  await db.venue_availability.deleteMany();
  const impossible=await run(f.actor,{...input,operationId:randomUUID()});
  assert.equal(impossible.ok,false);
  if(!impossible.ok) assert.equal(impossible.code,"NO_AVAILABLE_SLOT");
  assert.equal(await db.schedule_proposals.count(),4);
 } finally { await db.$disconnect(); }
});
