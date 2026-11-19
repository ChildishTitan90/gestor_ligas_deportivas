import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import type { Client } from "pg";
import sharp from "sharp";
import { formationSlots } from "../../src/features/match-reports/tactics";
import { defaultUniformKits } from "../../src/features/clubs/uniform-kits";
import { readMatchPlayerPhoto } from "../../src/features/match-reports/server/player-photos";
import { syntheticPlayerPolicy } from "../fixtures/player-document-policy";
import { provisionPreviewRuntime, PREVIEW_MARKER } from "../../scripts/preview/runtime-plan.mjs";
import { mutateReport, getCaptureMatches, getReportPage, readReportOperation } from "../../src/features/match-reports/server/service";
import { verifyCaptureMatchList } from "./match-report-list";
import { uploadReportSignature, readReportSignature } from "../../src/features/match-reports/server/signatures";
import { localSignatureStorage } from "../../src/features/match-reports/server/local-signature-storage";
import { getPrisma } from "../../src/server/db/prisma";
import type { ReportCommand, ReportDraft } from "../../src/features/match-reports/contract";

type Fixture = { db: Client; actors: Record<string,string>; people: Record<string,string>; league: string; otherLeague: string; season: string; sc: string; category: string; rule: string; group: string; clubs: string[]; teams: string[]; match: string; presenting: string; scalar: (sql: string, values?: unknown[]) => Promise<string>; runtimeUrl: string; env: Record<string,string|undefined>; runtimePassword: string; serve: boolean };
export async function runReportAcceptance(f: Fixture) {
  const { db, actors, people, league, otherLeague, season, sc, category, group, clubs, teams, match, presenting, scalar } = f;
  Object.assign(process.env,f.env,{DATABASE_URL:f.runtimeUrl});
  const directory = await mkdtemp(join(tmpdir(), "pdgld147-"));
  let app: ReturnType<typeof spawn> | undefined;
  try {
    const person = await scalar("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Capturista','Sintético') RETURNING id");
    actors.capturista = await scalar("INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) SELECT $1,'cedula_capturista','capturista@example.test',password_hash,false FROM sports_management.users WHERE id=$2 RETURNING id", [person, actors.arbitro]);
    await db.query("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$2 FROM sports_management.roles WHERE code='DATA_ENTRY'", [actors.capturista,league]);
    const foreignPerson = await scalar("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Capturista ajeno','Sintético') RETURNING id");
    actors.capturistaAjeno = await scalar("INSERT INTO sports_management.users(person_id,username,email,password_hash,must_change_password) SELECT $1,'cedula_ajeno','ajeno147@example.test',password_hash,false FROM sports_management.users WHERE id=$2 RETURNING id", [foreignPerson, actors.arbitro]);
    await db.query("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$2 FROM sports_management.roles WHERE code='DATA_ENTRY'", [actors.capturistaAjeno,otherLeague]);
    const referee = await scalar("INSERT INTO sports_management.referees(person_id) VALUES($1) RETURNING id", [people.arbitro]);
    await db.query("INSERT INTO sports_management.club_season_referees(referee_id,season_id,club_id) VALUES($1,$2,$3)", [referee,season,presenting]);
    await db.query("INSERT INTO sports_management.referee_availability(referee_id,starts_at,ends_at,is_available) VALUES($1,'2026-12-05T14:00Z','2026-12-05T22:00Z',true)", [referee]);
    const assignment = await scalar("INSERT INTO sports_management.referee_assignments(match_id,referee_id,created_by) VALUES($1,$2,$3) RETURNING id", [match,referee,actors.comision]);
    await db.query("UPDATE sports_management.referee_assignments SET status='APPROVED',approved_by=$2,approved_at=now(),approved_identity_version=1 WHERE id=$1", [assignment,actors.comision]);
    await db.query("UPDATE sports_management.season_categories SET eligibility_pending=false,player_policy=$2 WHERE id=$1", [sc,JSON.stringify({...syntheticPlayerPolicy(),registrationDays:[1,2,3,4,5,6,7]})]);
    for (const club of clubs.slice(1)) await db.query("INSERT INTO sports_management.club_affiliation_categories(affiliation_id,season_id,category_id,authorized_by,authorized_at) SELECT id,$2,$3,$4,now() FROM sports_management.club_affiliations WHERE club_id=$1 AND season_id=$2", [club,season,category,actors.comision]);
    const registrations: string[] = [];
    for (let index = 0; index < 4; index++) {
      const prefix = ["SIAA000101HMNLRRA","SIEA000102HMNLRRA","SIOA000103HMNLRRA","SIOE000104HMNLRRA"][index];
      const alphabet="0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
      const curp=prefix+(10-[...prefix].reduce((total,char,n)=>total+alphabet.indexOf(char)*(18-n),0)%10)%10;
      const dob=`2000-01-0${index+1}`;
      const name=["Alonso","Brenda","Carlos","Dora"][index];
      const id = await scalar("INSERT INTO sports_management.people(first_name,paternal_surname,birth_date,curp) VALUES($1,'Sintético',$2,$3) RETURNING id", [name,dob,curp]);
      const registration = await scalar("INSERT INTO sports_management.player_registrations(person_id,season_id,season_team_id,reference_number,status,jersey_number) VALUES($1,$2,$3,$4,'ACTIVE',$5) RETURNING id", [id,season,teams[index === 1 ? 1 : 0],randomUUID(),index === 0 ? null : index+7]);
      const raw={curp,firstName:name,paternalSurname:"Sintético",maternalSurname:"",birthDate:dob};
      await db.query("INSERT INTO sports_management.player_curp_checks(operation_key,actor_id,person_id,registration_id,identity_version,fingerprint,status) VALUES($1,$2,$3,$4,1,$5,'PENDING')", [randomUUID(),actors.comision,id,registration,createHash("sha256").update(JSON.stringify([1,raw])).digest("hex")]);
      await db.query("UPDATE sports_management.player_curp_checks SET status='VERIFIED',finished_at=now() WHERE registration_id=$1 AND status='PENDING'",[registration]);
      registrations.push(registration);
    }
    // Bloqueo auténtico por inscripción suspendida, sin inventar excepciones ni llamar al proveedor.
    await db.query("UPDATE sports_management.player_registrations SET status='INELIGIBLE' WHERE id=$1", [registrations[2]]);
    await db.query("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('IN_PROGRESS') WHERE id=$1", [match]);
    await db.query(`COMMENT ON DATABASE "${db.database}" IS '${PREVIEW_MARKER}'`);
    for (const row of (await db.query("SELECT tablename FROM pg_tables WHERE schemaname='sports_management'")).rows) await db.query(`ALTER TABLE sports_management."${row.tablename}" ENABLE ROW LEVEL SECURITY`);
    await provisionPreviewRuntime(db);
    await db.query(`ALTER ROLE gestor_ligas_preview LOGIN PASSWORD '${f.runtimePassword}'`);
    Object.assign(process.env,f.env,{DATABASE_URL:f.runtimeUrl});
    const page=await getReportPage(actors.arbitro,match);
    assert.ok(page.players.some(p=>p.id===registrations[0]&&p.eligible), JSON.stringify(page.players.map(p=>({id:p.id,blockers:p.blockers}))));
    assert.equal(page.players.find(p=>p.id===registrations[2])!.eligible,false);
    await assert.rejects(getReportPage(actors.capturistaAjeno,match));
    await assert.rejects(getReportPage(actors.arbitro,randomUUID()),{code:"FORBIDDEN"});
    await db.query("INSERT INTO sports_management.user_roles(user_id,role_id,league_id) SELECT $1,id,$2 FROM sports_management.roles WHERE code='REFEREE'",[actors.programador,league]);
    await assert.rejects(getReportPage(actors.programador,match),{code:"FORBIDDEN"});
    await verifyCaptureMatchList({ db, scalar, actorId: actors.capturista, refereeId: actors.arbitro, unassignedRefereeId: actors.programador, otherLeague, season, group, teams, match, nonParticipantClub: presenting });
    const removedRoles=(await db.query("DELETE FROM sports_management.user_roles WHERE user_id=$1 RETURNING *",[actors.capturista])).rows;
    try{await assert.rejects(getReportPage(actors.capturista,match),{code:"FORBIDDEN"});assert.deepEqual(await getCaptureMatches(actors.capturista),[]);}
    finally{for(const role of removedRoles)await db.query("INSERT INTO sports_management.user_roles SELECT * FROM json_populate_record(NULL::sports_management.user_roles,$1::json)",[JSON.stringify(role)]);}
    const draft: ReportDraft={lineups:[registrations[0],registrations[1],registrations[3]].map((id,index)=>({playerId:id,teamId:teams[index === 1 ? 1 : 0],selected:true,starter:index<2,matchJersey:index+17,periods:[{periodNumber:1,entryMinute:0,exitMinute:null}]})),captains:{[teams[0]]:registrations[0],[teams[1]]:registrations[1]},events:[{id:randomUUID(),typeCode:"GOAL",teamId:teams[0],playerId:registrations[0],outgoingPlayerId:null,periodNumber:null,minute:null,description:"Gol sintético sin minuto"},{id:randomUUID(),typeCode:"SUBSTITUTION",teamId:teams[0],playerId:registrations[3],outgoingPlayerId:registrations[0],periodNumber:1,minute:12,replacementCaptainId:registrations[3],description:"Cambio sintético"}],score:{home:1,away:0},remarks:"Prueba sintética de cédula",incidents:"",signatures:{}};
    draft.tactics=Object.fromEntries(teams.slice(0,2).map((teamId,index)=>[teamId,{formation:"4-2-3-1" as const,slots:formationSlots("4-2-3-1").map((slot,n)=>({...slot,playerId:n===0?registrations[index]:null})),kitSource:"custom" as const,kit:structuredClone(defaultUniformKits.home)}]));
    draft.events.push({id:randomUUID(),typeCode:"INJURY",teamId:teams[0],playerId:registrations[0],outgoingPlayerId:null,periodNumber:1,minute:8,second:12,description:"Lesión sintética; no sustituye automáticamente"});
    const command=(expectedReportVersion:number):ReportCommand=>({formatVersion:1,operationId:randomUUID(),matchId:match,kind:"save",expectedMatchVersion:page.match.version,expectedReportVersion,draft:structuredClone(draft)});
    await assert.rejects(mutateReport(actors.programador,command(0)),{code:"FORBIDDEN"});
    await assert.rejects(mutateReport(actors.capturista,{...command(0),matchId:randomUUID()}),{code:"FORBIDDEN"});
    await db.query("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('CONFIRMED') WHERE id=$1",[match]);
    assert.equal((await getReportPage(actors.arbitro,match)).match.status.captureAllowed,true);
    await assert.rejects(mutateReport(actors.capturista,command(0)),/PREMATCH_LINEUPS_ONLY/);
    const pre=command(0);pre.kind="lock-lineups";pre.draft.events=[];pre.draft.score={home:null,away:null};pre.draft.lineups.forEach(r=>r.periods=[]);
    const {mutateReportInTransaction:prepareLineups}=await import("../../src/features/match-reports/server/service");
    await assert.rejects(getPrisma().$transaction(async tx=>{const ack=await prepareLineups(tx,actors.capturista,pre);assert.equal(ack.status,"DRAFT");const start={...pre,kind:"clock" as const,operationId:randomUUID(),expectedReportVersion:1,clockAction:{type:"start" as const,halfMinutes:45,breakMinutes:15}};const started=await prepareLineups(tx,actors.capturista,start);assert.equal(started.matchVersion,page.match.version+1);assert.deepEqual(await prepareLineups(tx,actors.capturista,start),started);assert.equal(await tx.match_status_history.count({where:{id:start.operationId}}),1);throw Error("PREMATCH_ROLLBACK");},{timeout:30000}),/PREMATCH_ROLLBACK/);
    // Regresión del PR #63: banca reservada a primera mitad, entrada real y salida al descanso.
    await assert.rejects(getPrisma().$transaction(async tx => {
      const own = structuredClone(pre); own.operationId = randomUUID();
      own.draft.lineups.find(r => r.playerId === registrations[3])!.participationHalf = 1;
      const sealed = await prepareLineups(tx, actors.capturista, own);
      let matchVersion = own.expectedMatchVersion;
      const next = (version: number): ReportCommand => ({ ...structuredClone(own), operationId: randomUUID(), expectedMatchVersion: matchVersion, expectedReportVersion: version });
      const start = next(sealed.reportVersion); start.kind = "clock";
      start.clockAction = { type: "start", halfMinutes: 45, breakMinutes: 15 };
      const started = await prepareLineups(tx, actors.capturista, start);
      matchVersion = started.matchVersion;
      // Tiempo sintético explícito del reloj; el test no espera 48 minutos reales.
      const clock = structuredClone(started.clock!);
      clock.phaseStartedAt = new Date(Date.now() - 48 * 60_000).toISOString();
      clock.boundaries!.firstStartedAt = clock.phaseStartedAt;
      await tx.match_reports.update({ where: { id: started.reportId }, data: { draft_data: { formatVersion: 1, draft: own.draft, clock } } });
      const entered = next(started.reportVersion); entered.kind = "save";
      entered.draft.events = [{ id: randomUUID(), typeCode: "SUBSTITUTION", teamId: teams[0],
        playerId: registrations[3], outgoingPlayerId: registrations[0], replacementCaptainId: registrations[3],
        periodNumber: 1, periodMinute: 20, minute: 20, second: 0, description: "Entrada desde banca en primera mitad" }];
      const savedEntry = await prepareLineups(tx, actors.capturista, entered);
      const period = () => tx.player_period_participations.findFirstOrThrow({ where: {
        lineups: { match_report_id: started.reportId, registration_id: registrations[3] }, period_number: 1 },
        select: { entry_minute: true, exit_minute: true } });
      assert.deepEqual(await period(), { entry_minute: 20, exit_minute: null });
      const end = { ...structuredClone(entered), kind: "clock" as const, operationId: randomUUID(), expectedReportVersion: savedEntry.reportVersion,
        clockAction: { type: "end-half" as const } };
      const rest = await prepareLineups(tx, actors.capturista, end);
      assert.equal(rest.clock?.phase, "BREAK");
      assert.deepEqual(await period(), { entry_minute: 20, exit_minute: 48 });
      assert.deepEqual(await prepareLineups(tx, actors.capturista, end), rest, "Reintento idempotente");
      // Nueva lectura del borrador persistido y nuevo guardado durante el descanso.
      const reopened = await tx.match_reports.findUniqueOrThrow({ where: { id: rest.reportId } });
      const stored = reopened.draft_data as unknown as { draft: ReportDraft };
      const again = { ...next(rest.reportVersion), kind: "save" as const, draft: stored.draft };
      await prepareLineups(tx, actors.capturista, again);
      assert.deepEqual(await period(), { entry_minute: 20, exit_minute: 48 });
      assert.equal(await tx.player_period_participations.count({ where: { lineups: {
        match_report_id: rest.reportId, registration_id: registrations[3] }, period_number: 2 } }), 0);
      throw Error("SUBSTITUTE_HALF_ROLLBACK");
    }, { timeout: 30000 }), /SUBSTITUTE_HALF_ROLLBACK/);
    console.log("PDGLD-16 suplente: entrada 20, salida real 48, guardado y relectura, sin segundo periodo; replay: OK");
    // Cédula actual + reserva del día siguiente. Ninguna marca futura inventada.
    await db.query("INSERT INTO sports_management.venue_availability(venue_id,starts_at,ends_at,type) SELECT venue_id,starts_at+interval '1 day',ends_at+interval '1 day','AVAILABLE' FROM sports_management.venue_availability WHERE venue_id=(SELECT venue_id FROM sports_management.matches WHERE id=$1)",[match]);
    const futureMatch=await scalar("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id) SELECT season_id,group_id,matchday_id,'FUTURE-16',home_team_id,away_team_id,venue_id,starts_at+interval '1 day',ends_at+interval '1 day',reserved_until+interval '1 day',sports_management.get_match_status_id('CONFIRMED') FROM sports_management.matches WHERE id=$1 RETURNING id",[match]);
    await assert.rejects(getPrisma().$transaction(async tx=>{
      const future=await tx.matches.findUniqueOrThrow({where:{id:futureMatch}});
      const reserve={...structuredClone(pre),kind:"save" as const,operationId:randomUUID(),matchId:future.id,expectedMatchVersion:future.version};
      const reserved=await prepareLineups(tx,actors.capturista,reserve);
      const own=structuredClone(pre);own.operationId=randomUUID();own.draft.lineups[0].participationHalf=1;
      const sealed=await prepareLineups(tx,actors.capturista,own);
      const start={...own,kind:"clock" as const,operationId:randomUUID(),expectedReportVersion:sealed.reportVersion,clockAction:{type:"start" as const,halfMinutes:40,breakMinutes:10}};
      const started=await prepareLineups(tx,actors.capturista,start);
      assert.equal(started.clock?.phase,"FIRST_HALF");assert.ok(started.clock?.boundaries?.firstStartedAt);
      assert.equal(started.clock?.boundaries?.firstEndedAt,undefined);
      assert.deepEqual(await prepareLineups(tx,actors.capturista,start),started);
      assert.equal((await tx.matches.findUniqueOrThrow({where:{id:match},include:{match_statuses:true}})).match_statuses.code,"IN_PROGRESS");
      const reopened=await tx.match_reports.findUniqueOrThrow({where:{id:started.reportId}});
      assert.equal((reopened.draft_data as {clock:{phase:string}}).clock.phase,"FIRST_HALF");
      assert.equal(await tx.player_period_participations.count({where:{lineups:{match_report_id:started.reportId},period_number:1,entry_minute:0,exit_minute:null}}),1);
      const pending=await tx.match_reports.findUniqueOrThrow({where:{id:reserved.reportId}});
      assert.equal((pending.draft_data as {clock?:unknown}).clock,undefined);
      assert.equal(await tx.lineups.count({where:{match_report_id:reserved.reportId}}),reserve.draft.lineups.length);
      assert.equal(await tx.player_period_participations.count({where:{lineups:{match_report_id:reserved.reportId}}}),0);
      throw Error("FUTURE_RESERVATION_ROLLBACK");
    },{timeout:30000}),/FUTURE_RESERVATION_ROLLBACK/);
    console.log("PDGLD-16 cédula real: reserva futura sin juego permite sellar e iniciar el partido actual; reloj y periodos persisten; replay: OK");
    await db.query("UPDATE sports_management.matches SET status_id=sports_management.get_match_status_id('IN_PROGRESS') WHERE id=$1",[match]);
    const invalidPosition=command(0);invalidPosition.draft.tactics![teams[0]].slots[0].playerId=registrations[1];
    await assert.rejects(mutateReport(actors.capturista,invalidPosition),/TACTICS_LINEUP_MISMATCH/);
    const invalidChange=command(0);invalidChange.kind="lock-lineups";invalidChange.draft.events[1].outgoingPlayerId=registrations[3];
    await assert.rejects(mutateReport(actors.capturista,invalidChange),/INVALID_SUBSTITUTION_ORDER/);
    const unsealed=command(0);await assert.rejects(mutateReport(actors.capturista,unsealed),/LINEUPS_NOT_LOCKED/);
    const first=command(0);first.kind="lock-lineups";const receipt=await mutateReport(actors.capturista,first);
    assert.equal(receipt.reportVersion,1);
    assert.ok(receipt.lineupsLock);
    assert.equal((await db.query("SELECT second FROM sports_management.match_events WHERE match_report_id=$1 AND minute=8",[receipt.reportId])).rows[0].second,12);
    const invalidSecond=command(1);invalidSecond.draft.events[2].second=60;await assert.rejects(mutateReport(actors.capturista,invalidSecond),/INVALID_PAYLOAD/);
    await assert.rejects(getPrisma().$transaction(async tx=>{
      const extra=command(1);extra.draft.events.push({id:randomUUID(),typeCode:'ASSIST',teamId:teams[0],playerId:registrations[0],outgoingPlayerId:null,minute:null,periodNumber:null,description:'Asistencia sintética'},{id:randomUUID(),typeCode:'OWN_GOAL',teamId:teams[0],playerId:registrations[0],outgoingPlayerId:null,minute:5,second:12,periodNumber:1,description:'Autogol sintético'});extra.draft.score.away=1;
      const ack=await prepareLineups(tx,actors.capturista,extra);assert.equal(ack.reportVersion,2);
      assert.equal(await tx.match_events.count({where:{match_report_id:receipt.reportId,event_types:{code:{in:['ASSIST','OWN_GOAL']}}}}),2);
      throw Error('ASSIST_TEST_ROLLBACK');
    },{timeout:30000}),/ASSIST_TEST_ROLLBACK/);
    for(const minute of [-1,1.5]){const invalid=command(1);invalid.draft.events[0].minute=minute;await assert.rejects(mutateReport(actors.capturista,invalid),/INVALID_PAYLOAD/);}
    const reentry=command(1);reentry.draft.events.push({id:randomUUID(),typeCode:"SUBSTITUTION",teamId:teams[0],playerId:registrations[0],outgoingPlayerId:registrations[3],periodNumber:1,minute:20,description:"Reingreso no permitido"});await assert.rejects(mutateReport(actors.capturista,reentry),/INVALID_SUBSTITUTION_ORDER/);
    const frozen=command(1);frozen.draft.lineups[0].matchJersey=88;await assert.rejects(mutateReport(actors.capturista,frozen),/LINEUPS_LOCKED/);
    const {mutateReportInTransaction:clockMutation}=await import("../../src/features/match-reports/server/service");
    await assert.rejects(getPrisma().$transaction(async tx=>{
      const clockStart={...command(1),kind:"clock" as const,clockAction:{type:"start" as const,halfMinutes:45,breakMinutes:15}};
      const started=await clockMutation(tx,actors.capturista,clockStart);assert.equal(started.clock?.phase,"FIRST_HALF");
      assert.deepEqual(await clockMutation(tx,actors.capturista,clockStart),started);
      const extra=await clockMutation(tx,actors.capturista,{...command(2),kind:"clock",clockAction:{type:"add-time",minutes:3}});assert.equal(extra.clock?.extraMinutes,3);
      const rest=await clockMutation(tx,actors.capturista,{...command(3),kind:"clock",clockAction:{type:"end-half"}});assert.equal(rest.clock?.phase,"BREAK");
      const blockedGoal=command(4);blockedGoal.draft.events[0].description="No se permite modificar goles durante el descanso";
      await assert.rejects(clockMutation(tx,actors.capturista,blockedGoal),/BREAK_SUBSTITUTIONS_ONLY/);
      const breakChange=command(4);Object.assign(breakChange.draft.events[1],{periodNumber:2,minute:45,second:0,periodMinute:0});
      const wrongTime=structuredClone(breakChange);wrongTime.draft.events[1].second=1;
      await assert.rejects(clockMutation(tx,actors.capturista,wrongTime),/BREAK_SUBSTITUTION_TIME/);
      const changed=await clockMutation(tx,actors.capturista,breakChange);assert.equal(changed.reportVersion,5);
      assert.deepEqual(await clockMutation(tx,actors.capturista,breakChange),changed);
      const savedChange=await tx.match_events.findUniqueOrThrow({where:{id:breakChange.draft.events[1].id},select:{minute:true,second:true,period_number:true}});
      assert.deepEqual(savedChange,{minute:45,second:0,period_number:2});
      assert.equal((await tx.player_period_participations.findFirstOrThrow({where:{lineups:{match_report_id:receipt.reportId,registration_id:registrations[3]},period_number:2},select:{entry_minute:true}})).entry_minute,0);
      const afterChange=(version:number)=>({...command(version),draft:structuredClone(breakChange.draft)});
      await clockMutation(tx,actors.capturista,{...afterChange(5),kind:"clock",clockAction:{type:"set-break",minutes:20}});
      const second=await clockMutation(tx,actors.capturista,{...afterChange(6),kind:"clock",clockAction:{type:"start-second"}});assert.equal(second.clock?.phase,"SECOND_HALF");
      const ended=await clockMutation(tx,actors.capturista,{...afterChange(7),kind:"clock",clockAction:{type:"end-half"}});assert.equal(ended.clock?.phase,"ENDED");
      throw Error("CLOCK_TEST_ROLLBACK");
    },{timeout:30000}),/CLOCK_TEST_ROLLBACK/);

    assert.equal((await getReportPage(actors.arbitro,match)).report.tactics![teams[0]].formation,"4-2-3-1");
    const times=(await db.query("SELECT l.registration_id,p.entry_minute,p.exit_minute FROM sports_management.lineups l JOIN sports_management.player_period_participations p ON p.lineup_id=l.id WHERE l.match_report_id=$1",[receipt.reportId])).rows;
    assert.equal(times.find(r=>r.registration_id===registrations[0]).exit_minute,12);
    assert.equal(times.find(r=>r.registration_id===registrations[3]).entry_minute,12);
    await db.query("UPDATE sports_management.club_affiliations SET uniform_kits=$2 WHERE club_id=$1 AND season_id=$3",[clubs[1],JSON.stringify({...defaultUniformKits,home:{...defaultUniformKits.home,primary:{r:200,g:12,b:30}}}),season]);
    assert.deepEqual((await getReportPage(actors.arbitro,match)).match.home.uniformKits?.home.primary,{r:200,g:12,b:30});
    assert.deepEqual((await getReportPage(actors.arbitro,match)).report.tactics![teams[0]].kit,defaultUniformKits.home);

    assert.deepEqual(await mutateReport(actors.capturista,first),receipt);
    assert.equal((await readReportOperation(actors.capturista,match,first.operationId)).status,"APPLIED");
    await assert.rejects(mutateReport(actors.capturista,{...first,draft:{...draft,remarks:"Otra intención"}}),/OPERATION_KEY_REUSED/);
    await assert.rejects(mutateReport(actors.capturista,command(0)),/STALE_VERSION/);
    await assert.rejects(mutateReport(actors.capturistaAjeno,command(1)));
    const blocked=command(1);blocked.draft.lineups.push({playerId:registrations[2],teamId:teams[0],selected:true,starter:false,matchJersey:99,periods:[]});
    await assert.rejects(mutateReport(actors.capturista,blocked),/PLAYER_NOT_ELIGIBLE/);
    const race=await Promise.allSettled([mutateReport(actors.capturista,command(1)),mutateReport(actors.arbitro,command(1))]);
    assert.equal(race.filter(r=>r.status==="fulfilled").length,1);
    assert.equal((await getReportPage(actors.capturista,match)).report.version,2);
    await db.query("UPDATE sports_management.player_registrations SET jersey_number=45 WHERE id=$1",[registrations[0]]);
    assert.equal((await getReportPage(actors.arbitro,match)).report.lineups.find(p=>p.playerId===registrations[0])!.matchJersey,17);
    const badScore=command(2);badScore.draft.score.home=2;
    await assert.rejects(mutateReport(actors.capturista,badScore),/SCORE_EVENTS_MISMATCH/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.match_events WHERE match_report_id=$1 AND minute IS NULL",[receipt.reportId])).rows[0].n,1);
    const storage=localSignatureStorage(directory);
    const png=await sharp({create:{width:600,height:200,channels:3,background:"white"}}).composite([{input:Buffer.from('<svg width="600" height="200"><path d="M10 100 Q100 10 400 150" fill="none" stroke="black" stroke-width="3"/></svg>')}]).png().toBuffer();
    const photoRegistration=registrations[0];
    const photoLeague=(await db.query("SELECT league_id FROM sports_management.seasons WHERE id=$1",[season])).rows[0].league_id;
    const photoKey=`player-documents/v1/${photoLeague}/${season}/${photoRegistration}/${randomUUID()}/${randomUUID()}`;
    const photoFile=await scalar("INSERT INTO sports_management.files(storage_key,original_name,mime_type,size_bytes,sha256,uploaded_by) VALUES($1,'foto-sintetica.png','image/png',$2,$3,$4) RETURNING id",[photoKey,png.length,createHash("sha256").update(png).digest("hex"),actors.capturista]);
    const photoDoc=await scalar("INSERT INTO sports_management.player_documents(registration_id,document_type_id,file_id,status) SELECT $1,id,$2,'VALIDATED' FROM sports_management.document_types WHERE code='PHOTO' RETURNING id",[photoRegistration,photoFile]);
    await db.query("INSERT INTO sports_management.audit_logs(user_id,action,table_name,entity_id,new_data,reason) VALUES($1,'PLAYER_DOCUMENT_CONFIRMED','player_documents',$2,$3,'Foto sintética; sin proveedor externo')",[actors.capturista,photoRegistration,JSON.stringify({documentId:photoDoc,fileId:photoFile,identityVersion:1,replacesDocumentId:null})]);
    const photoStorage={async read(key:string){assert.equal(key,photoKey);return png;}};
    assert.match((await getReportPage(actors.arbitro,match)).players.find(p=>p.id===photoRegistration)!.photoUrl!,/\/photo$/);
    assert.equal((await readMatchPlayerPhoto(actors.arbitro,match,photoRegistration,photoStorage)).bytes.length,png.length);
    assert.equal((await readMatchPlayerPhoto(actors.capturista,match,photoRegistration,photoStorage)).mimeType,"image/png");
    await assert.rejects(readMatchPlayerPhoto(actors.capturistaAjeno,match,photoRegistration,{async read(){throw Error("STORAGE_MUST_NOT_BE_CALLED");}}),e=>e instanceof Error&&!e.message.includes("STORAGE_MUST_NOT_BE_CALLED"));
    await assert.rejects(readMatchPlayerPhoto(actors.arbitro,match,registrations[1],photoStorage));
    await assert.rejects(readMatchPlayerPhoto(actors.arbitro,match,photoRegistration,{async read(){return new Uint8Array([1,2,3]);}}));
    await assert.rejects(readMatchPlayerPhoto(actors.arbitro,match,photoRegistration,{async read(){await db.query("UPDATE sports_management.player_documents SET status='REJECTED' WHERE id=$1",[photoDoc]);return png;}}));
    await db.query("UPDATE sports_management.player_documents SET status='VALIDATED' WHERE id=$1",[photoDoc]);
    for(let index=0;index<2;index++){
      const upload={operationId:randomUUID(),matchId:match,teamId:teams[index],captainId:registrations[index===0?3:1],expectedMatchVersion:page.match.version,expectedReportVersion:2,draft:structuredClone(draft),image:"data:image/png;base64,"+png.toString("base64")};
      if(index===0){
        await assert.rejects(uploadReportSignature(actors.capturista,upload,{...storage,async put(key,object){await storage.put(key,object);throw Error("LOST_STORAGE_ACK");}}),/LOST_STORAGE_ACK/);
        assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.files WHERE original_name='firma-capitan.png'")).rows[0].n,0,"Subida externa sin enlace SQL; el objeto se conserva para reintentar");
      }
      const signature=await uploadReportSignature(actors.capturista,upload,storage);
      assert.deepEqual(await uploadReportSignature(actors.capturista,upload,storage),signature);
      draft.signatures[teams[index]]=signature.fileId;
    }
    const signed=command(2);signed.draft=structuredClone(draft);
    await mutateReport(actors.capturista,signed);
    assert.equal((await readReportSignature(actors.arbitro,match,draft.signatures[teams[0]]!,storage)).length,png.length);
    await assert.rejects(readReportSignature(actors.capturistaAjeno,match,draft.signatures[teams[0]]!,storage));
    const changed=command(3);changed.draft.remarks="Cambio tras firmar";
    await assert.rejects(mutateReport(actors.capturista,changed),/INVALID_SIGNATURE_REFERENCE/);
    await assert.rejects(mutateReport(actors.capturista,{...command(3),kind:"confirm"}),/CONFIRMATION_DEPENDENCIES_PENDING/);
    const confirmations=await Promise.allSettled([mutateReport(actors.capturista,{...command(3),kind:"confirm"}),mutateReport(actors.arbitro,{...command(3),kind:"confirm"})]);
    assert.ok(confirmations.every(r=>r.status==='rejected'&&r.reason.code==='CONFIRMATION_DEPENDENCIES_PENDING'),"Bloqueo real: no equivale a confirmar una vez");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.match_results WHERE match_id=$1",[match])).rows[0].n,0);
    assert.equal((await getReportPage(actors.arbitro,match)).report.version,3);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.match_status_history WHERE match_id=$1",[match])).rows[0].n,0);
    await assert.rejects(mutateReport(actors.capturista,{...command(3),expectedMatchVersion:page.match.version+1}),/STALE_VERSION/);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.role_permissions rp JOIN sports_management.permissions p ON p.id=rp.permission_id JOIN sports_management.roles r ON r.id=rp.role_id WHERE p.module='match-reports' AND p.action='APPROVE' AND r.code IN ('REFEREE','DATA_ENTRY')")).rows[0].n,0);
    // Una transacción abortada no deja cédula parcial ni un acuse APPLIED.
    const rollback=command(3);rollback.draft.signatures={};
    const {mutateReportInTransaction}=await import("../../src/features/match-reports/server/service");
    await assert.rejects(getPrisma().$transaction(async tx=>{await mutateReportInTransaction(tx,actors.capturista,rollback);throw Error("ROLLBACK_TEST");},{timeout:30000}),/ROLLBACK_TEST/);
    assert.equal((await readReportOperation(actors.capturista,match,rollback.operationId)).status,"UNKNOWN");
    const draftMatch=await scalar("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id) SELECT season_id,group_id,matchday_id,'DRAFT-147',home_team_id,away_team_id FROM sports_management.matches WHERE id=$1 RETURNING id",[match]);
    await assert.rejects(mutateReport(actors.capturista,{...command(0),matchId:draftMatch,expectedMatchVersion:1}),/MATCH_STATE_BLOCKED/);
    const finishedMatch=await scalar("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id) SELECT season_id,group_id,matchday_id,'FINISHED-147',home_team_id,away_team_id,venue_id,starts_at+interval '2 hours',ends_at+interval '2 hours',reserved_until+interval '2 hours',sports_management.get_match_status_id('FINISHED') FROM sports_management.matches WHERE id=$1 RETURNING id",[match]);
    await assert.rejects(mutateReport(actors.capturista,{...command(0),matchId:finishedMatch,expectedMatchVersion:1}),/MATCH_STATE_BLOCKED/);
    await assert.rejects(getPrisma().$executeRaw`UPDATE sports_management.matches SET starts_at=starts_at WHERE id=${match}::uuid`);
    if(process.argv.includes("--http")) {
      const env={...f.env,NODE_ENV:"development" as const,DATABASE_URL:f.runtimeUrl,REPORT_SIGNATURE_LOCAL_DIRECTORY:directory};
      app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","3198"],{env,stdio:"inherit",windowsHide:true});
      const base="http://127.0.0.1:3198";
      let ready=false;
      for(let n=0;n<180;n++){if(app.exitCode!==null)throw Error("REPORT_APP_EXITED");try{const response=await fetch(base+"/api/auth/csrf",{signal:AbortSignal.timeout(2000)});if(response.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,500));}
      if(!ready)throw Error("REPORT_APP_NOT_READY");
      const {verifyReportHttp}=await import("./match-reports-http");
      await verifyReportHttp(base,actors,command(3),draft.signatures[teams[0]]!,"data:image/png;base64,"+png.toString("base64"));
      if(process.argv.includes("--browser")){
        const {verifyRealMatchReportBrowser}=await import("../e2e/match-reports-real.mjs");
        // El escenario HTTP anterior registró periodos sin reloj. Para reutilizar
        // sus jugadores en otro partido, aportar evidencia sintética explícita
        // de que terminó antes de iniciar el escenario Chrome (no inferirla del horario).
        const {advanceMatchClock}=await import("../../src/features/match-reports/match-clock");
        const endedAt=Date.now()-60_000;
        let priorClock=advanceMatchClock(null,{type:"start",halfMinutes:40,breakMinutes:10},new Date(endedAt-90*60_000).toISOString());
        priorClock=advanceMatchClock(priorClock,{type:"end-half"},new Date(endedAt-50*60_000).toISOString());
        priorClock=advanceMatchClock(priorClock,{type:"start-second"},new Date(endedAt-40*60_000).toISOString());
        priorClock=advanceMatchClock(priorClock,{type:"end-half"},new Date(endedAt).toISOString());
        await db.query("UPDATE sports_management.match_reports SET draft_data=jsonb_set(draft_data,'{clock}',$2::jsonb,true) WHERE match_id=$1",[match,JSON.stringify(priorClock)]);
        const browserMatch=await scalar("INSERT INTO sports_management.matches(season_id,group_id,matchday_id,number,home_team_id,away_team_id,venue_id,starts_at,ends_at,reserved_until,status_id) SELECT season_id,group_id,matchday_id,'BROWSER-149',home_team_id,away_team_id,venue_id,starts_at+interval '4 hours',ends_at+interval '4 hours',reserved_until+interval '4 hours',sports_management.get_match_status_id('CONFIRMED') FROM sports_management.matches WHERE id=$1 RETURNING id",[match]);
        await verifyRealMatchReportBrowser({base,match:browserMatch,postgres:process.argv.find(a=>a.startsWith('--postgres='))?.split('=')[1]??'15'});
      }
      if(app.pid&&process.platform==="win32")spawnSync("taskkill",["/PID",String(app.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});else app.kill();
      await new Promise<void>(resolve=>app!.exitCode!==null?resolve():app!.once("exit",()=>resolve()));app=undefined;
    }
    if(!f.serve){
      await db.query("UPDATE sports_management.referee_assignments SET status='REVOKED' WHERE id=$1",[assignment]);
      assert.deepEqual(await getCaptureMatches(actors.arbitro),[]);
      assert.ok((await getCaptureMatches(actors.capturista)).some(row=>row.id===match));
      await assert.rejects(getReportPage(actors.arbitro,match));
      assert.ok(await getReportPage(actors.capturista,match),"DATA_ENTRY no utiliza la designación del árbitro");
    }
    console.log("PDGLD-147 OK: PostgreSQL desechable, rol Preview/RLS, árbitro efectivo, DATA_ENTRY propio/ajeno, elegibilidad, dorsal histórico, periodos, marcador, firmas privadas/reintentos, versiones concurrentes, acuse, rollback y confirmación bloqueada sin efectos.");
    if(f.serve){
      const env={...f.env,NODE_ENV:"development" as const,DATABASE_URL:f.runtimeUrl,REPORT_SIGNATURE_LOCAL_DIRECTORY:directory};
      console.log(`Revisión aislada: http://127.0.0.1:3198/matches/${match}/report · usuarios arbitraje_arbitro / cedula_capturista / cedula_ajeno · clave sintética Arbitraje-Local-141!`);
      app=spawn(process.execPath,["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port","3198"],{env,stdio:"inherit",windowsHide:true});
      await new Promise<void>(resolve=>{process.once("SIGINT",()=>{app?.kill();resolve();});app!.once("exit",()=>resolve());});
    }
  } finally {
    if(app?.pid&&app.exitCode===null){if(process.platform==="win32")spawnSync("taskkill",["/PID",String(app.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});else app.kill();}
    await getPrisma().$disconnect();await rm(directory,{recursive:true,force:true});
  }
}
