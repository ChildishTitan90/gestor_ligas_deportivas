import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { TestContext } from "node:test";
import { evaluateMatchForActor, listAssignedMatchesForActor } from "../../src/features/matches/server/eligibility";
import { AuthorizationError } from "../../src/server/auth/authorization";

export async function runMatchEligibilityTests(t: TestContext, db: PrismaClient, actors: Record<string, string>, originId: string) {
  const audit = <T,>(run: (tx: Prisma.TransactionClient) => Promise<T>) => db.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Fixture sintético PDGLD-16',true)`;
    return run(tx);
  });
  const reg = await db.player_registrations.findUniqueOrThrow({ where: { id: originId } });
  const target = await db.player_category_participations.findFirstOrThrow({ where: { origin_registration_id: originId, status: "AUTHORIZED" } });
  const team = await db.season_teams.findUniqueOrThrow({ where: { id: target.target_season_team_id } });
  const season = await db.seasons.findUniqueOrThrow({ where: { id: reg.season_id } });
  const nonce = randomUUID();
  const day = await db.matchdays.create({ data: { season_id: reg.season_id, number: 900, start_date: new Date("2026-11-11"), end_date: new Date("2026-11-12") } });
  // Otro inscrito sintético de la misma categoría para completar el partido.
  assert.ok(team.group_id);
  const groupId = team.group_id;
  const otherTeam = await db.teams.create({ data: { club_id: team.club_id, name: `Rival ${nonce}`, reference_number: nonce } });
  const other = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Fixture sintético PDGLD-16',true)`;
    return tx.season_teams.create({ data: { season_id: reg.season_id, club_id: team.club_id, group_id: groupId, team_id: otherTeam.id } });
  });
  const venue = await db.venues.create({data:{league_id:season.league_id,code:nonce,name:"Cancha sintética",address:"Domicilio sintético"}});
  const match = await audit(tx=>tx.matches.create({ data: { season_id: reg.season_id, group_id: groupId, matchday_id: day.id, number: nonce,
    home_team_id: team.id, away_team_id: other.id, venue_id:venue.id, reserved_until:new Date("2026-11-11T20:00:00Z"), starts_at: new Date("2026-11-11T18:00:00Z"), ends_at: new Date("2026-11-11T20:00:00Z") } }));
  const user = await db.users.findUniqueOrThrow({ where: { id: actors.delegate } });
  assert.ok(user.person_id);
  const referee = await db.referees.create({ data: { person_id: user.person_id } });
  const role = await db.roles.findUniqueOrThrow({ where: { code: "REFEREE" } });
  const permission = await db.permissions.upsert({ where: { module_action: { module: "match-reports", action: "CREATE" } }, update: {}, create: { module: "match-reports", action: "CREATE" } });
  await audit(tx=>tx.role_permissions.upsert({ where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } }, update: { context_only: false }, create: { role_id: role.id, permission_id: permission.id, context_only: false } }));
  const updatePermission = await db.permissions.upsert({where:{module_action:{module:"match-reports",action:"UPDATE"}},update:{},create:{module:"match-reports",action:"UPDATE"}});
  await audit(tx=>tx.role_permissions.upsert({where:{role_id_permission_id:{role_id:role.id,permission_id:updatePermission.id}},update:{context_only:true},create:{role_id:role.id,permission_id:updatePermission.id,context_only:true}}));
  await audit(tx=>tx.user_roles.create({ data: { user_id: user.id, role_id: role.id, league_id: season.league_id } }));
  const assignment = await audit(tx=>tx.referee_assignments.create({ data: { match_id: match.id, referee_id: referee.id, status: "APPROVED", created_by: actors.admin, approved_by: actors.admin, approved_at: new Date() } }));
  const evaluate = () => evaluateMatchForActor(user.id, match.id);
  const player = async () => (await evaluate()).players.find(p => p.registrationId === originId && p.seasonTeamId === team.id)!;
  await t.test("PDGLD-16: árbitro designado evalúa superior autorizado y origen no cambia", async () => {
    assert.equal((await player()).eligible, true, JSON.stringify((await player()).blockers));
    const denied = (await evaluate()).players.find(p => p.registrationId === originId && p.seasonTeamId === other.id);
    assert.equal(denied, undefined, "Otra categoría sin autorización para el rival queda fuera del DTO");
    assert.equal((await listAssignedMatchesForActor(user.id)).some(m => m.id === match.id), true);
    assert.equal((await db.player_registrations.findUniqueOrThrow({ where: { id: originId } })).season_team_id, reg.season_team_id);
  });
  await t.test("PDGLD-16: ambas plantillas aparecen y otra categoría sin autorización queda fuera", async () => {
    const ids: string[]=[];
    for (const seasonTeamId of [team.id,other.id,reg.season_team_id]) {
      const prefix=`ZAX${["A","E","I"][ids.length]}000101HMNLRR0`;
      const alphabet="0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
      const sum=[...prefix].reduce((total,char,index)=>total+alphabet.indexOf(char)*(18-index),0);
      const person=await db.people.create({data:{first_name:"Jugador sintético",paternal_surname:randomUUID(),
        birth_date:new Date("2000-01-01"),curp:prefix+(10-sum%10)%10}});
      const registration=await audit(tx=>tx.player_registrations.create({data:{person_id:person.id,
        season_id:season.id,season_team_id:seasonTeamId,reference_number:randomUUID()}}));
      ids.push(registration.id);
    }
    const result=await evaluate();
    assert.ok(result.players.some(p=>p.registrationId===ids[0] && p.seasonTeamId===team.id));
    assert.ok(result.players.some(p=>p.registrationId===ids[1] && p.seasonTeamId===other.id));
    assert.equal(result.players.some(p=>p.registrationId===ids[2]),false,
      "Mismo club y temporada no autorizan la inscripción de la categoría de origen");
    assert.ok(result.players.some(p=>p.registrationId===originId && p.seasonTeamId===team.id && p.eligible),
      "La participación superior válida sí se incluye");
  });
  await t.test("PDGLD-16: ni administrador sin designación ni otro árbitro obtiene el partido", async () => {
    await assert.rejects(evaluateMatchForActor(actors.admin, match.id), e => e instanceof AuthorizationError);
    await assert.rejects(evaluateMatchForActor(actors.other, match.id), e => e instanceof AuthorizationError);
    await audit(tx=>tx.referee_assignments.update({ where: { id: assignment.id }, data: { status: "REVOKED" } }));
    await assert.rejects(evaluate(), e => e instanceof AuthorizationError);
    await audit(tx=>tx.referee_assignments.update({ where: { id: assignment.id }, data: { status: "APPROVED" } }));
  });
  await t.test("PDGLD-16: pertenencia inmutable y cambio de equipo tras inicio se rechazan en PostgreSQL", async () => {
    await assert.rejects(audit(tx=>tx.player_registrations.update({where:{id:reg.id},data:{season_team_id:other.id}})),/pertenencia|TEAM_CHANGE|inmutable/i);
    await audit(tx=>tx.seasons.update({where:{id:season.id},data:{competition_starts_at:new Date("2026-01-01")}}));
    try {
      await assert.rejects(audit(tx=>tx.player_registrations.create({data:{...reg,id:randomUUID(),reference_number:randomUUID(),season_team_id:other.id}})),/cambiar equipo|TEAM_CHANGE/i);
    } finally {
      await audit(tx=>tx.seasons.update({where:{id:season.id},data:{competition_starts_at:season.competition_starts_at}}));
    }
  });
  await t.test("PDGLD-16: dorsal no invalida identidad/documentos y horario ausente impide certificar", async () => {
    const before = await db.player_curp_checks.count({ where: { person_id: reg.person_id } });
    await audit(tx=>tx.player_registrations.update({ where: { id: originId }, data: { jersey_number: 88 } }));
    assert.equal((await player()).eligible, true);
    assert.equal((await player()).jerseyNumber, 88);
    assert.equal(await db.player_curp_checks.count({ where: { person_id: reg.person_id } }), before);
    await audit(tx=>tx.matches.update({ where: { id: match.id }, data: { starts_at: null, ends_at: null, reserved_until:null } }));
    assert.ok((await player()).blockers.some(b => b.code === "MATCH_TIME_REQUIRED"));
    await audit(tx=>tx.matches.update({ where: { id: match.id }, data: { starts_at: match.starts_at, ends_at: match.ends_at, reserved_until:match.reserved_until } }));
  });
  await t.test("PDGLD-16: sanción se evalúa a la fecha del partido, con inicio inclusivo y fin exclusivo", async () => {
    const type = await db.sanction_types.findUniqueOrThrow({where:{code:"TIME"}});
    const rule = await db.competition_rules.findFirstOrThrow({where:{season_id:season.id}});
    const article = await db.regulation_articles.create({data:{competition_rule_id:rule.id,number:`16-${nonce}`,description:"Sintético",sanction_type_id:type.id}});
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Sanción sintética PDGLD-16',true)`;
      const c = await tx.disciplinary_cases.create({data:{season_id:season.id,reference_number:nonce,opened_by:actors.admin,description:"Sintético"}});
      const ruling = await tx.disciplinary_rulings.create({data:{case_id:c.id,version_number:1,decided_by:actors.admin,decision:"Sintética",reason:"Prueba aislada"}});
      await tx.sanctions.create({data:{ruling_id:ruling.id,article_id:article.id,sanction_type_id:type.id,registration_id:reg.id,
        starts_at:new Date("2026-11-12T18:00:00Z"),ends_at:new Date("2026-11-13T18:00:00Z"),blocks_participation:true}});
    });
    assert.equal((await player()).eligible,true,"Sanción futura respecto al partido no bloquea");
    await audit(tx=>tx.matches.update({where:{id:match.id},data:{starts_at:new Date("2026-11-12T18:00:00Z"),ends_at:new Date("2026-11-12T20:00:00Z"),reserved_until:new Date("2026-11-12T20:00:00Z")}}));
    assert.ok((await player()).blockers.some(b=>b.code==="PARTICIPATION_BLOCKED"));
    await audit(tx=>tx.matches.update({where:{id:match.id},data:{starts_at:new Date("2026-11-13T18:00:00Z"),ends_at:new Date("2026-11-13T20:00:00Z"),reserved_until:new Date("2026-11-13T20:00:00Z")}}));
    assert.equal((await player()).eligible,true,"En el instante final ya no aplica");
    await audit(tx=>tx.matches.update({where:{id:match.id},data:{starts_at:match.starts_at,ends_at:match.ends_at,reserved_until:match.reserved_until}}));
  });
  await t.test("PDGLD-16: registra tiempos atómicos con versión y conserva la captura ante versión obsoleta", async () => {
    const {recordParticipationInTransaction} = await import("../../src/features/matches/server/eligibility");
    const report = await audit(tx=>tx.match_reports.create({data:{match_id:match.id,client_id:randomUUID(),captured_by:user.id,source:"MOBILE"}}));
    const lineup = await audit(tx=>tx.lineups.create({data:{match_report_id:report.id,registration_id:reg.id,season_team_id:team.id,validated_by:user.id}}));
    const input = {matchId:match.id,lineupId:lineup.id,expectedMatchVersion:match.version,expectedReportVersion:1,
      periods:[{periodNumber:1,entryMinute:0,exitMinute:35},{periodNumber:2,entryMinute:5,exitMinute:null}]};
    const result = await db.$transaction(tx=>recordParticipationInTransaction(tx,user.id,input),{timeout:20000});
    assert.equal(result.reportVersion,2);
    await assert.rejects(db.$transaction(tx=>recordParticipationInTransaction(tx,user.id,{...input,periods:[]})),/STALE_REPORT/);
    assert.equal(await db.player_period_participations.count({where:{lineup_id:lineup.id}}),2);
    assert.equal((await player()).participation.length,2);
    await assert.rejects(db.$transaction(tx=>recordParticipationInTransaction(tx,user.id,{...input,expectedReportVersion:2,periods:[{periodNumber:1,entryMinute:40,exitMinute:10}]})));
  });
  await t.test("PDGLD-16: reprogramación concurrente conserva tiempos y devuelve STALE_MATCH", async () => {
    const {recordParticipationInTransaction} = await import("../../src/features/matches/server/eligibility");
    const report = await db.match_reports.findUniqueOrThrow({where:{match_id:match.id}});
    const lineup = await db.lineups.findFirstOrThrow({where:{match_report_id:report.id}});
    const before = await db.player_period_participations.findMany({where:{lineup_id:lineup.id},orderBy:{id:"asc"}});
    const current = await db.matches.findUniqueOrThrow({where:{id:match.id}});
    const input = {matchId:match.id,lineupId:lineup.id,expectedMatchVersion:current.version,
      expectedReportVersion:report.version,periods:[]};
    // Barreras explícitas; no se usa un sleep para presumir que hubo una carrera.
    const deferred = () => {
      let resolve!: () => void;
      const promise = new Promise<void>(r => { resolve = r; });
      return {promise, resolve};
    };
    const waitBlocked = async (pid: number) => {
      const deadline = Date.now()+10000;
      while (Date.now()<deadline) {
        const [row] = await db.$queryRaw<{blocked:boolean}[]>`SELECT cardinality(pg_blocking_pids(${pid}::int))>0 AS blocked`;
        if (row.blocked) return;
        await new Promise(r=>setTimeout(r,10));
      }
      assert.fail("La segunda transacción no esperó el bloqueo PostgreSQL");
    };
    const held=deferred(), release=deferred(), saveStarted=deferred();
    let savePid=0;
    const reschedule = audit(async tx=>{
      await tx.matches.update({where:{id:match.id},data:{version:{increment:1},
        starts_at:new Date("2026-11-11T18:05:00Z"),ends_at:new Date("2026-11-11T20:05:00Z"),reserved_until:new Date("2026-11-11T20:05:00Z")}});
      held.resolve(); await release.promise;
    });
    await held.promise;
    const save = db.$transaction(async tx=>{
      const [row]=await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
      savePid=row.pid; saveStarted.resolve();
      return recordParticipationInTransaction(tx,user.id,input);
    },{timeout:20000});
    const rejected=assert.rejects(save,/STALE_MATCH/);
    try { await saveStarted.promise; await waitBlocked(savePid); }
    finally { release.resolve(); }
    await reschedule; await rejected;
    assert.deepEqual(await db.player_period_participations.findMany({where:{lineup_id:lineup.id},orderBy:{id:"asc"}}),before);
    assert.equal((await db.match_reports.findUniqueOrThrow({where:{id:report.id}})).version,report.version);

    // Orden inverso: el guardado terminó, pero su transacción sigue abierta.
    const saved=deferred(), commit=deferred(), updating=deferred();
    let updatePid=0;
    const saving=db.$transaction(async tx=>{
      await recordParticipationInTransaction(tx,user.id,{...input,expectedMatchVersion:current.version+1,
        periods:before.map(p=>({periodNumber:p.period_number,entryMinute:p.entry_minute,exitMinute:p.exit_minute}))});
      saved.resolve(); await commit.promise;
    },{timeout:20000});
    await saved.promise;
    const updatingMatch=audit(async tx=>{
      const [row]=await tx.$queryRaw<{pid:number}[]>`SELECT pg_backend_pid() AS pid`;
      updatePid=row.pid; updating.resolve();
      await tx.matches.update({where:{id:match.id},data:{version:{increment:1},starts_at:current.starts_at,
        ends_at:current.ends_at,reserved_until:current.reserved_until}});
    });
    try { await updating.promise; await waitBlocked(updatePid); }
    finally { commit.resolve(); }
    await saving; await updatingMatch;
    assert.equal((await db.matches.findUniqueOrThrow({where:{id:match.id}})).version,current.version+2);
    assert.equal((await db.match_reports.findUniqueOrThrow({where:{id:report.id}})).version,report.version+1);
  });
  await t.test("PDGLD-16: partidos separados no inventan descanso; cruce horario queda pendiente explícito", async () => {
    const second = await audit(tx=>tx.matches.create({data:{...match,id:randomUUID(),number:randomUUID(),
      starts_at:new Date("2026-11-14T18:00:00Z"),ends_at:new Date("2026-11-14T20:00:00Z"),reserved_until:new Date("2026-11-14T20:00:00Z")}}));
    const report = await audit(tx=>tx.match_reports.create({data:{match_id:second.id,client_id:randomUUID(),captured_by:user.id,source:"MOBILE"}}));
    await audit(tx=>tx.lineups.create({data:{match_report_id:report.id,registration_id:reg.id,season_team_id:team.id,validated_by:user.id}}));
    assert.equal((await player()).eligible,true,"No se impone un margen de descanso sin confirmar");
    await audit(tx=>tx.matches.update({where:{id:second.id},data:{starts_at:match.starts_at,ends_at:match.ends_at,reserved_until:match.reserved_until}}));
    assert.ok((await player()).blockers.some(b=>b.code==="PARTICIPATION_RULE_PENDING"));
  });
  await t.test("PDGLD-16: CLOSED no lee ni reevalúa Persona vigente", async () => {
    // El cierre real tiene su propio proceso y triggers. Rollback de fixture,
    // exclusivamente en esta base desechable, para probar la rama de lectura.
    await db.$transaction(async tx => {
      await tx.$executeRawUnsafe('ALTER TABLE sports_management.seasons DISABLE TRIGGER USER');
      await tx.seasons.update({ where: { id: season.id }, data: { status: "CLOSED", closed_at: new Date() } });
      const { evaluateMatchInTransaction } = await import("../../src/features/matches/server/eligibility");
      const result = await evaluateMatchInTransaction(tx, user.id, match.id);
      assert.equal(result.historical, true); assert.deepEqual(result.players, []);
      await tx.seasons.update({ where: { id: season.id }, data: { status: season.status, closed_at: season.closed_at } });
      await tx.$executeRawUnsafe('ALTER TABLE sports_management.seasons ENABLE TRIGGER USER');
    });
  });
}
