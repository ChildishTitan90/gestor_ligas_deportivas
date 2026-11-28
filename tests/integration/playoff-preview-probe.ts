import assert from 'node:assert/strict';
import { getPrisma } from '../../src/server/db/prisma';
import { previewPlayoffQualifiersForActor } from '../../src/features/competitions/server/playoff-qualifiers';
import { confirmPlayoffBracketForActor, readConfirmedPlayoffBracketForActor, validatePlayoffStandingsForActor } from '../../src/features/competitions/server/playoff-bracket';
import { randomUUID } from 'node:crypto';
import { createPlayoffQuarterfinalsForActor } from '../../src/features/competitions/server/playoff-matches';
import { advancePlayoffResultInTransaction } from '../../src/features/competitions/server/playoff-advance';
import { Prisma } from '@prisma/client';
import { confirmPlayoffPenaltiesForActor } from '../../src/features/competitions/server/playoff-penalties';
import { assertPlayoffDate } from '../../src/features/matches/server/playoff-date';
import { getRescheduleSlotsInTransaction } from '../../src/features/matches/server/reschedule-slots';
import { rescheduleAbsentMatchInTransaction } from '../../src/features/matches/server/reschedule';

const fixture = JSON.parse(process.env.PLAYOFF_PROBE!);
const db = getPrisma();
async function main() { try {
 const [identity] = await db.$queryRaw<{ role:string; rls:boolean }[]>`SELECT current_user::text AS role, row_security_active('sports_management.matches') AS rls`;
 assert.deepEqual(identity, { role: 'gestor_ligas_preview', rls: true });
 for (const item of fixture) {
  const result = await previewPlayoffQualifiersForActor(item.actor, item.season, item.category);
  assert.equal(result.qualified.length, 8);
  assert.deepEqual(result.qualified.map(team => team.teamId), item.expected);
  if(!result.standingsValidated) await validatePlayoffStandingsForActor(item.actor,{seasonId:item.season,categoryId:item.category,fingerprint:result.fingerprint,reason:'Validar clasificación Preview'});
 }
 const first=fixture[0];
 await db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT set_config('app.user_id',${first.actor},true),set_config('app.reason','Prueba de avance Preview',true)`;
   assert.equal((await advancePlayoffResultInTransaction(tx,first.advanceMatch)).code,'ADVANCED');
   assert.equal((await advancePlayoffResultInTransaction(tx,first.advanceMatch)).code,'ADVANCED');
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 assert.equal((await confirmPlayoffPenaltiesForActor(first.actor,first.penalties)).replayed,true);
 assert.equal((await confirmPlayoffPenaltiesForActor(first.actor,first.penaltiesPending)).replayed,false);
 assert.equal((await confirmPlayoffPenaltiesForActor(first.actor,first.penaltiesPending)).replayed,true);
 const semis=await createPlayoffQuarterfinalsForActor(first.actor,{seasonId:first.season,categoryId:first.category,round:'semifinals',reason:'Crear semifinales sintéticas',homeChoices:{}});
 assert.equal(semis.created,2);
 await assert.rejects(createPlayoffQuarterfinalsForActor(first.actor,{seasonId:first.season,categoryId:first.category,round:'final',reason:'Crear final sintética',homeChoices:{}}),/PLAYOFF_PREVIOUS_ROUND_INCOMPLETE/);
 const item=fixture[1];
 const qualifiers=await previewPlayoffQualifiersForActor(item.actor,item.season,item.category);
 const saved=await confirmPlayoffBracketForActor(item.actor,{seasonId:item.season,categoryId:item.category,fingerprint:qualifiers.fingerprint,groupOrder:[],operationId:randomUUID(),reason:'Aprobar liguilla sintética'});
 assert.equal(saved.reused,false);
 const restored=await readConfirmedPlayoffBracketForActor(item.actor,item.season,item.category);
 assert.equal(restored.confirmed,true);
 if(restored.confirmed) assert.equal(restored.rounds.length,4);
 const created=await createPlayoffQuarterfinalsForActor(item.actor,{seasonId:item.season,categoryId:item.category,reason:'Crear cuartos sintéticos',homeChoices:{}});
 assert.equal(created.created,4);
 const after=await readConfirmedPlayoffBracketForActor(item.actor,item.season,item.category);
 assert.equal(after.confirmed && after.created,true);
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT set_config('app.user_id',${item.actor},true),set_config('app.reason','Prueba de fechas de liguilla',true)`;
  const match=await tx.matches.findFirstOrThrow({where:{stage_id:saved.id},select:{id:true,version:true}});
  await assert.doesNotReject(assertPlayoffDate(tx,match.id,'2030-07-07'));
  await assert.rejects(assertPlayoffDate(tx,match.id,'2030-07-08'),{code:'PLAYOFF_ROUND_DATE'});
  const venueId=randomUUID();
  await assert.rejects(getRescheduleSlotsInTransaction(tx,item.actor,{matchId:match.id,venueId,date:'2030-07-08',expectedVersion:match.version}),{code:'PLAYOFF_ROUND_DATE'});
  await assert.rejects(rescheduleAbsentMatchInTransaction(tx,item.actor,{matchId:match.id,operationId:randomUUID(),expectedVersion:match.version,venueId,startsAtLocal:'2030-07-08T12:00',reason:'Prueba de fecha incorrecta'}),{code:'PLAYOFF_ROUND_DATE'});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
 await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT set_config('app.user_id',${item.actor},true),set_config('app.reason','Programar liguilla de prueba',true)`;
  const match=await tx.matches.findFirstOrThrow({where:{stage_id:saved.id},select:{id:true,version:true}});
  const slots=await getRescheduleSlotsInTransaction(tx,item.actor,{matchId:match.id,venueId:first.venue,date:'2030-07-07',expectedVersion:match.version});
  assert.ok(slots.some(slot=>slot.value==='2030-07-07T12:00'));
  const input={matchId:match.id,operationId:randomUUID(),expectedVersion:match.version,venueId:first.venue,startsAtLocal:'2030-07-07T12:00',reason:'Asignar cancha y horario'};
  assert.equal((await rescheduleAbsentMatchInTransaction(tx,item.actor,input)).replayed,false);
  assert.equal((await rescheduleAbsentMatchInTransaction(tx,item.actor,input)).replayed,true);
  const savedMatch=await tx.matches.findUniqueOrThrow({where:{id:match.id},select:{venue_id:true,starts_at:true,match_statuses:{select:{code:true}}}});
  assert.equal(savedMatch.venue_id,first.venue);
  assert.equal(savedMatch.starts_at?.toISOString(),'2030-07-07T12:00:00.000Z');
  assert.equal(savedMatch.match_statuses.code,'SCHEDULED');
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:60000});
 const candidates=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT set_config('app.user_id',${item.actor},true)`;
  return tx.matches.findMany({where:{stage_id:saved.id,venue_id:null},select:{id:true,version:true},take:2});
 });
 assert.equal(candidates.length,2);
 let ready=0;
 let release!:()=>void;
 const bothStarted=new Promise<void>(resolve=>{release=resolve;});
 const attempts=candidates.map((match,index)=>db.$transaction(async tx=>{
  const actor=index===0?item.actor:first.secondScheduler;
  await tx.$queryRaw`SELECT set_config('app.user_id',${actor},true),set_config('app.reason','Reserva simultánea de prueba',true)`;
  if(++ready===2) release();
  await bothStarted;
  return rescheduleAbsentMatchInTransaction(tx,actor,{matchId:match.id,operationId:randomUUID(),expectedVersion:match.version,venueId:first.venue,startsAtLocal:'2030-07-07T15:00',reason:'Reserva simultánea de prueba'});
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000}));
 const results=await Promise.allSettled(attempts);
 assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
 assert.equal(results.filter(result=>result.status==='rejected').length,1);
 const failure=(results.find(result=>result.status==='rejected') as PromiseRejectedResult).reason;
 assert.ok(failure.code==='P2034' || failure.code==='RESERVATION_CONFLICT' || failure.meta?.driverAdapterError?.cause?.originalCode==='23P01',`Unexpected concurrent failure: ${String(failure)} (${failure.code})`);
 const remaining=await db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT set_config('app.user_id',${item.actor},true)`;
  return tx.matches.findMany({where:{id:{in:candidates.map(match=>match.id)}},select:{venue_id:true,starts_at:true,match_statuses:{select:{code:true}}}});
 });
 assert.equal(remaining.filter(match=>match.match_statuses.code==='SCHEDULED' && match.venue_id===first.venue).length,1);
 assert.equal(remaining.filter(match=>match.match_statuses.code==='DRAFT' && !match.venue_id && !match.starts_at).length,1);
} finally { await db.$disconnect(); } }
main().catch(error => { console.error(error); process.exitCode = 1; });
