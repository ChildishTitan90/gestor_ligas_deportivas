import assert from 'node:assert/strict';
import {verifyMixedSeasonHistory} from './player-mixed-season-history';
import { randomUUID, createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';
import { getPrisma } from '../../src/server/db/prisma';
import { AuthorizationError } from '../../src/server/auth/authorization';
import { requestIdentityCorrectionForActor as request, decideIdentityCorrectionForActor as decide, correctionWorkspaceForActor as workspace, readCorrectionEvidenceForActor, IdentityCorrectionError } from '../../src/features/players/server/identity-correction';
import { readCategoryDocumentState, resolveCategoryDocuments } from '../../src/features/players/server/category-document-requirements';
import { readLockedPlayerTeamContext } from '../../src/features/players/server/access';
import { ineSnapshotHash } from '../../src/features/players/server/identity-document-evidence';
import { BinaryFileValidationError } from '../../src/server/files/private-file-validation';
import { readIdentityDocumentEvidence } from '../../src/features/players/server/identity-document-evidence';
import { listRegisteredPlayersForActor } from '../../src/features/players/server/workspace-queries';
import { readRegistrationLabels } from '../../src/features/players/server/registration-labels';
import { readSeasonIdentityHistory, readSeasonIdentityCapture } from '../../src/features/players/server/season-identity-history';
import { HistoricalDossierUnavailable, readPlayerDossierForActor } from '../../src/features/players/server/document-queries';
import { readPlayerParticipationWorkspaceForActor } from '../../src/features/players/server/participation-workspace-queries';
import { prepareIdentityActors } from './player-identity-fixtures.mjs';
import { validateAccountProvisioningTarget } from '../../scripts/verification/account-provisioning-entry.mjs';
import { childEnvironment } from '../../scripts/ci/delegate-isolated-runtime.mjs';
import { launchChrome } from '../e2e/chrome-session.mjs';
import { fixturePassword } from './auth-fixtures.mjs';
import { syntheticPlayerPolicy } from '../fixtures/player-document-policy';
function curp(date: string, root = 'SIAA') { const prefix = `${root}${date.slice(2).replaceAll('-', '')}HMNLRR${Number(date.slice(0,4))<2000?'0':'A'}`, alphabet = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'; return prefix + (10 - [...prefix].reduce((v, c, i) => v + alphabet.indexOf(c) * (18 - i), 0) % 10) % 10; }
export async function verifyIdentityCorrection(config: unknown) {
    const target = validateAccountProvisioningTarget(config);
    assert.equal(target.suite, 'identity-correction');
    assert.match(process.cwd(), /^\/(?:private\/tmp|tmp)\/pdgld106-[a-f0-9-]{36}\/app-pg(?:15|17)$/);
    const majorForTypes = new URL(target.databaseUrl).port.slice(-2);
    await new Promise<void>((resolve, reject) => execFile(process.execPath, [`${process.cwd()}/node_modules/typescript/bin/tsc`, '--noEmit', '--incremental', 'false'], { cwd: process.cwd(), env: { ...childEnvironment(process.env), NODE_ENV: "development" }, encoding: "utf8", timeout: 120000 }, async (error, stdout) => {
        if (error) {
            await writeFile(`${dirname(process.cwd())}/evidence-pg${majorForTypes}/typecheck-errors.txt`, stdout, { mode: 0o600 });
            reject(Error('CORRECTION_TYPECHECK_FAILED'));
        }
        else
            resolve();
    }));
    await prepareIdentityActors(target);
    const db = getPrisma();
    const checks: string[] = [];
    let browser: Awaited<ReturnType<typeof launchChrome>> | undefined;
    try {
        const actors = await db.users.findMany({ where: { username: { in: ['pdgld48_operational', 'pdgld48_concurrent', 'pdgld48_idle', 'pdgld48_underscore'] } } });
        const admin = actors.find(a => a.username === 'pdgld48_operational')!, secretary = actors.find(a => a.username === 'pdgld48_concurrent')!, delegate = actors.find(a => a.username === 'pdgld48_idle')!, foreign = actors.find(a => a.username === 'pdgld48_underscore')!;
        const f = await db.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Fixture sintético PDGLD-117',true)`;
            const sport = await tx.sports.findUniqueOrThrow({ where: { code: 'SOCCER' } });
            const contexts = [];
            for (let i = 0; i < 2; i++) {
                const league = await tx.leagues.create({ data: { name: `Liga sintética ${randomUUID()}` } }), club = await tx.clubs.create({ data: { league_id: league.id, name: 'Club sintético', reference_number: randomUUID() } });
                const season = await tx.seasons.create({ data: { league_id: league.id, sport_id: sport.id, name: 'Temporada sintética', start_date: new Date('2026-01-01'), end_date: new Date('2026-12-31') } });
                const rule = await tx.competition_rules.create({ data: { season_id: season.id, version_number: 1 } }), cat = await tx.categories.create({ data: { league_id: league.id, sport_id: sport.id, name: 'Categoría sintética' } });
                const sc = await tx.season_categories.create({ data: { season_id: season.id, category_id: cat.id, competition_rule_id: rule.id, hierarchy_order: 1, type: 'OPEN', age_cutoff_date: new Date('2026-12-31'), eligibility_pending:false, player_policy:syntheticPlayerPolicy() } });
                const group = await tx.groups.create({ data: { season_id: season.id, season_category_id: sc.id, name: 'Grupo' } }), team = await tx.teams.create({ data: { club_id: club.id, name: 'Equipo', reference_number: randomUUID() } });
                const affiliation = await tx.club_affiliations.create({ data: { season_id: season.id, club_id: club.id, league_id: league.id, status: 'APPROVED', uniform_colors: 'Azul', reference_number: randomUUID(), requested_by: admin.id } });
                await tx.club_affiliation_categories.create({ data: { affiliation_id: affiliation.id, season_id: season.id, category_id: cat.id, authorized_by: admin.id, authorized_at: new Date() } });
                const st = await tx.season_teams.create({ data: { season_id: season.id, club_id: club.id, team_id: team.id, group_id: group.id } });
                contexts.push({ st, season, league, club,sc,rule,affiliation,sport });
            }
            for (const [user, role, context] of [[admin, 'SUPERADMIN', null], [secretary, 'SECRETARY', contexts[0]], [delegate, 'CLUB_DELEGATE', contexts[0]], [foreign, 'CLUB_DELEGATE', contexts[1]]] as const) {
                const r = await tx.roles.findUniqueOrThrow({ where: { code: role } });
                await tx.user_roles.create({ data: { user_id: user.id, role_id: r.id, ...(context ? { league_id: context.league.id, ...(role === 'CLUB_DELEGATE' ? { club_id: context.club.id, delegate_position: 'PRIMARY' } : {}) } : {}), starts_at: new Date(Date.now() - 60000) } });
            }
            return contexts;
        }, { timeout: 30000 });
        // Fixed synthetic clock in this disposable DB only; preserve the real trigger.
        await db.$executeRawUnsafe("CREATE SCHEMA correction_clock");
        await db.$executeRawUnsafe("CREATE FUNCTION correction_clock.now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT ''2026-10-26T12:00:00-06:00''::timestamptz'");
        await db.$executeRawUnsafe('ALTER FUNCTION sports_management.validate_player_registration() SET search_path TO correction_clock,sports_management,pg_catalog,pg_temp');
        await db.$executeRawUnsafe("CREATE OR REPLACE FUNCTION sports_management.player_participation_now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT ''2026-10-26T12:00:00-06:00''::timestamptz'");
        const create = async (date: string, root: string) => db.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Alta sintética aislada',true)`;
            const p = await tx.people.create({ data: { curp: curp(date, root), first_name: 'Alvaro', paternal_surname: 'Sierra', maternal_surname: 'Lara', birth_date: new Date(date) } });
            const r = await tx.player_registrations.create({ data: { person_id: p.id, season_id: f[0].season.id, season_team_id: f[0].st.id, reference_number: randomUUID(), status: 'ACTIVE', identity_review_status: 'NOT_REQUIRED' } });
            return { p, r };
        });
        const a = await create('1990-01-01', 'SIAA'), b = await create('1991-02-02', 'SIAA');
        // Participación superior preexistente autorizada, creada solo como fixture sintético.
        const participation=await db.$transaction(async tx=>{
            await tx.$queryRaw`SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Participación sintética previa a rectificación',true)`;
            const context=f[0];
            await tx.season_categories.update({where:{id:context.sc.id},data:{minimum_age:18,eligibility_pending:false}});
            const category=await tx.categories.create({data:{league_id:context.league.id,sport_id:context.sport.id,name:'Superior sintética'}});
            const sc=await tx.season_categories.create({data:{season_id:context.season.id,category_id:category.id,competition_rule_id:context.rule.id,hierarchy_order:2,type:'OPEN',minimum_age:18,age_cutoff_date:new Date('2026-12-31'),eligibility_pending:false}});
            await tx.club_affiliation_categories.create({data:{affiliation_id:context.affiliation.id,season_id:context.season.id,category_id:category.id,authorized_by:admin.id,authorized_at:new Date()}});
            const group=await tx.groups.create({data:{season_id:context.season.id,season_category_id:sc.id,name:'Superior'}});
            const team=await tx.teams.create({data:{club_id:context.club.id,name:'Superior sintético',reference_number:randomUUID()}});
            const st=await tx.season_teams.create({data:{season_id:context.season.id,club_id:context.club.id,team_id:team.id,group_id:group.id}});
            for(const [id,level] of [[context.sc.id,1],[sc.id,2]] as const)await tx.player_category_levels.create({data:{season_category_id:id,season_id:context.season.id,pathway_code:'SYNTHETIC',level,configured_by:admin.id}});
            await tx.$executeRawUnsafe("CREATE OR REPLACE FUNCTION sports_management.player_participation_now() RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT ''2026-10-26T12:00:00-06:00''::timestamptz'");
            const row=await tx.player_category_participations.create({data:{origin_registration_id:a.r.id,season_id:context.season.id,club_id:context.club.id,target_season_team_id:st.id,target_season_category_id:sc.id,requested_by:delegate.id,request_key:randomUUID(),request_hash:'0'.repeat(64)}});
            const receipt=await tx.audit_logs.create({data:{user_id:admin.id,reason:'Acuse sintético aislado PDGLD-117',action:'PLAYER_PARTICIPATION_REVIEWED',table_name:'player_category_participations',entity_id:row.id,previous_data:{status:row.status,version:1},new_data:{status:'AUTHORIZED',version:2,fingerprint:'0'.repeat(64)}}});
            return tx.player_category_participations.update({where:{id:row.id},data:{status:'AUTHORIZED',version:2,eligibility_fingerprint:'0'.repeat(64),review_event_id:receipt.id}});
        },{timeout:30000});
        const proposed = (p: typeof a.p) => ({ curp: p.curp!, firstName: 'Alvaro Corregido', paternalSurname: p.paternal_surname, maternalSurname: p.maternal_surname, birthDate: p.birth_date!.toISOString().slice(0, 10) });
        const pdf = await PDFDocument.create();
        pdf.addPage();
        const bytes = await pdf.save();
        const evidence = [{ kind: 'CIVIL_RECORD', mimeType: 'application/pdf', bytes }, { kind: 'CURP_CERTIFICATE', mimeType: 'application/pdf', bytes }];
        const req = (p = a.p) => ({ operationKey: randomUUID(), expectedIdentityVersion: p.identity_version, identity: proposed(p), reason: 'Corrección sintética documentada', identityDoubt: false });
        const decision = (kind = 'APPLY') => ({ operationKey: randomUUID(), decision: kind, observations: 'Documentación privada revisada sintéticamente', evidenceChecked: true, samePersonChecked: true, curpDiscrepancy: false });
        const code = (c: string) => (e: unknown) => e instanceof IdentityCorrectionError && e.code === c;
        await assert.rejects(request(foreign.id, a.r.id, req(), evidence), e => e instanceof AuthorizationError);
        checks.push('foreign-request-denied');
        const before = await db.people.findUniqueOrThrow({ where: { id: a.p.id } });
        assert.equal((await workspace(admin.id, a.r.id)).applyBlockedCode, null);
        await db.$executeRawUnsafe('ALTER TABLE sports_management.people DISABLE TRIGGER closed_person_identity');
        try {
            assert.equal((await workspace(admin.id, a.r.id)).applyBlockedCode, 'HISTORY_PROTECTION_UNAVAILABLE');
            const blocked = await request(delegate.id, a.r.id, req(), evidence);
            await assert.rejects(decide(admin.id, a.r.id, blocked.id, decision()), code('HISTORY_PROTECTION_UNAVAILABLE'));
            await decide(admin.id, a.r.id, blocked.id, decision('RETURN'));
        } finally {
            await db.$executeRawUnsafe('ALTER TABLE sports_management.people ENABLE TRIGGER closed_person_identity');
        }
        checks.push('missing-history-protection-blocks-apply-but-allows-return');

        const pendingIntent=req();
        const pending = await request(delegate.id, a.r.id, pendingIntent, []);
        assert.deepEqual(await request(delegate.id,a.r.id,pendingIntent,[]),{...pending,replayed:true});
        await assert.rejects(request(delegate.id,a.r.id,{...pendingIntent,reason:'Otro motivo sintético'},[]),code('CORRECTION_CONFLICT'));
        await assert.rejects(request(delegate.id,a.r.id,req(),[{kind:'CIVIL_RECORD',mimeType:'application/pdf',bytes:new Uint8Array([1,2,3])}]),error=>error instanceof BinaryFileValidationError);
        checks.push('request-idempotency-and-invalid-binary');
        assert.deepEqual(await db.people.findUniqueOrThrow({ where: { id: a.p.id } }), before);
        assert.equal((await db.player_registrations.findUniqueOrThrow({ where: { id: a.r.id } })).status, 'ACTIVE');
        checks.push('pending-does-not-affect-person-or-eligibility');
        await assert.rejects(decide(secretary.id, a.r.id, pending.id, decision()), code('EVIDENCE_INCOMPLETE'));
        await decide(secretary.id, a.r.id, pending.id, decision('RETURN'));
        assert.deepEqual(await db.people.findUniqueOrThrow({ where: { id: a.p.id } }), before);
        assert.equal((await db.player_registrations.findUniqueOrThrow({ where: { id: a.r.id } })).status, 'ACTIVE');
        checks.push('incomplete-returned-without-dossier-change');
        const self = await request(admin.id, a.r.id, req(), evidence);
        await assert.rejects(decide(admin.id, a.r.id, self.id, decision()), code('SELF_APPROVAL'));
        await decide(secretary.id, a.r.id, self.id, decision('RETURN'));
        checks.push('self-approval-denied');
        const cross = await request(delegate.id, a.r.id, req(), evidence);
        await db.$transaction(async (tx) => { await tx.$queryRaw `SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Referencia sintética en otra liga',true)`; await tx.player_registrations.create({ data: { person_id: a.p.id, season_id: f[1].season.id, season_team_id: f[1].st.id, reference_number: randomUUID(), status: 'ACTIVE', identity_review_status: 'NOT_REQUIRED' } }); });
        await assert.rejects(decide(secretary.id, a.r.id, cross.id, decision()), e => e instanceof AuthorizationError);
        const otherEvidence = (await workspace(delegate.id, a.r.id)).requests.find(r => r.id === cross.id)!.evidence[0].id;
        await assert.rejects(readCorrectionEvidenceForActor(foreign.id, a.r.id, otherEvidence), e => e instanceof AuthorizationError);
        // Acuses sintéticos válidos antes de corregir; nunca se contacta al proveedor.
        const oldVerification=await db.$transaction(async tx=>{
            await tx.$queryRaw`SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Acuses sintéticos aislados sin proveedor',true)`;
            const raw={curp:a.p.curp,firstName:a.p.first_name,paternalSurname:a.p.paternal_surname,maternalSurname:a.p.maternal_surname??'',birthDate:'1990-01-01'};
            const fingerprint=createHash('sha256').update(JSON.stringify([1,raw])).digest('hex');
            const check=await tx.player_curp_checks.create({data:{operation_key:randomUUID(),actor_id:admin.id,person_id:a.p.id,registration_id:a.r.id,identity_version:1,fingerprint}});
            await tx.player_curp_checks.update({where:{id:check.id},data:{status:'VERIFIED',finished_at:new Date()}});
            const context=await readLockedPlayerTeamContext(tx,a.r.season_team_id);
            const attempt=await tx.audit_logs.create({data:{user_id:admin.id,action:'PLAYER_INE_PREPARED',reason:'Verificación sintética sin proveedor',table_name:'player_registrations',entity_id:a.r.id,new_data:{snapshotVersion:2,snapshotHash:ineSnapshotHash(context,1,null,'OPEN')}}});
            await tx.audit_logs.create({data:{user_id:admin.id,action:'PLAYER_INE_RESULT',reason:'Resultado sintético sin proveedor',table_name:'player_registrations',entity_id:a.r.id,new_data:{attemptId:attempt.id,outcome:'IDENTITY_VERIFIED',matchingVersion:1}}});
            return {curp:{checkId:check.id},ine:{attemptId:attempt.id}};
        });
        assert.deepEqual(await db.$transaction(tx=>readIdentityDocumentEvidence(tx,a.r.id)),oldVerification);
        const success = await decide(admin.id, a.r.id, cross.id, decision());
        assert.equal(success.status, 'APPLIED');
        assert.equal((await db.people.findUniqueOrThrow({ where: { id: a.p.id } })).id, a.p.id);
        assert.equal(await db.player_registrations.count({ where: { person_id: a.p.id, status: 'INELIGIBLE' } }), 2);
        assert.deepEqual(await db.$transaction(tx => readIdentityDocumentEvidence(tx, a.r.id)), {curp:null,ine:null});
        assert.equal((await db.player_curp_checks.findUniqueOrThrow({where:{id:oldVerification.curp.checkId}})).status,'VERIFIED');
        checks.push('previous-curp-ine-receipts-retained-but-invalidated');
        const invalidatedParticipation=await db.player_category_participations.findUniqueOrThrow({where:{id:participation.id}});
        assert.equal(invalidatedParticipation.status,'WITHDRAWN');
        assert.equal(invalidatedParticipation.version,3);
        assert.equal(invalidatedParticipation.eligibility_fingerprint,null);
        assert.equal(invalidatedParticipation.origin_registration_id,participation.origin_registration_id);
        checks.push('authorized-superior-participation-invalidated-with-receipt');
        checks.push('all-leagues-checked-global-application', 'references-preserved-both-registrations-invalidated');
        // Two distinct people compete for one new CURP: exactly one successful application.
        const c = await create('1992-03-03', 'SIAA'), d = await create('1992-03-03', 'SIEE');
        const shared = curp('1992-03-03', 'SIOO');
        const race = await Promise.all([c, d].map(x => request(delegate.id, x.r.id, { ...req(x.p), identity: { ...proposed(x.p), curp: shared } }, evidence)));
        const results = await Promise.allSettled([c, d].map((x, i) => decide(admin.id, x.r.id, race[i].id, decision())));
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        assert.ok(results.some(r => r.status === 'rejected' && code('DUPLICATE_CURP')(r.reason)));
        assert.equal(await db.people.count({ where: { curp: shared } }), 1);
        checks.push('concurrent-curp-one-winner');
        // Same request concurrent decisions: no second application/version increment.
        const stale = await request(delegate.id,b.r.id,req(b.p),evidence);
        const one = await request(delegate.id, b.r.id, req(b.p), evidence);
        const same = decision();
        const decisions = await Promise.all([decide(admin.id, b.r.id, one.id, same), decide(admin.id, b.r.id, one.id, same)]);
        assert.equal(decisions.filter(r => r.replayed).length, 1);
        assert.equal((await db.people.findUniqueOrThrow({ where: { id: b.p.id } })).identity_version, 2);
        checks.push('idempotent-concurrent-approval');
        await assert.rejects(decide(admin.id,b.r.id,stale.id,decision()),code('IDENTITY_CHANGED'));
        await assert.rejects(request(delegate.id,b.r.id,req(b.p),evidence),code('IDENTITY_CHANGED'));
        checks.push('stale-request-and-decision-denied');
        const referee=await create('1993-04-04','SIAA');
        await db.referees.create({data:{person_id:referee.p.id}});
        const refereeRequest=await request(delegate.id,referee.r.id,req(referee.p),evidence);
        await assert.rejects(decide(secretary.id,referee.r.id,refereeRequest.id,decision()),e=>e instanceof AuthorizationError);
        await decide(admin.id,referee.r.id,refereeRequest.id,decision());
        checks.push('shared-referee-requires-global-authority');
        // Menor: conservar únicamente el consentimiento vigente ya acreditado.
        const minor=await create('2010-05-05','SIAA');
        const guardianDocs=await db.$transaction(async tx=>{
            await tx.$queryRaw`SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Documentos sintéticos aislados de tutor',true)`;
            await tx.player_registrations.update({where:{id:minor.r.id},data:{status:'INELIGIBLE'}});
            const type=await tx.document_types.findUniqueOrThrow({where:{code:'GUARDIAN_CONSENT'}});
            const ids:string[]=[];
            for(let index=0;index<3;index++){
                const file=await tx.files.create({data:{storage_key:`synthetic/${randomUUID()}`,original_name:'documento-sintetico.pdf',mime_type:'application/pdf',size_bytes:BigInt(bytes.length),uploaded_by:admin.id}});
                const doc=await tx.player_documents.create({data:{registration_id:minor.r.id,document_type_id:type.id,file_id:file.id,status:'VALIDATED',reviewed_by:admin.id}});
                await tx.audit_logs.create({data:{user_id:admin.id,reason:'Acuse sintético aislado PDGLD-117',action:'PLAYER_DOCUMENT_CONFIRMED',table_name:'player_documents',entity_id:minor.r.id,new_data:{documentId:doc.id,replacesDocumentId:index===1?ids[0]:null,identityVersion:1}}});
                await tx.audit_logs.create({data:{user_id:admin.id,reason:'Acuse sintético aislado PDGLD-117',action:'PLAYER_DOCUMENT_REVIEWED',table_name:'player_documents',entity_id:minor.r.id,new_data:{documentId:doc.id,identityVersion:1,guardianAccredited:index<2}}});
                ids.push(doc.id);
            }
            return ids;
        });
        const guardianState=()=>db.$transaction(async tx=>readCategoryDocumentState(tx,minor.r.id,(await tx.people.findUniqueOrThrow({where:{id:minor.p.id}})).identity_version,await resolveCategoryDocuments(tx,f[0].sc.id,true)));
        assert.equal((await guardianState()).guardianAccredited,true);
        const minorCorrection=await request(delegate.id,minor.r.id,req(minor.p),evidence);
        await decide(admin.id,minor.r.id,minorCorrection.id,decision());
        const afterGuardian=await guardianState();
        assert.equal(afterGuardian.guardianAccredited,true);
        assert.equal(afterGuardian.confirmed.has(guardianDocs[0]),false);
        assert.equal(afterGuardian.confirmed.has(guardianDocs[1]),true);
        assert.equal(afterGuardian.confirmed.has(guardianDocs[2]),false);
        assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:minor.r.id}})).status,'INELIGIBLE');
        checks.push('minor-keeps-only-current-accredited-guardian-document');
        for(const status of ['SUSPENDED','WITHDRAWN']){
            const item=await create(status==='SUSPENDED'?'1994-06-06':'1995-07-07','SIAA');
            await db.$transaction(async tx=>{
                await tx.$queryRaw`SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Estado sintético previo a corrección',true)`;
                await tx.player_registrations.update({where:{id:item.r.id},data:{status,...(status==='WITHDRAWN'?{withdrawn_at:new Date()}: {})}});
            });
            const correction=await request(delegate.id,item.r.id,req(item.p),evidence);
            await decide(admin.id,item.r.id,correction.id,decision());
            assert.equal((await db.player_registrations.findUniqueOrThrow({where:{id:item.r.id}})).status,status);
        }
        checks.push('suspended-and-withdrawn-not-reactivated');
        // Audit failure must roll back person, version, status, decision and all invalidations.
        const rollbackBody = { ...req(b.p), expectedIdentityVersion: 2, identity: { ...proposed(b.p), firstName: 'Nombre Revertido' } };
        const rollbackRequest = await request(delegate.id, b.r.id, rollbackBody, evidence);
        const rollbackBefore = await db.people.findUniqueOrThrow({ where: { id: b.p.id } }), statusBefore = await db.player_registrations.findUniqueOrThrow({ where: { id: b.r.id } });
        await db.$executeRawUnsafe("CREATE FUNCTION correction_clock.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='PLAYER_CORRECTION_APPLIED' THEN RAISE EXCEPTION 'SYNTHETIC_FAILURE'; END IF; RETURN NEW; END $$");
        await db.$executeRawUnsafe('CREATE TRIGGER correction_fail BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION correction_clock.fail_audit()');
        try {
            await assert.rejects(decide(admin.id, b.r.id, rollbackRequest.id, decision()));
        }
        finally {
            await db.$executeRawUnsafe('DROP TRIGGER correction_fail ON sports_management.audit_logs');
        }
        assert.deepEqual(await db.people.findUniqueOrThrow({ where: { id: b.p.id } }), rollbackBefore);
        assert.deepEqual(await db.player_registrations.findUniqueOrThrow({ where: { id: b.r.id } }), statusBefore);
        assert.equal((await db.player_identity_corrections.findUniqueOrThrow({ where: { id: rollbackRequest.id } })).status, 'PENDING');
        checks.push('audit-failure-full-rollback');
        checks.push(...await verifyMixedSeasonHistory({admin:admin.id,delegate:delegate.id,foreign:foreign.id,
          context:{seasonId:f[0].season.id,stId:f[0].st.id,clubId:f[0].club.id,leagueId:f[0].league.id,sportId:f[0].sport.id,higherTeamId:participation.target_season_team_id,higherCategoryId:participation.target_season_category_id},curp,evidence}));
        // Closure uses real triggers. The correction remains pending, and labels stay identical.
        const historic = await request(delegate.id, b.r.id, { ...req(b.p), expectedIdentityVersion: 2, identity: { ...proposed(b.p), firstName: 'Otro Nombre' } }, evidence);
        const legacy = await create('1996-08-08', 'SIAA');
        await db.$transaction(async tx=>{
          const referee=await tx.referees.create({data:{person_id:b.p.id}});
          await tx.club_season_referees.create({data:{season_id:f[0].season.id,club_id:f[0].club.id,referee_id:referee.id}});
        });

        // Simula un cierre anterior a la migración, solo en esta base desechable.
        // El resto de triggers siguen activos y la barrera nunca se deshabilita.
        await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Cierre legado sintético sin captura',true)`;
            await tx.club_officers.create({data:{affiliation_id:f[0].affiliation.id,person_id:b.p.id,office:'PRESIDENT',starts_at:new Date('2026-01-01')}});
            await tx.club_officers.create({data:{affiliation_id:f[1].affiliation.id,person_id:legacy.p.id,office:'PRESIDENT',starts_at:new Date('2026-01-01')}});
            await tx.$executeRawUnsafe('ALTER TABLE sports_management.seasons DISABLE TRIGGER capture_season_identity_history');
            await tx.seasons.update({ where: { id: f[1].season.id }, data: { status: 'ACTIVE' } });
            await tx.player_registrations.create({ data: { person_id: legacy.p.id, season_id: f[1].season.id, season_team_id: f[1].st.id, reference_number: randomUUID(), status: 'ACTIVE', identity_review_status: 'NOT_REQUIRED' } });
            await tx.seasons.update({ where: { id: f[1].season.id }, data: { status: 'CLOSED', closed_at: new Date() } });
            await tx.$executeRawUnsafe('ALTER TABLE sports_management.seasons ENABLE TRIGGER capture_season_identity_history');
        });
        const legacyRegistration = await db.player_registrations.findFirstOrThrow({where:{person_id:legacy.p.id,season_id:f[1].season.id}});
        assert.deepEqual(await db.$transaction(tx => readSeasonIdentityHistory(tx, legacy.p.id, f[1].season.id)), {status:'UNAVAILABLE'});
        assert.deepEqual(await db.$transaction(tx => readSeasonIdentityCapture(tx, f[1].season.id)), {status:'UNAVAILABLE'});
        assert.equal((await db.$transaction(tx => readRegistrationLabels(tx, legacyRegistration.id))).name, 'Información histórica no disponible');
        assert.equal((await listRegisteredPlayersForActor(admin.id)).find(r=>r.registrationId===legacyRegistration.id)?.displayName, 'Información histórica no disponible');
        await assert.rejects(readPlayerDossierForActor(admin.id,legacyRegistration.id), e=>e instanceof HistoricalDossierUnavailable && e.displayName==='Información histórica no disponible');
        const legacyParticipation=await readPlayerParticipationWorkspaceForActor(admin.id,legacyRegistration.id);
        assert.equal(legacyParticipation.source.assessment,null);
        assert.equal(legacyParticipation.canRequest,false);
        assert.deepEqual(legacyParticipation.targets,[]);
        checks.push('legacy-closure-without-snapshot-never-falls-back-to-current-identity');
        await db.$transaction(async (tx) => { await tx.$queryRaw `SELECT set_config('app.user_id',${admin.id},true),set_config('app.reason','Cierre sintético aislado',true)`; await tx.seasons.update({ where: { id: f[0].season.id }, data: { status: 'ACTIVE' } }); await tx.seasons.update({ where: { id: f[0].season.id }, data: { status: 'CLOSED', closed_at: new Date() } }); });
        assert.equal((await workspace(admin.id, b.r.id)).applyBlockedCode, 'HISTORICAL_REFEREE_UNPROTECTED');
        const labelsBefore = await db.$transaction(tx => readRegistrationLabels(tx, b.r.id));
        const captured=await db.$transaction(tx=>readSeasonIdentityHistory(tx,b.p.id,f[0].season.id));
        assert.equal(captured.status,'CAPTURED');
        if(captured.status==='CAPTURED') assert.equal(captured.firstName,'Alvaro Corregido');
        const capture=await db.$transaction(tx=>readSeasonIdentityCapture(tx,f[0].season.id));
        assert.equal(capture.status,'CAPTURED');
        if(capture.status==='CAPTURED') {
            assert.equal(capture.personCount,await db.season_person_identity_snapshots.count({where:{season_id:f[0].season.id}}));
            assert.equal(capture.formatVersion,1);
        }
        checks.push('future-closure-private-receipt-with-count-version-and-provenance');
        await assert.rejects(readPlayerDossierForActor(admin.id,b.r.id),e=>e instanceof HistoricalDossierUnavailable && e.displayName===labelsBefore.name);
        const closedParticipation=await readPlayerParticipationWorkspaceForActor(admin.id,a.r.id);
        assert.equal(closedParticipation.source.assessment,null);
        assert.ok(closedParticipation.participations.every(p=>!p.assessment && !p.canReview && !p.sportsEligible));
        checks.push('captured-names-do-not-accredit-historical-age-documents-or-eligibility');
        const personBefore = await db.people.findUniqueOrThrow({ where: { id: b.p.id } });
        await assert.rejects(decide(admin.id, b.r.id, historic.id, decision()), code('HISTORICAL_REFEREE_UNPROTECTED'));
        assert.deepEqual(await db.people.findUniqueOrThrow({ where: { id: b.p.id } }), personBefore);
        assert.deepEqual(await db.$transaction(tx => readRegistrationLabels(tx, b.r.id)), labelsBefore);
        await assert.rejects(db.people.update({ where: { id: b.p.id }, data: { first_name: 'SQL no permitido' } }));
        checks.push('closed-season-no-identity-rewrite-even-direct-sql');
        // General audit never includes request PII, observations or binary evidence.
        const logs = await db.audit_logs.findMany({ where: { action: { startsWith: 'PLAYER_CORRECTION' } } });
        for (const log of logs) {
            const text = JSON.stringify(log);
            assert.equal(text.includes(shared), false);
            assert.equal(text.includes('Documentación privada'), false);
            assert.equal(text.includes('Alvaro'), false);
        }
        checks.push('general-audit-without-pii');
        assert.ok((await listRegisteredPlayersForActor(delegate.id)).some(r => r.registrationId === b.r.id && r.displayName === labelsBefore.name));
        // Browser reads real server/auth/data, including the closed-history guard message.
        const major = new URL(target.databaseUrl).port.slice(-2);
        browser = await launchChrome(target.baseUrl);
        const run = <T extends unknown[]>(fn: (...args: T) => unknown, ...args: T) => browser!.evaluate(`(${fn.toString()})(...${JSON.stringify(args)})`);
        const wait = async <T extends unknown[]>(fn: (...args: T) => unknown, ...args: T) => { for (let i = 0; i < 240; i++) {
            if (await run(fn, ...args))
                return;
            await new Promise(r => setTimeout(r, 250));
        } throw Error('CORRECTION_BROWSER_TIMEOUT'); };
        await browser.command('Page.navigate', { url: target.baseUrl + '/login' });
        await wait(() => document.readyState === 'complete');
        assert.equal(await run(async (email: string, password: string) => { const { csrfToken } = await (await fetch('/api/auth/csrf')).json(); const r = await fetch('/api/auth/callback/credentials', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email, password, csrfToken, json: 'true', callbackUrl: '/access' }) }); return r.ok; }, admin.email, fixturePassword), true);
        for (const [affiliationId, expected] of [[f[0].affiliation.id,'Alvaro Corregido'],[f[1].affiliation.id,'Información histórica no disponible']]) {
            const officer=await run(async(id:string)=>{const response=await fetch(`/api/affiliations/${id}`);const body=await response.json();return {status:response.status,names:body.officers?.map((o:{firstName:string})=>o.firstName)};},affiliationId);
            assert.equal(officer.status,200);
            assert.deepEqual(officer.names,[expected]);
        }
        checks.push('closed-affiliation-officers-use-snapshot-or-explicit-unavailability');
        await browser.command('Page.navigate', { url: `${target.baseUrl}/players/registrations/${b.r.id}/identity-corrections` });
        await wait(() => document.body?.textContent?.includes('Solicitudes de este expediente'));
        assert.equal(await run(() => document.querySelectorAll('main').length), 1);
        const endpoint = `/api/player-registrations/${b.r.id}/identity-corrections`;
        const httpDecision = await run(async (path: string, actor: string, body: unknown) => {
            const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Expected-Actor-Id': actor }, body: JSON.stringify(body) });
            return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
        }, `${endpoint}/${historic.id}`, admin.id, decision());
        assert.equal(httpDecision.status, 409);
        assert.equal(httpDecision.body.code, 'HISTORICAL_REFEREE_UNPROTECTED');
        assert.match(httpDecision.cache, /no-store/);
        const switched = await run(async (path: string, actor: string) => (await fetch(path, { headers: { 'X-Expected-Actor-Id': actor } })).status, endpoint, delegate.id);
        assert.equal(switched, 403);
        const download = await run(async (path: string) => { const response = await fetch(path); return { status: response.status, mime: response.headers.get('content-type'), cache: response.headers.get('cache-control'), sandbox: response.headers.get('content-security-policy') }; }, `${endpoint}/evidence/${(await workspace(admin.id,b.r.id)).requests.find(r=>r.id===historic.id)!.evidence[0].id}`);
        assert.equal(download.status,200);
        assert.equal(download.mime,'application/pdf');
        assert.match(download.cache,/no-store/);
        assert.equal(download.sandbox,'sandbox');
        checks.push('http-history-conflict-actor-switch-private-download');

        assert.equal(await run(() => document.body?.textContent?.includes('temporadas cerradas')), true);
        for (const width of [1280, 390]) {
            await browser.command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
            for (const theme of ['light','dark']) {
                await run((value:string)=>{document.documentElement.setAttribute('data-theme',value);document.documentElement.classList.toggle('dark',value==='dark');},theme);
                assert.equal(await run(() => document.documentElement.scrollWidth <= innerWidth + 2), true);
                const screenshot=await browser.command('Page.captureScreenshot',{format:'png'});
                await writeFile(`${dirname(process.cwd())}/evidence-pg${major}/identity-${width}-${theme}.png`,Buffer.from(screenshot.data,'base64'),{mode:0o600});
            }
        }
        // Submit the actual hydrated form by native Chrome input; no automatic replay.
        await wait(() => { const e = document.querySelector('#correction-firstName'); return e && Object.keys(e).some(k => k.startsWith('__reactProps$')); });
        await run(() => { for (const [selector, value] of [['#correction-firstName', 'Nombre Navegador'], ['textarea[name=reason]', 'Solicitud sintética desde Chrome']]) {
            const e = document.querySelector(selector) as HTMLInputElement;
            const proto = e.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(e, value);
            e.dispatchEvent(new Event('input', { bubbles: true }));
        } });
        const point = await run(() => { const e = [...document.querySelectorAll('button')].find(b => b.textContent === 'Enviar solicitud')!; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        for (const type of ['mousePressed', 'mouseReleased'])
            await browser.command('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
        await wait(() => document.body?.textContent?.includes('Operación confirmada.'));
        assert.equal(await run(() => document.activeElement?.getAttribute('role')), 'status');
        const uiState = await run(async (path: string) => { const response = await fetch(path); return response.json(); }, `/api/player-registrations/${b.r.id}/identity-corrections`);
        assert.ok(uiState.requests.some((r: {
            status: string;
            reason: string;
        }) => r.status === 'PENDING' && r.reason === 'Solicitud sintética desde Chrome'));
        assert.deepEqual(await db.people.findUniqueOrThrow({ where: { id: b.p.id } }), personBefore);
        await browser.close();
        browser = undefined;
        checks.push('real-chrome-private-workspace-desktop-mobile', 'native-form-submit-and-status-focus');
        await writeFile(`${dirname(process.cwd())}/evidence-pg${major}/identity-correction.json`, JSON.stringify({ passed: true, typecheck: true, checks, providers: 'not-called' }, null, 2), { mode: 0o600 });
    }
    finally {
        await browser?.close();
        await db.$disconnect();
    }
}
