import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { assertCurpProductionSecurity } from "../../scripts/ci/production-plans.mjs";
import { getPrisma } from "../../src/server/db/prisma";
import { AuthorizationError, lockAuthorization } from "../../src/server/auth/authorization";
import { INITIAL_PERMISSION_GRANTS } from "../../prisma/permissions-data";
import { registerPlayerForActor } from "../../src/features/players/server/service";
import { readPlayerRegistrationForActor } from "../../src/features/players/server/queries";
import { PlayerRegistrationError } from "../../src/features/players/server/access";
import {reviewDetailForActor,decideIdentityReviewForActor} from "../../src/features/players/server/identity-review";
import {readPlayerDossierForActor} from "../../src/features/players/server/document-queries";
import {preparePlayerDocumentForActor,uploadPlayerDocumentForActor,confirmPlayerDocumentForActor,readPlayerDocumentUploadForActor,PlayerDocumentError} from "../../src/features/players/server/document-service";
import {createPlayerDocumentDownloadForActor} from "../../src/features/players/server/document-download";
import {validatePrivateFileContent} from "../../src/server/files/private-file-validation";
import {PDFDocument} from "pdf-lib";
import { readPlayerCurpStatusForActor, verifyPlayerCurpForActor } from "../../src/features/players/server/curp-verification-service";
import { CurpVerificationError } from "../../src/features/players/server/curp-check-record";
import { createVerificamexCurpAdapter, type CurpProvider } from "../../src/features/players/server/verificamex-curp";
import sharp from "sharp";
import {verifyPlayerIneForActor,readPlayerIneStatusForActor,readIneReviewQueueForActor,downloadPlayerIneEvidenceForActor,IneVerificationError} from "../../src/features/players/server/ine-verification-service";
import type {PlayerDocumentTransport} from "../../src/features/players/server/document-storage";
import {createVerificamexIneAdapter} from "../../src/features/players/server/verificamex-ine";
import {activateVerifiedAdultForActor} from "../../src/features/players/server/automatic-activation";

function syntheticCurp(date: string, root = "SIAA", differentiator = "0") {
  const prefix = `${root}${date.slice(2).replaceAll("-", "")}HMNLRR${differentiator}`;
  const alphabet = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";
  const sum = [...prefix].reduce((total, char, index) => total + alphabet.indexOf(char) * (18 - index), 0);
  return prefix + (10 - sum % 10) % 10;
}

test("PDGLD-97: servicio real, integridad y permisos en PostgreSQL desechable", async t => {
  // Antes de conectar o escribir: jamás una base de desarrollo, Supabase o producción.
  assert.equal(process.env.AUTH_TEST_RUN, "1");
  const target = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(target.hostname));
  assert.ok(["postgres:", "postgresql:"].includes(target.protocol));
  assert.ok(["5432", "5433"].includes(target.port || "5432"));
  assert.match(target.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
  assert.equal(target.search, "");
  assert.equal(target.hash, "");
  const db = getPrisma();
  const suffix = randomUUID();
  const input = (seasonTeamId: string, date: string, root?: string, firstName = "Alvaro") => ({
    seasonTeamId, identity: { curp: syntheticCurp(date, root), birthDate: date,
      firstName, paternalSurname: "Sierra", maternalSurname: "Lara" },
  });
  const isCode = (code: string) => (error: unknown) => error instanceof PlayerRegistrationError && error.code === code;
  const setClock = async (timestamp: string) => {
    // Solo esta función de prueba y el search_path del trigger en la base desechable.
    // No reemplaza ni desactiva reglas de producción.
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION pdgld97_test_clock.now() RETURNS timestamptz
      LANGUAGE sql STABLE AS 'SELECT ''${timestamp}''::timestamptz'`);
  };
  try {
    const fixture = await db.$transaction(async tx => {
      const actors: Record<string, string> = {};
      for (const code of ["delegate", "other", "secretary", "admin", "unprivileged", "player"]) {
        const person = await tx.people.create({ data: { first_name: "Cuenta sintética", paternal_surname: code } });
        const user = await tx.users.create({ data: { person_id: person.id, username: `p97-${code}-${suffix}`,
          email: `p97-${code}-${suffix}@example.test`, password_hash: "synthetic-no-login", must_change_password: false } });
        actors[code] = user.id;
      }
      await tx.$queryRaw`SELECT set_config('app.user_id', ${actors.admin}, true),
        set_config('app.reason', 'PDGLD-97: contexto sintético de integración', true)`;
      const roles = await tx.roles.findMany({ where: { code: { in: ["CLUB_DELEGATE", "SECRETARY", "SUPERADMIN", "PLAYER"] } } });
      for (const grant of INITIAL_PERMISSION_GRANTS.filter(grant => grant.module === "players" && roles.some(role => role.code === grant.roleCode))) {
        const permission = await tx.permissions.upsert({ where: { module_action: { module: grant.module, action: grant.action } },
          update: {}, create: { module: grant.module, action: grant.action } });
        const role = roles.find(role => role.code === grant.roleCode)!;
        await tx.role_permissions.upsert({ where: { role_id_permission_id: { role_id: role.id, permission_id: permission.id } },
          update: { context_only: grant.contextOnly }, create: { role_id: role.id, permission_id: permission.id, context_only: grant.contextOnly } });
      }
      const soccer = await tx.sports.findUniqueOrThrow({ where: { code: "SOCCER" } });
      const league = await tx.leagues.create({ data: { name: `Liga sintética P97 ${suffix}` } });
      const foreignLeague = await tx.leagues.create({ data: { name: `Liga ajena P97 ${suffix}` } });
      const clubs = [];
      const seasons = new Map<string, { id: string; ruleId: string }>();
      const contexts: { id: string; seasonId: string; clubId: string; categoryId: string }[][] = [];
      for (let index = 0; index < 3; index++) {
        const leagueId = index === 2 ? foreignLeague.id : league.id;
        const club = await tx.clubs.create({ data: { league_id: leagueId, name: `Club sintético ${index}`,
          reference_number: `p97-club-${index}-${suffix}` } });
        clubs.push(club);
        const category = await tx.categories.create({ data: { league_id: leagueId, sport_id: soccer.id, name: `Abierta ${index}` } });
        const teams = [];
        for (let n = 0; n < 2; n++) teams.push(await tx.teams.create({ data: { club_id: club.id,
          name: `Equipo ${n}`, reference_number: `p97-team-${index}-${n}-${suffix}` } }));
        contexts[index] = [];
        for (let year = 2026; year <= (index === 0 ? 2027 : 2026); year++) {
          const seasonKey = `${leagueId}:${year}`;
          let season = seasons.get(seasonKey);
          if (!season) {
            const created = await tx.seasons.create({ data: { league_id: leagueId, sport_id: soccer.id,
              name: `Temporada ${year}`, start_date: new Date(`${year}-01-01`), end_date: new Date(`${year}-12-31`) } });
            const rule = await tx.competition_rules.create({ data: { season_id: created.id, version_number: 1 } });
            season = { id: created.id, ruleId: rule.id };
            seasons.set(seasonKey, season);
          }
          const seasonCategory = await tx.season_categories.create({ data: { season_id: season.id, category_id: category.id,
            competition_rule_id: season.ruleId, hierarchy_order: index + 1, type: "OPEN", age_cutoff_date: new Date(`${year}-01-01`) } });
          const group = await tx.groups.create({ data: { season_id: season.id, season_category_id: seasonCategory.id, name: "Grupo sintético" } });
          const affiliation = await tx.club_affiliations.create({ data: { club_id: club.id, season_id: season.id,
            league_id: leagueId, reference_number: `p97-affiliation-${index}-${year}-${suffix}`, uniform_colors: "Azul",
            requested_by: actors.admin, status: "APPROVED" } });
          await tx.club_affiliation_categories.create({ data: { affiliation_id: affiliation.id, season_id: season.id,
            category_id: category.id, authorized_by: actors.admin, authorized_at: new Date() } });
          for (const team of teams) {
            const row = await tx.season_teams.create({ data: { club_id: club.id, team_id: team.id, season_id: season.id, group_id: group.id } });
            contexts[index].push({ id: row.id, seasonId: season.id, clubId: club.id, categoryId: category.id });
          }
        }
      }
      for (const [actor, roleCode, leagueId, clubId] of [
        [actors.delegate, "CLUB_DELEGATE", league.id, clubs[0].id],
        [actors.other, "CLUB_DELEGATE", league.id, clubs[1].id],
        [actors.secretary, "SECRETARY", league.id, null],
        [actors.admin, "SUPERADMIN", null, null],
        [actors.player, "PLAYER", league.id, clubs[0].id],
      ]) await tx.user_roles.create({ data: { user_id: actor!, role_id: roles.find(role => role.code === roleCode)!.id,
        league_id: leagueId, club_id: clubId, starts_at: new Date(Date.now() - 60_000),
        delegate_position: roleCode === "CLUB_DELEGATE" ? "PRIMARY" : null } });
      return { actors, team: contexts[0][0], alternative: contexts[0][1], next: contexts[0][2], other: contexts[1][0], foreign: contexts[2][0] };
    }, { timeout: 30_000 });
    const { actors, team, alternative, next, other, foreign } = fixture;
    let revokedDelegateAssignment: string | undefined;
    const changeDelegateAccess = async (enabled: boolean) => db.$transaction(async tx => {
      await lockAuthorization(tx, "exclusive");
      await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Revocación sintética y nueva designación, conservando historial PDGLD-106',true)`;
      if (!enabled) {
        const assignment = await tx.user_roles.findFirstOrThrow({ where: { user_id: actors.delegate, ends_at: null }, select: { id: true } });
        // El reloj SQL evita fechar el cese antes de iniciar esta transacción.
        await tx.$executeRaw`UPDATE sports_management.user_roles SET ends_at=clock_timestamp() WHERE id=${assignment.id}::uuid`;
        revokedDelegateAssignment = assignment.id;
      } else if (revokedDelegateAssignment) {
        // Una designación vencida no se reabre: se crea el siguiente periodo.
        await tx.$executeRaw`INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,delegate_position,starts_at)
          SELECT user_id,role_id,league_id,club_id,delegate_position,clock_timestamp()
          FROM sports_management.user_roles WHERE id=${revokedDelegateAssignment}::uuid`;
        revokedDelegateAssignment = undefined;
      }
    });
    assert.equal(team.seasonId, other.seasonId, "Los dos clubes compiten en la misma temporada real.");
    const [config] = await db.$queryRaw<{ settings: string[] }[]>`SELECT proconfig AS settings FROM pg_proc
      WHERE oid = 'sports_management.validate_player_registration()'::regprocedure`;
    assert.ok(config.settings.includes("search_path=sports_management, pg_temp"));
    await db.$executeRaw`CREATE SCHEMA pdgld97_test_clock`;
    await setClock("2026-10-26T12:00:00-06:00");
    await db.$executeRaw`ALTER FUNCTION sports_management.validate_player_registration()
      SET search_path TO pdgld97_test_clock, sports_management, pg_catalog, pg_temp`;

    await t.test("rechaza actor ausente, permiso insuficiente, club/liga ajenos y autoridad forjada", async () => {
      const payload = input(team.id, "1990-01-01");
      for (const actor of ["", actors.unprivileged, actors.other, actors.player, actors.secretary])
        await assert.rejects(registerPlayerForActor(actor, payload), error => error instanceof AuthorizationError);
      await assert.rejects(registerPlayerForActor(actors.delegate, input(other.id, "1990-01-01")), error => error instanceof AuthorizationError);
      await assert.rejects(registerPlayerForActor(actors.delegate, { ...payload, clubId: team.clubId }), isCode("VALIDATION_ERROR"));
      assert.equal(await db.people.count({ where: { curp: payload.identity.curp } }), 0);
    });

    await t.test("crea contexto seguro y auditoría una vez; reintento no duplica", async () => {
      const payload = input(team.id, "1991-02-03");
      payload.identity.curp = ` ${payload.identity.curp.toLowerCase()} `;
      const result = await registerPlayerForActor(actors.delegate, payload);
      assert.equal(result.status, "INELIGIBLE");
      assert.equal(result.identityReviewStatus, "NOT_REQUIRED");
      assert.equal(result.externalVerification, "NOT_PERFORMED");
      assert.equal(result.clubId, team.clubId);
      assert.equal(result.seasonId, team.seasonId);
      assert.equal(result.categoryId, team.categoryId);
      for (const key of ["curp", "firstName", "birthDate", "candidates", "password_hash"])
        assert.equal(Object.hasOwn(result, key), false);
      const replay = await registerPlayerForActor(actors.delegate, payload);
      assert.equal(replay.registrationId, result.registrationId);
      assert.equal(replay.replayed, true);
      const audits = await db.audit_logs.findMany({ where: { entity_id: { in: [result.registrationId, result.personId] } } });
      assert.equal(audits.length, 2);
      assert.equal(audits.filter(row => row.table_name === "player_registrations").length, 1);
      assert.equal(JSON.stringify(audits).includes(payload.identity.curp.trim().toUpperCase()), false);
      assert.equal((await readPlayerRegistrationForActor(actors.delegate, result.registrationId))?.personId, result.personId);
      await assert.rejects(readPlayerRegistrationForActor(actors.other, result.registrationId), error => error instanceof AuthorizationError);
      await assert.rejects(readPlayerRegistrationForActor(actors.player, result.registrationId), error => error instanceof AuthorizationError);
    });

    await t.test("reutiliza Persona entre temporadas sin alterar identidad ni exponer otro club", async () => {
      const payload = input(team.id, "1992-03-04");
      const first = await registerPlayerForActor(actors.delegate, payload);
      const second = await registerPlayerForActor(actors.delegate, { ...payload, seasonTeamId: next.id });
      assert.equal(first.personId, second.personId);
      assert.notEqual(first.registrationId, second.registrationId);
      await assert.rejects(registerPlayerForActor(actors.other, { ...payload, seasonTeamId: other.id }), isCode("IDENTITY_UNAVAILABLE"));
      await assert.rejects(registerPlayerForActor(actors.delegate, { ...payload,
        identity: { ...payload.identity, firstName: "Otra persona" }, seasonTeamId: next.id }), isCode("IDENTITY_UNAVAILABLE"));
      assert.equal((await db.people.findUniqueOrThrow({ where: { id: first.personId } })).first_name, "Alvaro");
      const foreignResult = await registerPlayerForActor(actors.admin, input(foreign.id, "1993-04-05"));
      await assert.rejects(readPlayerRegistrationForActor(actors.secretary, foreignResult.registrationId), error => error instanceof AuthorizationError);
    });

    await t.test("dos altas concurrentes conservan una Persona y una inscripción activa por temporada", async () => {
      const payload = input(team.id, "1994-05-06");
      const results = await Promise.allSettled([
        registerPlayerForActor(actors.delegate, payload),
        registerPlayerForActor(actors.delegate, { ...payload, seasonTeamId: alternative.id }),
      ]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(results.filter(result => result.status === "rejected" && isCode("REGISTRATION_CONFLICT")(result.reason)).length, 1);
      const person = await db.people.findUniqueOrThrow({ where: { curp: payload.identity.curp } });
      assert.equal(await db.player_registrations.count({ where: { person_id: person.id, season_id: team.seasonId, withdrawn_at: null } }), 1);
      const samePayload = input(team.id, "1995-06-07");
      const same = await Promise.all([registerPlayerForActor(actors.delegate, samePayload), registerPlayerForActor(actors.delegate, samePayload)]);
      assert.equal(same[0].registrationId, same[1].registrationId);
      assert.equal(same.filter(result => result.replayed).length, 1);
      const crossClub = input(team.id, "1987-05-06");
      const clubsRace = await Promise.allSettled([
        registerPlayerForActor(actors.admin, crossClub),
        registerPlayerForActor(actors.admin, { ...crossClub, seasonTeamId: other.id }),
      ]);
      assert.equal(clubsRace.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(clubsRace.filter(result => result.status === "rejected" && isCode("REGISTRATION_CONFLICT")(result.reason)).length, 1);
    });

    await t.test("posibles coincidencias quedan bloqueadas sin fusión, incluso concurrentes", async () => {
      const firstInput = input(team.id, "1996-07-08");
      const secondInput = input(team.id, "1996-07-08", "SABA", "Álvaro");
      const results = await Promise.all([registerPlayerForActor(actors.delegate, firstInput), registerPlayerForActor(actors.delegate, secondInput)]);
      assert.notEqual(results[0].personId, results[1].personId);
      const rows = await db.player_registrations.findMany({ where: { id: { in: results.map(result => result.registrationId) } } });
      assert.ok(rows.every(row => row.identity_review_status === "REQUIRED" && row.status === "INELIGIBLE"));
      await assert.rejects(db.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${actors.secretary}, true), set_config('app.reason', 'Prueba sintética de aprobación bloqueada', true)`;
        await tx.player_registrations.update({ where: { id: results[0].registrationId }, data: { status: "ACTIVE" } });
      }), error => String(error).includes("player_identity_review_blocks_approval"));
      assert.equal((await readPlayerRegistrationForActor(actors.secretary, results[0].registrationId))?.identityReviewStatus, "REQUIRED");
    });

    await t.test("Secretaría resuelve con versión, permiso y auditoría sin aprobar deportivamente", async () => {
      const first=await registerPlayerForActor(actors.delegate,input(team.id,"1984-07-08"));
      await registerPlayerForActor(actors.delegate,input(team.id,"1984-07-08","SABA"));
      for(const actor of [actors.delegate,actors.other,actors.unprivileged])
        await assert.rejects(reviewDetailForActor(actor,first.registrationId),error=>error instanceof AuthorizationError);
      const detail=await reviewDetailForActor(actors.secretary,first.registrationId);
      assert.equal(detail.candidates.length,1);assert.equal(detail.outsideScope,false);
      const body={fingerprint:detail.fingerprint,reason:"DISTINCT_IDENTITIES_CONFIRMED"};
      await assert.rejects(decideIdentityReviewForActor(actors.delegate,first.registrationId,body),error=>error instanceof AuthorizationError);
      await decideIdentityReviewForActor(actors.secretary,first.registrationId,body);
      await decideIdentityReviewForActor(actors.secretary,first.registrationId,body);
      assert.equal(await db.audit_logs.count({where:{entity_id:first.registrationId,action:"PLAYER_IDENTITY_REVIEWED"}}),1);
      assert.equal((await readPlayerRegistrationForActor(actors.secretary,first.registrationId))?.identityReviewStatus,"NOT_REQUIRED");
      assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:first.registrationId}})).status,"INELIGIBLE");
      await assert.rejects(decideIdentityReviewForActor(actors.secretary,first.registrationId,{...body,reason:"DOCUMENTS_INSUFFICIENT"}),isCode("REGISTRATION_CONFLICT"));
      await db.people.update({where:{id:first.personId},data:{first_name:"Alvara"}});
      assert.equal((await readPlayerRegistrationForActor(actors.secretary,first.registrationId))?.identityReviewStatus,"REQUIRED");
    });

    await t.test("revisión ajena no revela candidatos y decisiones concurrentes no se sobrescriben",async()=>{
      const first=await registerPlayerForActor(actors.delegate,input(team.id,"1983-07-08"));
      await registerPlayerForActor(actors.admin,input(foreign.id,"1983-07-08","SABA"));
      const scoped=await reviewDetailForActor(actors.secretary,first.registrationId);
      assert.equal(scoped.outsideScope,true);assert.equal(scoped.candidates.length,0);
      await assert.rejects(decideIdentityReviewForActor(actors.secretary,first.registrationId,{fingerprint:scoped.fingerprint,reason:"DISTINCT_IDENTITIES_CONFIRMED"}),error=>error instanceof AuthorizationError);
      const full=await reviewDetailForActor(actors.admin,first.registrationId);
      const result=await Promise.allSettled(["DISTINCT_IDENTITIES_CONFIRMED","DOCUMENTS_INSUFFICIENT"].map(reason=>decideIdentityReviewForActor(actors.admin,first.registrationId,{fingerprint:full.fingerprint,reason})));
      assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
      assert.equal(await db.audit_logs.count({where:{entity_id:first.registrationId,action:"PLAYER_IDENTITY_REVIEWED"}}),1);
    });

    await t.test("PDGLD-100: expediente reutiliza inscripción y deniega otro club",async()=>{
      const registered=await registerPlayerForActor(actors.delegate,input(team.id,"1982-11-12"));
      await assert.rejects(readPlayerDossierForActor(actors.other,registered.registrationId),error=>error instanceof AuthorizationError);
      await assert.rejects(readPlayerDossierForActor("",registered.registrationId),error=>error instanceof AuthorizationError);
      const dossier=await readPlayerDossierForActor(actors.delegate,registered.registrationId);
      assert.equal(dossier.configuration,"MISSING");assert.equal(dossier.approvalAllowed,false);
      assert.equal(JSON.stringify(dossier).includes("storage_key"),false);
    });

    await t.test("PDGLD-100: carga simulada, confirmación, reemplazo y recuperación sin duplicados",async()=>{
      const registered=await registerPlayerForActor(actors.delegate,input(team.id,"1982-03-20"));
      const type=await db.document_types.findUniqueOrThrow({where:{code:"CURP"}});
      const requirement=await db.document_requirements.create({data:{season_category_id:registered.seasonCategoryId,document_type_id:type.id}});
      const pdf=await PDFDocument.create();pdf.addPage();
      const bytes=await pdf.save();const file=await validatePrivateFileContent(bytes,"application/pdf");
      const body={operationKey:randomUUID(),registrationId:registered.registrationId,requirementId:requirement.id,slot:1,
        replacesDocumentId:null as string|null,mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256};
      const policy={referenceDate:"2026-01-01",opensAt:new Date(Date.now()-60_000),closesAt:new Date(Date.now()+600_000)};
      const code=(value:string)=>(error:unknown)=>error instanceof PlayerDocumentError && error.code===value;
      await assert.rejects(preparePlayerDocumentForActor(actors.delegate,body),code("CONFIGURATION_REQUIRED"));
      await assert.rejects(preparePlayerDocumentForActor(actors.other,body,policy),error=>error instanceof AuthorizationError);
      const prepared=await preparePlayerDocumentForActor(actors.delegate,body,policy);
      assert.equal((await readPlayerDocumentUploadForActor(actors.delegate,prepared.uploadId)).state,"PENDING_STORAGE");
      assert.deepEqual(await preparePlayerDocumentForActor(actors.delegate,body,policy),prepared);
      await assert.rejects(preparePlayerDocumentForActor(actors.delegate,{...body,sha256:"0".repeat(64)},policy),code("UPLOAD_CONFLICT"));
      assert.equal(await db.player_documents.count({where:{registration_id:registered.registrationId}}),0);
      const unavailable={read:async()=>{throw new Error("synthetic network failure");}};
      await assert.rejects(confirmPlayerDocumentForActor(actors.delegate,prepared.uploadId,unavailable,policy),code("STORAGE_UNCONFIRMED"));
      assert.equal((await readPlayerDossierForActor(actors.delegate,registered.registrationId)).requirements[0].missing,1);
      let calls=0;
      const storage={read:async(key:string,max:number)=>{calls++;assert.ok(key.startsWith("player-documents/v1/"));assert.ok(max>=bytes.length);return bytes;}};
      await assert.rejects(confirmPlayerDocumentForActor(actors.other,prepared.uploadId,storage,policy),error=>error instanceof AuthorizationError);
      assert.equal(calls,0);
      const outcomes=await Promise.all([confirmPlayerDocumentForActor(actors.delegate,prepared.uploadId,storage,policy),confirmPlayerDocumentForActor(actors.delegate,prepared.uploadId,storage,policy)]);
      assert.equal(outcomes[0].documentId,outcomes[1].documentId);
      assert.equal((await readPlayerDocumentUploadForActor(actors.delegate,prepared.uploadId)).state,"CONFIRMED");
      assert.equal(await db.player_documents.count({where:{registration_id:registered.registrationId}}),1);
      assert.equal((await readPlayerDossierForActor(actors.delegate,registered.registrationId)).requirements[0].missing,0);
      const oldId=outcomes[0].documentId;
      await db.player_documents.update({where:{id:oldId},data:{status:"VALIDATED",reviewed_by:actors.secretary}});
      const replacement={...body,operationKey:randomUUID(),replacesDocumentId:oldId};
      const a=await preparePlayerDocumentForActor(actors.delegate,replacement,policy);
      const b=await preparePlayerDocumentForActor(actors.delegate,{...replacement,operationKey:randomUUID()},policy);
      const attempts=await Promise.allSettled([confirmPlayerDocumentForActor(actors.delegate,a.uploadId,storage,policy),confirmPlayerDocumentForActor(actors.delegate,b.uploadId,storage,policy)]);
      assert.equal(attempts.filter(result=>result.status==="fulfilled").length,1);
      assert.equal(await db.player_documents.count({where:{registration_id:registered.registrationId}}),2);
      const dossier=await readPlayerDossierForActor(actors.delegate,registered.registrationId);
      assert.equal(dossier.documents.filter(d=>d.superseded).length,1);
      assert.equal(dossier.requirements[0].approved,0);
      assert.equal(dossier.approvalAllowed,false);
      assert.equal((await db.player_documents.findUniqueOrThrow({where:{id:oldId}})).status,"VALIDATED");
      assert.equal(JSON.stringify(dossier).includes("storage_key"),false);
      const active=dossier.documents.find(d=>!d.superseded)!;
      const late=await preparePlayerDocumentForActor(actors.delegate,{...replacement,operationKey:randomUUID(),replacesDocumentId:active.id},policy);
      await assert.rejects(confirmPlayerDocumentForActor(actors.delegate,late.uploadId,{read:async()=>new Uint8Array([1,2,3])},policy));
      assert.equal(await db.player_documents.count({where:{registration_id:registered.registrationId}}),2);
      await db.$executeRaw`CREATE FUNCTION pdgld97_test_clock.reject_document_receipt() RETURNS trigger LANGUAGE plpgsql AS
        'BEGIN IF NEW.action=''PLAYER_DOCUMENT_CONFIRMED'' THEN RAISE EXCEPTION ''synthetic receipt failure''; END IF; RETURN NEW; END'`;
      await db.$executeRaw`CREATE TRIGGER p100_reject_receipt BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION pdgld97_test_clock.reject_document_receipt()`;
      const beforeFiles=await db.files.count();
      try{await assert.rejects(confirmPlayerDocumentForActor(actors.delegate,late.uploadId,storage,policy));}
      finally{await db.$executeRaw`DROP TRIGGER p100_reject_receipt ON sports_management.audit_logs`;}
      assert.equal(await db.files.count(),beforeFiles);
      assert.equal(await db.player_documents.count({where:{registration_id:registered.registrationId}}),2);
      await confirmPlayerDocumentForActor(actors.delegate,late.uploadId,storage,policy);
      assert.equal(await db.player_documents.count({where:{registration_id:registered.registrationId}}),3);
      await db.people.update({where:{id:registered.personId},data:{first_name:"Alvara"}});
      assert.equal((await readPlayerDossierForActor(actors.delegate,registered.registrationId)).requirements[0].missing,1);
      await db.document_requirements.delete({where:{id:requirement.id}});
    });

    await t.test("PDGLD-100: credencial estudiantil solo opcional y para menores según referencia explícita",async()=>{
      const minorInput=input(team.id,"2009-05-06");minorInput.identity.curp=syntheticCurp("2009-05-06","SIAA","A");
      const minor=await registerPlayerForActor(actors.delegate,minorInput);
      const adult=await registerPlayerForActor(actors.delegate,input(team.id,"1981-05-06"));
      const type=await db.document_types.create({data:{code:"STUDENT_ID",name:"Credencial de estudiante sintética"}});
      const requirement=await db.document_requirements.create({data:{season_category_id:minor.seasonCategoryId,document_type_id:type.id,is_required:false}});
      const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
      const file=await validatePrivateFileContent(bytes,"application/pdf");
      const body={operationKey:randomUUID(),registrationId:minor.registrationId,requirementId:requirement.id,slot:1,replacesDocumentId:null,
        mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256};
      const policy={referenceDate:"2026-01-01",opensAt:new Date(Date.now()-60_000),closesAt:new Date(Date.now()+600_000)};
      const prepared=await preparePlayerDocumentForActor(actors.delegate,body,policy);
      assert.equal((await readPlayerDossierForActor(actors.delegate,minor.registrationId)).requirements[0].missing,0);
      await confirmPlayerDocumentForActor(actors.delegate,prepared.uploadId,{read:async()=>bytes},policy);
      await assert.rejects(preparePlayerDocumentForActor(actors.delegate,{...body,operationKey:randomUUID(),registrationId:adult.registrationId},policy));
      await db.document_requirements.update({where:{id:requirement.id},data:{is_required:true}});
      await assert.rejects(preparePlayerDocumentForActor(actors.delegate,{...body,operationKey:randomUUID()},policy));
      await db.document_requirements.delete({where:{id:requirement.id}});
    });

    await t.test("PDGLD-100: edad al registro y recepción documental sin heredar la ventana de altas",async()=>{
      const payload=input(team.id,"2008-10-27");payload.identity.curp=syntheticCurp("2008-10-27","SIAA","A");
      const registered=await registerPlayerForActor(actors.delegate,payload);
      await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','PDGLD-100: fecha sintética de registro para probar edad cumplida',true)`;
        await tx.player_registrations.update({where:{id:registered.registrationId},data:{registered_at:new Date("2026-10-26T12:00:00-06:00")}});
      });
      const type=await db.document_types.findUniqueOrThrow({where:{code:"CURP"}});
      const requirement=await db.document_requirements.create({data:{season_category_id:registered.seasonCategoryId,document_type_id:type.id}});
      const dossier=await readPlayerDossierForActor(actors.delegate,registered.registrationId);
      assert.equal(dossier.referenceDate,"2026-10-26");assert.equal(dossier.minorAtRegistration,true);
      assert.ok(dossier.configurationIssues.includes("MISSING_GUARDIAN_REQUIREMENT"));
      const pdf=await PDFDocument.create();pdf.addPage();const file=await validatePrivateFileContent(await pdf.save(),"application/pdf");
      await setClock("2026-10-31T12:00:00-06:00");
      try{const prepared=await preparePlayerDocumentForActor(actors.delegate,{operationKey:randomUUID(),registrationId:registered.registrationId,requirementId:requirement.id,slot:1,replacesDocumentId:null,mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256},
        {referenceDate:"2026-10-26",window:"PENDING_DOSSIER_V1"});assert.ok(prepared.uploadId);}
      finally{await setClock("2026-10-26T12:00:00-06:00");await db.document_requirements.delete({where:{id:requirement.id}});}
      assert.equal((await readPlayerDossierForActor(actors.delegate,registered.registrationId)).approvalAllowed,false);
    });

    if(process.env.PLAYER_DOCUMENT_STORAGE_REAL_TEST==="1")await t.test("PDGLD-100: HTTP y transporte real exclusivamente en Supabase de pruebas",async()=>{
      const registered=await registerPlayerForActor(actors.delegate,input(team.id,"1980-12-13"));
      const {runPlayerDocumentStorageReal}=await import("./player-document-storage-real");
      await runPlayerDocumentStorageReal(db,{delegate:actors.delegate,other:actors.other},registered);
    });

    await t.test("el índice de base protege pertenencia también ante escritores sin locks del servicio", async () => {
      const registered = await registerPlayerForActor(actors.delegate, input(team.id, "1997-08-09"));
      await assert.rejects(db.$transaction(async tx => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${actors.admin}, true), set_config('app.reason', 'Prueba sintética de índice único', true)`;
        await tx.player_registrations.create({ data: { person_id: registered.personId, season_id: team.seasonId,
          season_team_id: alternative.id, reference_number: `p97-duplicate-${suffix}`, status: "SUSPENDED" } });
      }), error => (error as { code?: string }).code === "P2002");
      assert.equal(await db.player_registrations.count({ where: { person_id: registered.personId } }), 1);
    });

    await t.test("CURP duplicada se rechaza en base ante dos escritores concurrentes", async () => {
      const curp = syntheticCurp("1980-01-01");
      const create = () => db.people.create({ data: { curp, birth_date: new Date("1980-01-01"),
        first_name: "Identidad sintética", paternal_surname: "Concurrencia" }, select: { id: true } });
      const outcomes = await Promise.allSettled([create(), create()]);
      assert.equal(outcomes.filter(result => result.status === "fulfilled").length, 1);
      assert.equal(outcomes.filter(result => result.status === "rejected" && result.reason.code === "P2002").length, 1);
      assert.equal(await db.people.count({ where: { curp } }), 1);
    });

    await t.test("cuenta inactiva y categoría sin autorización bloquean sin residuos", async () => {
      const payload = input(team.id, "1981-03-04");
      await db.users.update({ where: { id: actors.delegate }, data: { is_active: false } });
      try { await assert.rejects(registerPlayerForActor(actors.delegate, payload), error => error instanceof AuthorizationError); }
      finally { await db.users.update({ where: { id: actors.delegate }, data: { is_active: true } }); }
      const category = await db.club_affiliation_categories.findFirstOrThrow({ where: { category_id: team.categoryId, season_id: team.seasonId } });
      await db.club_affiliation_categories.update({ where: { affiliation_id_category_id: {
        affiliation_id: category.affiliation_id, category_id: category.category_id } }, data: { authorized_at: null, authorized_by: null } });
      try { await assert.rejects(registerPlayerForActor(actors.delegate, payload), isCode("CONTEXT_NOT_AVAILABLE")); }
      finally { await db.club_affiliation_categories.update({ where: { affiliation_id_category_id: {
        affiliation_id: category.affiliation_id, category_id: category.category_id } },
        data: { authorized_at: category.authorized_at, authorized_by: category.authorized_by } }); }
      assert.equal(await db.people.count({ where: { curp: payload.identity.curp } }), 0);
    });

    await t.test("rollback elimina persona, inscripción e historial si falla el último paso", async () => {
      const payload = input(team.id, "1998-09-10");
      await db.$executeRaw`CREATE FUNCTION pdgld97_test_clock.reject_history() RETURNS trigger LANGUAGE plpgsql
        AS 'BEGIN RAISE EXCEPTION ''synthetic late failure''; END'`;
      await db.$executeRaw`CREATE TRIGGER p97_reject_history BEFORE INSERT ON sports_management.player_status_history
        FOR EACH ROW EXECUTE FUNCTION pdgld97_test_clock.reject_history()`;
      const before = { audits: await db.audit_logs.count(), registrations: await db.player_registrations.count(),
        history: await db.player_status_history.count() };
      try { await assert.rejects(registerPlayerForActor(actors.delegate, payload), isCode("RETRY_REQUIRED")); }
      finally { await db.$executeRaw`DROP TRIGGER p97_reject_history ON sports_management.player_status_history`; }
      assert.equal(await db.people.count({ where: { curp: payload.identity.curp } }), 0);
      assert.equal(await db.audit_logs.count(), before.audits);
      assert.equal(await db.player_registrations.count(), before.registrations);
      assert.equal(await db.player_status_history.count(), before.history);
    });

    await t.test("conserva la ventana original: sábado rechaza y revierte la nueva Persona", async () => {
      const payload = input(team.id, "1999-10-11");
      await setClock("2026-10-31T12:00:00-06:00");
      try { await assert.rejects(registerPlayerForActor(actors.delegate, payload), isCode("REGISTRATION_WINDOW_CLOSED")); }
      finally { await setClock("2026-10-26T12:00:00-06:00"); }
      assert.equal(await db.people.count({ where: { curp: payload.identity.curp } }), 0);
    });

    const policy = { globalDailyLimit: 100, actorDailyLimit: 100, cooldownMs: 0 };
    const intention = (identityVersion = 1) => ({ operationKey: randomUUID(), identityVersion, confirmCharge: true });
    const isCurpCode = (code: string) => (error: unknown) => error instanceof CurpVerificationError && error.code === code;
    const fake = (verify: CurpProvider["verify"]): CurpProvider => ({ configured: true, verify });

    await t.test("CURP externa: sin permisos, club ajeno, versión antigua o configuración no consume", async () => {
      const registered = await registerPlayerForActor(actors.delegate, input(team.id, "1970-01-01"));
      let calls = 0;
      const provider = fake(async () => { calls++; return { status: "VERIFIED", mismatchedFields: [] }; });
      for (const actorId of ["", actors.unprivileged, actors.other, actors.player])
        await assert.rejects(verifyPlayerCurpForActor(actorId, registered.registrationId, intention(), { provider, policy }),
          error => error instanceof AuthorizationError);
      await assert.rejects(verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(9), { provider, policy }), isCurpCode("IDENTITY_CHANGED"));
      await assert.rejects(verifyPlayerCurpForActor(actors.delegate, registered.registrationId, { ...intention(), verified: true }, { provider, policy }), isCurpCode("VALIDATION_ERROR"));
      const missing = await verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(), {
        provider: { configured: false, verify: provider.verify }, policy });
      assert.equal(missing.status, "NOT_CONFIGURED");
      assert.equal(await db.player_curp_checks.count(), 0);
      assert.equal(calls, 0);
    });

    await t.test("CURP externa: dos intenciones simultáneas consultan una vez y la red no retiene locks de BD", async () => {
      const source = input(team.id, "1971-02-03");
      const registered = await registerPlayerForActor(actors.delegate, source);
      let calls = 0;
      const provider = createVerificamexCurpAdapter({ apiKey: "synthetic-only", transport: async () => {
        calls++;
        // Si la transacción de preparación siguiera abierta, el lock de Persona bloquearía esta operación.
        await db.$transaction(async tx => {
          await tx.$executeRaw`SET LOCAL lock_timeout='500ms'`;
          await tx.$queryRaw`SELECT id FROM sports_management.people WHERE id=${registered.personId}::uuid FOR UPDATE`;
        });
        return Response.json({ data: { object: "citizeninformations", citizen: { codigo: 0, status: true, registros: [{
          curp: source.identity.curp, nombres: "ALVARO", primerApellido: "SIERRA", segundoApellido: "LARA",
          fechaNacimiento: source.identity.birthDate, datosDocProbatorio: { private: "SYNTHETIC-EXCLUDE" } }],
        }, pdf: "SYNTHETIC-PDF-EXCLUDE" } });
      } });
      const request = intention();
      const results = await Promise.all([
        verifyPlayerCurpForActor(actors.delegate, registered.registrationId, request, { provider, policy }),
        verifyPlayerCurpForActor(actors.delegate, registered.registrationId, request, { provider, policy }),
        verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(), { provider, policy }),
      ]);
      assert.equal(calls, 1);
      assert.equal(new Set(results.map(row => row.checkId)).size, 1);
      const status = await readPlayerCurpStatusForActor(actors.delegate, registered.registrationId);
      assert.equal(status.status, "VERIFIED");
      assert.equal((await verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(), { provider, policy })).status, "VERIFIED");
      assert.equal(calls, 1);
      assert.equal((await db.player_registrations.findUniqueOrThrow({ where: { id: registered.registrationId } })).status, "ACTIVE");
      assert.equal(await db.audit_logs.count({where:{entity_id:registered.registrationId,action:"PLAYER_AUTO_ACTIVATED"}}),1);
      const nextSeason = await registerPlayerForActor(actors.delegate, { ...source, seasonTeamId: next.id });
      const reused = await verifyPlayerCurpForActor(actors.delegate, nextSeason.registrationId, intention(), { provider, policy });
      assert.equal(reused.checkId, status.checkId);
      assert.equal((await readPlayerCurpStatusForActor(actors.delegate, nextSeason.registrationId, reused.checkId!)).status, "VERIFIED");
      assert.equal(calls, 1);
      const audit = await db.audit_logs.findMany({ where: { entity_id: status.checkId } });
      assert.equal(audit.length, 2);
      for (const forbidden of [source.identity.curp, "SYNTHETIC-EXCLUDE", "SYNTHETIC-PDF-EXCLUDE", "synthetic-only"])
        assert.equal(JSON.stringify(audit).includes(forbidden), false);
      await assert.rejects(db.player_curp_checks.delete({ where: { id: status.checkId! } }));
      await assert.rejects(db.player_curp_checks.update({ where: { id: status.checkId! }, data: { status: "UNAVAILABLE" } }));
      const another = await registerPlayerForActor(actors.delegate, input(team.id, "1972-03-04"));
      await assert.rejects(verifyPlayerCurpForActor(actors.delegate, another.registrationId, request, { provider, policy }), isCurpCode("OPERATION_CONFLICT"));
      await assert.rejects(readPlayerCurpStatusForActor(actors.other, registered.registrationId), error => error instanceof AuthorizationError);
    });

    await t.test("CURP externa: editar durante la consulta y restaurar los datos invalida la comprobación", async () => {
      const registered = await registerPlayerForActor(actors.delegate, input(team.id, "1973-04-05"));
      const provider = fake(async () => {
        await db.people.update({ where: { id: registered.personId }, data: { first_name: "Nombre modificado" } });
        return { status: "VERIFIED", mismatchedFields: [] };
      });
      const result = await verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(), { provider, policy });
      assert.equal(result.status, "STALE"); assert.equal(result.identityVersion, 2);
      await db.people.update({ where: { id: registered.personId }, data: { first_name: "Alvaro" } });
      await db.people.update({ where: { id: registered.personId }, data: { identity_version: 1 } });
      const current = await readPlayerCurpStatusForActor(actors.delegate, registered.registrationId);
      assert.equal(current.identityVersion, 3); assert.equal(current.status, "STALE");
      await assert.rejects(verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(), { provider, policy }), isCurpCode("IDENTITY_CHANGED"));
    });

    await t.test("CURP externa: revocación durante la red conserva el acuse y deniega la respuesta", async () => {
      const registered = await registerPlayerForActor(actors.delegate, input(team.id, "1974-05-06"));
      const provider = fake(async () => { await changeDelegateAccess(false); return { status: "VERIFIED", mismatchedFields: [] }; });
      try {
        await assert.rejects(verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(), { provider, policy }), error => error instanceof AuthorizationError);
        assert.equal((await db.player_curp_checks.findFirstOrThrow({ where: { registration_id: registered.registrationId } })).status, "VERIFIED");
      } finally { await changeDelegateAccess(true); }
    });

    await t.test("CURP externa: cuotas persistentes y recuperación incierta sin reintentos automáticos", async () => {
      const registered = await registerPlayerForActor(actors.delegate, input(team.id, "1975-06-07"));
      let calls = 0;
      const provider = fake(async () => { calls++; return { status: "UNCERTAIN", mismatchedFields: [] }; });
      for (const limit of [{ globalDailyLimit: 0, actorDailyLimit: 100, cooldownMs: 0 },
        { globalDailyLimit: 100, actorDailyLimit: 0, cooldownMs: 0 }])
        await assert.rejects(verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(), { provider, policy: limit }), isCurpCode("USAGE_LIMIT_REACHED"));
      assert.equal(calls, 0);
      const request = intention();
      const result = await verifyPlayerCurpForActor(actors.delegate, registered.registrationId, request, { provider, policy });
      assert.equal(result.status, "UNCERTAIN");
      await verifyPlayerCurpForActor(actors.delegate, registered.registrationId, request, { provider, policy });
      await verifyPlayerCurpForActor(actors.delegate, registered.registrationId, intention(), { provider, policy });
      assert.equal(calls, 1);
      const retry = { ...intention(), retryOf: result.checkId! };
      await assert.rejects(verifyPlayerCurpForActor(actors.delegate, registered.registrationId, retry, { provider, policy }), isCurpCode("RETRY_CONFIRMATION_REQUIRED"));
      await assert.rejects(verifyPlayerCurpForActor(actors.delegate, registered.registrationId, { ...retry, acknowledgePossiblePreviousCharge: true },
        { provider, policy: { ...policy, cooldownMs: 60_000 } }), isCurpCode("USAGE_LIMIT_REACHED"));
      const retried = await verifyPlayerCurpForActor(actors.delegate, registered.registrationId,
        { ...retry, acknowledgePossiblePreviousCharge: true }, { provider, policy });
      assert.notEqual(retried.checkId, result.checkId); assert.equal(calls, 2);
    });

    await t.test("Activación automática: adulto CURP verificada sin archivo, expediente posterior y límites de categoría",async()=>{
      const registered=await registerPlayerForActor(actors.delegate,input(team.id,"1986-12-17",undefined,"Carlos"));
      let calls=0;const provider=fake(async()=>{calls++;return{status:"VERIFIED",mismatchedFields:[]};});
      const status=await verifyPlayerCurpForActor(actors.delegate,registered.registrationId,intention(),{provider,policy});
      assert.equal(status.registrationStatus,"ACTIVE");assert.equal(calls,1);
      const dossier=await readPlayerDossierForActor(actors.delegate,registered.registrationId);
      assert.equal(dossier.canUpload,true);assert.equal(dossier.documents.length,0);
      await assert.rejects(activateVerifiedAdultForActor(actors.other,registered.registrationId),e=>e instanceof AuthorizationError);
      await Promise.all([activateVerifiedAdultForActor(actors.delegate,registered.registrationId),activateVerifiedAdultForActor(actors.delegate,registered.registrationId)]);
      assert.equal(await db.player_status_history.count({where:{registration_id:registered.registrationId,new_status:"ACTIVE"}}),1);
      const type=await db.document_types.findUniqueOrThrow({where:{code:"CURP"}});
      const requirement=await db.document_requirements.create({data:{season_category_id:registered.seasonCategoryId,document_type_id:type.id,is_required:true}});
      try{
        const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save(),file=await validatePrivateFileContent(bytes,"application/pdf");
        const data={operationKey:randomUUID(),registrationId:registered.registrationId,requirementId:requirement.id,slot:1,replacesDocumentId:null,mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256};
        const documentPolicy={referenceDate:dossier.referenceDate,window:"PENDING_DOSSIER_V1" as const};
        const prepared=await preparePlayerDocumentForActor(actors.delegate,data,documentPolicy);
        await confirmPlayerDocumentForActor(actors.delegate,prepared.uploadId,{read:async()=>bytes},documentPolicy);
        assert.equal((await readPlayerDossierForActor(actors.delegate,registered.registrationId)).requirements.find(r=>r.id===requirement.id)?.recorded,1);
        assert.equal((await readPlayerCurpStatusForActor(actors.delegate,registered.registrationId)).registrationStatus,"ACTIVE");
        assert.equal(calls,1,"Carga y acuse no vuelven a consultar al proveedor");
      }finally{await db.document_requirements.delete({where:{id:requirement.id}});}
      const updateStatus=async(status:string)=>db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Estado sintético para impedir reactivación',true)`;
        await tx.player_registrations.update({where:{id:registered.registrationId},data:{status}});
      });
      await updateStatus("SUSPENDED");await activateVerifiedAdultForActor(actors.delegate,registered.registrationId);
      assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:registered.registrationId}})).status,"SUSPENDED");
      const minorData=input(team.id,"2012-12-16",undefined,"Patricia");minorData.identity.curp=syntheticCurp("2012-12-16","SIAA","A");
      const minor=await registerPlayerForActor(actors.delegate,minorData);
      assert.equal((await verifyPlayerCurpForActor(actors.delegate,minor.registrationId,intention(),{provider,policy})).registrationStatus,"INELIGIBLE");
      const veteran=await registerPlayerForActor(actors.delegate,input(team.id,"1980-12-11",undefined,"Diego"));
      const category=await db.season_categories.findUniqueOrThrow({where:{id:veteran.seasonCategoryId}});
      const configure=async(type:string,minimum_age:number|null,eligibility_pending=false,age_cutoff_date:Date|null=category.age_cutoff_date)=>db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Límites sintéticos de activación por categoría',true)`;
        await tx.season_categories.update({where:{id:category.id},data:{type,minimum_age,eligibility_pending,age_cutoff_date}});
      });
      try{
        await configure("VETERANS",35);
        assert.equal((await verifyPlayerCurpForActor(actors.delegate,veteran.registrationId,intention(),{provider,policy})).registrationStatus,"INELIGIBLE");
        await configure("OPEN",100);
        await activateVerifiedAdultForActor(actors.delegate,veteran.registrationId);
        assert.equal((await readPlayerCurpStatusForActor(actors.delegate,veteran.registrationId)).registrationStatus,"INELIGIBLE","No elude el límite de edad configurado");
        for (const cutoff of [category.age_cutoff_date, null]) {
          await configure("OPEN", null, true, cutoff);
          await activateVerifiedAdultForActor(actors.delegate,veteran.registrationId);
          assert.equal((await readPlayerCurpStatusForActor(actors.delegate,veteran.registrationId)).registrationStatus,"INELIGIBLE","Una categoría pendiente nunca habilita, tenga o no fecha de corte");
        }
      }finally{await configure(category.type,category.minimum_age,category.eligibility_pending,category.age_cutoff_date);}
    });

    await t.test("Activación automática: coincidencias requieren resolución vigente y fallos locales se recuperan sin gastar",async()=>{
      const first=await registerPlayerForActor(actors.delegate,input(team.id,"1988-12-14","SIAA","Lucía"));
      await registerPlayerForActor(actors.delegate,input(team.id,"1988-12-14","SABA","Lucía"));
      let calls=0;const provider=fake(async()=>{calls++;return{status:"VERIFIED",mismatchedFields:[]};});
      const result=await verifyPlayerCurpForActor(actors.delegate,first.registrationId,intention(),{provider,policy});
      assert.equal(result.registrationStatus,"INELIGIBLE");assert.equal(result.identityReviewStatus,"REQUIRED");
      const review=await reviewDetailForActor(actors.secretary,first.registrationId);
      await decideIdentityReviewForActor(actors.secretary,first.registrationId,{fingerprint:review.fingerprint,reason:"DISTINCT_IDENTITIES_CONFIRMED"});
      assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:first.registrationId}})).status,"ACTIVE");assert.equal(calls,1);
      const single=await registerPlayerForActor(actors.delegate,input(team.id,"1989-12-13",undefined,"Roberto"));
      await db.$executeRaw`CREATE FUNCTION pdgld97_test_clock.reject_activation_history() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN IF NEW.new_status=''ACTIVE'' THEN RAISE EXCEPTION ''synthetic activation failure''; END IF; RETURN NEW; END'`;
      await db.$executeRaw`CREATE TRIGGER reject_auto_activation BEFORE INSERT ON sports_management.player_status_history FOR EACH ROW EXECUTE FUNCTION pdgld97_test_clock.reject_activation_history()`;
      const request=intention();
      try{await assert.rejects(verifyPlayerCurpForActor(actors.delegate,single.registrationId,request,{provider,policy}));}
      finally{await db.$executeRaw`DROP TRIGGER reject_auto_activation ON sports_management.player_status_history`;}
      assert.equal((await readPlayerCurpStatusForActor(actors.delegate,single.registrationId)).status,"VERIFIED");
      assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:single.registrationId}})).status,"INELIGIBLE");
      const before=calls;
      await activateVerifiedAdultForActor(actors.delegate,single.registrationId);
      assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:single.registrationId}})).status,"ACTIVE");assert.equal(calls,before);
      assert.equal(await db.audit_logs.count({where:{entity_id:single.registrationId,action:"PLAYER_AUTO_ACTIVATED"}}),1);
    });

    await t.test("Foto del jugador: opcional en expediente pendiente, privada, versionada y sin sustituir selfie",async()=>{
      const adult=await registerPlayerForActor(actors.delegate,input(team.id,"1987-09-17"));
      const minorInput=input(team.id,"2013-08-19");minorInput.identity.curp=syntheticCurp("2013-08-19","SIAA","A");
      const minor=await registerPlayerForActor(actors.delegate,minorInput);
      const photoType=await db.document_types.findUniqueOrThrow({where:{code:"PHOTO"}});
      for(const id of [adult.registrationId,minor.registrationId]){
        const dossier=await readPlayerDossierForActor(actors.delegate,id);
        const photo=dossier.requirements.find(r=>r.typeId===photoType.id)!;
        assert.ok(photo);assert.equal(photo.required,false);assert.equal(photo.quantity,1);assert.equal(photo.recorded,0);
        assert.equal(dossier.approvalAllowed,false);
        assert.equal(await db.document_requirements.count({where:{id:photo.id}}),0,"La posición opcional no modifica la configuración de categoría");
      }
      const dossier=await readPlayerDossierForActor(actors.delegate,adult.registrationId);
      const requirement=dossier.requirements.find(r=>r.typeId===photoType.id)!;
      const bytes=new Uint8Array(await sharp({create:{width:40,height:50,channels:3,background:"white"}}).png().toBuffer());
      const image=await validatePrivateFileContent(bytes,"image/png");
      const inputPhoto={operationKey:randomUUID(),registrationId:adult.registrationId,requirementId:requirement.id,slot:1,replacesDocumentId:null as string|null,mimeType:image.mimeType,sizeBytes:image.sizeBytes,sha256:image.sha256};
      const policy={referenceDate:dossier.referenceDate,window:"PENDING_DOSSIER_V1" as const};
      const isDocument=(code:string)=>(e:unknown)=>e instanceof PlayerDocumentError && e.code===code;
      await assert.rejects(preparePlayerDocumentForActor(actors.other,inputPhoto,policy),e=>e instanceof AuthorizationError);
      await assert.rejects(preparePlayerDocumentForActor(actors.delegate,{...inputPhoto,mimeType:"application/pdf"},policy),isDocument("INVALID_DOCUMENT"));
      await assert.rejects(preparePlayerDocumentForActor(actors.delegate,{...inputPhoto,slot:2},policy),isDocument("INVALID_DOCUMENT"));
      const objects=new Map<string,{bytes:Uint8Array;mimeType:string}>();let reads=0;
      const storage:PlayerDocumentTransport={async put(key,file){assert.ok(!objects.has(key));objects.set(key,file);return{replayed:false};},async read(key){reads++;const found=objects.get(key);if(!found)throw Error("synthetic missing");return found.bytes;},async createDownloadUrl(){return{downloadUrl:"https://example.test/synthetic-photo",expiresInSeconds:60};}};
      const prepared=await preparePlayerDocumentForActor(actors.delegate,inputPhoto,policy);
      assert.deepEqual(await preparePlayerDocumentForActor(actors.delegate,inputPhoto,policy),prepared);
      await assert.rejects(uploadPlayerDocumentForActor(actors.delegate,prepared.uploadId,new Uint8Array([1,2,3]),"image/png",storage,policy));
      assert.equal(objects.size,0);
      await uploadPlayerDocumentForActor(actors.delegate,prepared.uploadId,bytes,"image/png",storage,policy);
      const confirmed=await confirmPlayerDocumentForActor(actors.delegate,prepared.uploadId,storage,policy);
      assert.equal((await confirmPlayerDocumentForActor(actors.delegate,prepared.uploadId,storage,policy)).documentId,confirmed.documentId);
      await assert.rejects(createPlayerDocumentDownloadForActor(actors.other,confirmed.documentId,storage),e=>e instanceof AuthorizationError);
      assert.equal((await createPlayerDocumentDownloadForActor(actors.secretary,confirmed.documentId,storage)).expiresInSeconds,60);
      const replacement={...inputPhoto,operationKey:randomUUID(),replacesDocumentId:confirmed.documentId};
      const revised=await preparePlayerDocumentForActor(actors.delegate,replacement,policy);
      const racing=await preparePlayerDocumentForActor(actors.delegate,{...replacement,operationKey:randomUUID()},policy);
      await uploadPlayerDocumentForActor(actors.delegate,revised.uploadId,bytes,"image/png",storage,policy);
      await uploadPlayerDocumentForActor(actors.delegate,racing.uploadId,bytes,"image/png",storage,policy);
      const results=await Promise.allSettled([confirmPlayerDocumentForActor(actors.delegate,revised.uploadId,storage,policy),confirmPlayerDocumentForActor(actors.delegate,racing.uploadId,storage,policy)]);
      assert.equal(results.filter(r=>r.status==="fulfilled").length,1);
      const current=await readPlayerDossierForActor(actors.delegate,adult.registrationId);
      assert.equal(current.documents.filter(d=>d.typeId===photoType.id && !d.superseded).length,1);
      assert.equal(current.documents.filter(d=>d.superseded).length,1);
      assert.equal((await readPlayerIneStatusForActor(actors.delegate,adult.registrationId)).status,"NOT_STARTED");
      assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:adult.registrationId}})).status,"INELIGIBLE");
      assert.ok(reads>0);
      await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Cierre sintético del expediente para prueba de foto',true)`;
        await tx.player_registrations.update({where:{id:adult.registrationId},data:{status:"WITHDRAWN",withdrawn_at:new Date()}});
      });
      assert.equal((await readPlayerDossierForActor(actors.delegate,adult.registrationId)).canUpload,false);
      await assert.rejects(preparePlayerDocumentForActor(actors.delegate,{...inputPhoto,operationKey:randomUUID()},policy),isDocument("CONTEXT_UNAVAILABLE"));
    });

    await t.test("INE sintética: Veteranos, alcance, evidencia privada, idempotencia concurrente y revisión sin aprobación", async () => {
      const registered = await registerPlayerForActor(actors.delegate, input(team.id,"1961-03-07"));
      const id = registered.registrationId;
      const bytes = new Uint8Array(await sharp({create:{width:32,height:32,channels:3,background:"white"}}).png().toBuffer());
      const raw = {front:{bytes,mimeType:"image/png"},back:{bytes,mimeType:"image/png"},selfie:{bytes,mimeType:"image/png"}};
      const objects = new Map<string,{bytes:Uint8Array;mimeType:string}>();
      const storage:PlayerDocumentTransport = {
        async put(key,object){assert.ok(!objects.has(key));objects.set(key,object);return {replayed:false};},
        async read(key){const found=objects.get(key);if(!found)throw new Error("synthetic missing");return found.bytes;},
        async createDownloadUrl(){return {downloadUrl:"https://example.test/synthetic-private",expiresInSeconds:60};},
      };
      let calls=0;
      const dependencies={storage,provider:{configured:true,async verify(){calls++;return {status:"ADMIN_REVIEW_REQUIRED" as const,readings:[]};}},limits:{daily:100,actorDaily:100}};
      const intention = (version=1) => ({operationKey:randomUUID(),identityVersion:version,acknowledgeCharge:true,retryOf:null as string|null,acknowledgePossiblePreviousCharge:false});
      const isIne = (code:string)=>(error:unknown)=>error instanceof IneVerificationError && error.code===code;
      await assert.rejects(verifyPlayerIneForActor(actors.delegate,id,intention(),raw,dependencies),isIne("CONTEXT_UNAVAILABLE"));
      assert.equal(calls,0);assert.equal(objects.size,0);
      const category=await db.season_categories.findFirstOrThrow({where:{season_id:team.seasonId,category_id:team.categoryId},select:{id:true}});
      await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Política explícita: categoría Veteranos sintética',true)`;
        await tx.season_categories.update({where:{id:category.id},data:{type:"VETERANS"}});
      });
      try {
        const state=await readPlayerIneStatusForActor(actors.delegate,id);
        assert.equal(state.applicable,true);
        await assert.rejects(verifyPlayerIneForActor(actors.other,id,intention(state.identityVersion),raw,dependencies),error=>error instanceof AuthorizationError);
        await assert.rejects(verifyPlayerIneForActor(actors.delegate,id,{...intention(state.identityVersion),acknowledgeCharge:false},raw,dependencies),isIne("INVALID_PAYLOAD"));
        await assert.rejects(verifyPlayerIneForActor(actors.delegate,id,intention(state.identityVersion),{...raw,selfie:{bytes:new Uint8Array([1,2,3]),mimeType:"image/png"}},dependencies));
        assert.equal(calls,0);
        const request=intention(state.identityVersion);
        const results=await Promise.all([verifyPlayerIneForActor(actors.delegate,id,request,raw,dependencies),verifyPlayerIneForActor(actors.delegate,id,request,raw,dependencies)]);
        const receipt=await readPlayerIneStatusForActor(actors.delegate,id);
        assert.equal(calls,1);assert.equal(objects.size,3);assert.equal(receipt.status,"ADMIN_REVIEW_REQUIRED");assert.equal(receipt.approvalAllowed,false);
        assert.equal(results[0].attemptId,results[1].attemptId);
        await verifyPlayerIneForActor(actors.delegate,id,request,raw,dependencies);assert.equal(calls,1);
        assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id}})).status,"INELIGIBLE");
        const queue=await readIneReviewQueueForActor(actors.secretary);assert.ok(queue.some(r=>r.id===id));
        await assert.rejects(readIneReviewQueueForActor(actors.delegate),error=>error instanceof AuthorizationError);
        await assert.rejects(downloadPlayerIneEvidenceForActor(actors.other,id,receipt.attemptId!,"selfie",storage),error=>error instanceof AuthorizationError);
        assert.equal((await downloadPlayerIneEvidenceForActor(actors.secretary,id,receipt.attemptId!,"selfie",storage)).expiresInSeconds,60);
        const audit=await db.audit_logs.findMany({where:{entity_id:id,action:{in:["PLAYER_INE_PREPARED","PLAYER_INE_RESULT"]}}});
        assert.equal(audit.length,2);assert.ok(!JSON.stringify(audit.map(a=>a.new_data)).includes("base64"));
        await assert.rejects(verifyPlayerIneForActor(actors.delegate,id,intention(state.identityVersion),raw,dependencies),isIne("RETRY_CONFIRMATION_REQUIRED"));
        const retry={...intention(state.identityVersion),retryOf:receipt.attemptId,acknowledgePossiblePreviousCharge:true};
        await assert.rejects(verifyPlayerIneForActor(actors.delegate,id,retry,raw,{...dependencies,limits:{daily:0,actorDaily:0}}),isIne("USAGE_LIMIT_REACHED"));assert.equal(calls,1);
        const failedStorage=await verifyPlayerIneForActor(actors.delegate,id,retry,raw,{...dependencies,storage:{...storage,async put(){throw new Error("synthetic offline");}}});
        assert.equal(failedStorage.status,"STORAGE_FAILED");assert.equal(calls,1);
        const uncertain=await verifyPlayerIneForActor(actors.delegate,id,{...intention(state.identityVersion),retryOf:failedStorage.attemptId,acknowledgePossiblePreviousCharge:true},raw,{...dependencies,provider:{configured:true,async verify(){calls++;throw new Error("synthetic response lost");}}});
        assert.equal(uncertain.status,"UNCERTAIN");assert.equal(calls,2);
        const altered=new Uint8Array(await sharp({create:{width:32,height:32,channels:3,background:"black"}}).png().toBuffer());
        await assert.rejects(verifyPlayerIneForActor(actors.delegate,id,request,{...raw,selfie:{bytes:altered,mimeType:"image/png"}},dependencies),isIne("OPERATION_CONFLICT"));
        const changed=await verifyPlayerIneForActor(actors.delegate,id,{...intention(state.identityVersion),retryOf:uncertain.attemptId,acknowledgePossiblePreviousCharge:true},raw,{...dependencies,provider:{configured:true,async verify(){
          const row=await db.player_registrations.findUniqueOrThrow({where:{id},select:{person_id:true}});
          await db.$transaction(async tx=>{
            await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Cambio sintético de identidad durante proveedor simulado',true)`;
            await tx.people.update({where:{id:row.person_id},data:{first_name:"Identidad modificada"}});
          });return {status:"PROVIDER_PASSED" as const,readings:[]};
        }}});
        assert.equal(changed.status,"STALE");assert.equal(changed.approvalAllowed,false);
        try {
          await assert.rejects(verifyPlayerIneForActor(actors.delegate,id,{...intention(changed.identityVersion),retryOf:changed.attemptId,acknowledgePossiblePreviousCharge:true},raw,{...dependencies,provider:{configured:true,async verify(){await changeDelegateAccess(false);return {status:"ADMIN_REVIEW_REQUIRED" as const,readings:[]};}}}),error=>error instanceof AuthorizationError);
          assert.equal(await db.audit_logs.count({where:{entity_id:id,action:"PLAYER_INE_RESULT"}}),5,"El acuse persiste aunque el actor pierda permisos");
        } finally {await changeDelegateAccess(true);}
        let latest=await readPlayerIneStatusForActor(actors.delegate,id);
        const person=await db.player_registrations.findUniqueOrThrow({where:{id},select:{people:{select:{curp:true,first_name:true,paternal_surname:true,maternal_surname:true,birth_date:true}}}});
        const entries=[{type:"Name",source:"OCR",value:person.people.first_name},{type:"FatherSurname",source:"MRZ",value:person.people.paternal_surname},{type:"MotherSurname",source:"MRZ",value:person.people.maternal_surname ?? ""},{type:"DateOfBirth",source:"OCR",value:person.people.birth_date!.toISOString().slice(0,10).split("-").reverse().join("/")},{type:"PersonalNumber",source:"OCR",value:person.people.curp}];
        for(const documentData of [[],entries.map(e=>e.type==="Name"?{...e,value:"Otra persona"}:e)]){
          const provider=createVerificamexIneAdapter({apiKey:"synthetic-ine",transport:async()=>Response.json({data:{object:"ine_validations",status:true,documentInformation:{documentData}}})});
          const review=await verifyPlayerIneForActor(actors.delegate,id,{...intention(latest.identityVersion),retryOf:latest.attemptId,acknowledgePossiblePreviousCharge:true},raw,{...dependencies,provider});
          assert.equal(review.status,"ADMIN_REVIEW_REQUIRED","Proveedor favorable sin igualdad completa no verifica identidad");
          latest=review;
        }
        let favorableCalls=0;
        const favorable={...dependencies,provider:createVerificamexIneAdapter({apiKey:"synthetic-ine",transport:async()=>{favorableCalls++;return Response.json({data:{object:"ine_validations",status:true,documentInformation:{documentData:entries}}});}})};
        const passed=await verifyPlayerIneForActor(actors.delegate,id,{...intention(latest.identityVersion),retryOf:latest.attemptId,acknowledgePossiblePreviousCharge:true},raw,favorable);
        assert.equal(passed.status,"IDENTITY_VERIFIED");assert.equal(passed.approvalAllowed,false);
        assert.ok(!(await readIneReviewQueueForActor(actors.secretary)).some(r=>r.id===id),"El cotejo completo sale de revisión INE");
        assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id}})).status,"INELIGIBLE");
        const stored=await db.audit_logs.findFirstOrThrow({where:{entity_id:id,action:"PLAYER_INE_RESULT",new_data:{path:["attemptId"],equals:passed.attemptId!}},select:{new_data:true}});
        assert.deepEqual(stored.new_data,{attemptId:passed.attemptId,outcome:"IDENTITY_VERIFIED",matchingVersion:1,missingFields:[],mismatchedFields:[]});
        assert.ok(!JSON.stringify(stored.new_data).includes(person.people.curp!));
        const replay=await verifyPlayerIneForActor(actors.delegate,id,{...intention(latest.identityVersion),retryOf:passed.attemptId,acknowledgePossiblePreviousCharge:true},raw,favorable);
        assert.equal(replay.attemptId,passed.attemptId);assert.equal(favorableCalls,1,"Un resultado favorable no permite otro cobro");
        // Acuse de la versión previa: un dictamen global no se promueve retroactivamente.
        const previousIntent=await db.audit_logs.findUniqueOrThrow({where:{id:passed.attemptId!},select:{new_data:true}});
        const legacyAttempt=randomUUID();
        await db.audit_logs.create({data:{id:legacyAttempt,user_id:actors.delegate,action:"PLAYER_INE_PREPARED",table_name:"player_registrations",entity_id:id,reason:"Acuse sintético de versión anterior sin cotejo",new_data:previousIntent.new_data!}});
        await db.audit_logs.create({data:{user_id:actors.delegate,action:"PLAYER_INE_RESULT",table_name:"player_registrations",entity_id:id,reason:"Resultado sintético anterior sin cotejo",new_data:{attemptId:legacyAttempt,outcome:"PROVIDER_PASSED"}}});
        assert.equal((await readPlayerIneStatusForActor(actors.delegate,id,legacyAttempt)).status,"ADMIN_REVIEW_REQUIRED");
        assert.equal(favorableCalls,1,"Leer un acuse antiguo no consulta al proveedor");
      } finally {
        await db.$transaction(async tx=>{
          await tx.$queryRaw`SELECT set_config('app.user_id',${actors.admin},true),set_config('app.reason','Restaurar categoría de fixture aislado',true)`;
          await tx.season_categories.update({where:{id:category.id},data:{type:"OPEN"}});
        });
      }
    });

    await t.test("CURP externa: tabla privada, Docker sin RLS y bloque Supabase deniega roles API", async () => {
      const [local] = await db.$queryRaw<{ enabled: boolean }[]>`SELECT relrowsecurity AS enabled FROM pg_class
        WHERE oid='sports_management.player_curp_checks'::regclass`;
      assert.equal(local.enabled, false);
      const sql = await readFile(new URL('../../prisma/migrations/20261031020000_pdgld97_curp_checks/migration.sql', import.meta.url), 'utf8');
      const security = sql.match(/DO \$security\$[\s\S]*?END \$security\$;/)![0];
      const client = new pg.Client({ connectionString: target.href });
      await client.connect();
      try {
        await client.query('BEGIN');
        await client.query('CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS');
        await client.query(security);
        await assertCurpProductionSecurity(client);
        await client.query('GRANT USAGE ON SCHEMA sports_management TO anon,authenticated,service_role');
        for (const role of ["anon", "authenticated", "service_role"]) {
          await client.query('SAVEPOINT denied_curp');
          await client.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(client.query('SELECT id FROM sports_management.player_curp_checks'), { code: '42501' });
          await client.query('ROLLBACK TO SAVEPOINT denied_curp');
          await client.query(`GRANT SELECT ON sports_management.player_curp_checks TO ${role}`);
          await assert.rejects(assertCurpProductionSecurity(client), /expuesta/);
          await client.query(`REVOKE SELECT ON sports_management.player_curp_checks FROM ${role}`);
        }
        await assertCurpProductionSecurity(client);
      } finally { await client.query('ROLLBACK'); await client.end(); }
    });
  } finally { await db.$disconnect(); }
});
