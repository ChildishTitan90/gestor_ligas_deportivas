import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { childEnvironment } from '../../scripts/ci/delegate-isolated-runtime.mjs';
import { validateAccountProvisioningTarget } from '../../scripts/verification/account-provisioning-entry.mjs';
import { Browser } from './auth.test.mjs';
import { fixturePassword } from './auth-fixtures.mjs';

// El supervisor ya está validado; se vuelve a comprobar en el hijo antes de conectar.
export function runEmailChangeDatabaseSuite(target, actorId, scopedId) {
  const config = validateAccountProvisioningTarget(target);
  return new Promise((resolve, reject) => {
    const child = fork(new URL(import.meta.url), [], { execArgv: ['--conditions=react-server'],
      env: childEnvironment(process.env), stdio: ['ignore','ignore','ignore','ipc'] });
    let completed = false;
    const timeout = setTimeout(() => child.kill('SIGTERM'), 90_000);
    const stop = () => child.kill('SIGTERM');
    process.once('disconnect', stop);
    child.on('message', message => {
      if (message?.completed === true && message.concurrentRequestsPassed === true) completed = true;
    });
    child.once('error', () => { completed = false; });
    child.once('close', code => {
      clearTimeout(timeout);
      process.removeListener('disconnect', stop);
      if (code === 0 && completed) resolve(); else reject(new Error('EMAIL_CHANGE_DATABASE_FAILED'));
    });
    child.send({ ...config, actorId, scopedId });
  });
}

async function execute(config) {
  const target = validateAccountProvisioningTarget(config);
  assert.match(config.actorId, /^[a-f0-9-]{36}$/); assert.match(config.scopedId, /^[a-f0-9-]{36}$/);
  const [{ default: pg }, { PrismaClient }, { PrismaPg }, { tsImport }] = await Promise.all([
    import('pg'),import('@prisma/client'),import('@prisma/adapter-pg'),import('tsx/esm/api'),
  ]);
  const { createDatabaseEmailChanges } = await tsImport('../../src/features/accounts/server/email-change.ts', import.meta.url);
  const runtimeUrl = target.runtimeDatabaseUrl ?? target.databaseUrl;
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtimeUrl }), log: [] });
  const owner = new pg.Client({ connectionString: target.databaseUrl });
  await owner.connect();
  const messages = [];
  const service = createDatabaseEmailChanges(prisma, async () => config.actorId, {
    async send(message) { messages.push(message); return 'ACCEPTED'; },
  });
  const denied = createDatabaseEmailChanges(prisma, async () => config.scopedId, null);
  const noTransport = createDatabaseEmailChanges(prisma, async () => config.actorId, null);
  const token = () => messages.filter(row => row.kind === 'EMAIL_CHANGE_CONFIRMATION').at(-1).token;
  const targets = [];
  const raceClients = [];
  const input = async (id, email=`${randomUUID()}@example.test`) => ({
    email, operationKey: randomUUID(), expectedRevision: (await snapshot(id)).user.maintenance_revision,
    confirmed: true, reason: 'Cambio sintético aislado de correo',
  });
  const snapshot = async id => ({
    user: (await owner.query('SELECT * FROM sports_management.users WHERE id=$1',[id])).rows[0],
    requests: (await owner.query('SELECT * FROM sports_management.account_email_changes WHERE user_id=$1 ORDER BY id',[id])).rows,
    sessions: (await owner.query('SELECT * FROM sports_management.sessions WHERE user_id=$1 ORDER BY id',[id])).rows,
    resets: (await owner.query('SELECT * FROM sports_management.password_resets WHERE user_id=$1 ORDER BY id',[id])).rows,
    audit: (await owner.query("SELECT * FROM sports_management.audit_logs WHERE entity_id=$1 ORDER BY id",[id])).rows,
  });
  const rejectCode = (work, code) => assert.rejects(work, error => error.code === code);
  const age = id => owner.query("UPDATE sports_management.account_email_changes SET created_at=created_at-interval '61 seconds' WHERE user_id=$1",[id]);
  try {
    for (let i=0;i<7;i++) {
      const person=(await owner.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES ('Persona','Sintética') RETURNING id")).rows[0].id;
      const id=(await owner.query(`INSERT INTO sports_management.users(person_id,username,email,password_hash,is_active,must_change_password)
        SELECT $1,$2,$3,password_hash,true,false FROM sports_management.users WHERE id=$4 RETURNING id`,
      [person,`email_${randomBytes(6).toString('hex')}`,`${randomUUID()}@example.test`,config.actorId])).rows[0].id;
      targets.push(id);
      await owner.query(`INSERT INTO sports_management.sessions(user_id,token_hash,created_at,last_activity_at,expires_at)
        VALUES ($1,$2,now(),now(),now()+interval '1 hour')`,[id,randomBytes(32).toString('hex')]);
      await owner.query(`INSERT INTO sports_management.password_resets(user_id,token_hash,expires_at)
        VALUES ($1,$2,now()+interval '1 hour')`,[id,randomBytes(32).toString('hex')]);
    }
    const [a,b,c,d,e,f,resetTarget]=targets;
    const admin=new Browser(target.baseUrl),scoped=new Browser(target.baseUrl),anonymous=new Browser(target.baseUrl);
    for(const [browser,id] of [[admin,config.actorId],[scoped,config.scopedId]]) {
      const user=(await owner.query('SELECT username FROM sports_management.users WHERE id=$1',[id])).rows[0];
      await browser.login(user.username,fixturePassword); assert.ok((await browser.session()).user);
    }
    await testAdministrativeReset();
    async function testAdministrativeReset() {
      const { issueAdministrativeCredential } = await tsImport('../../src/features/accounts/server/administrative-reset.ts', import.meta.url);
      const resetPath = `/api/account-maintenance/${resetTarget}/reset-access`;
      const payload = { expectedRevision: 0, confirmed: true, identityVerified: true,
        verificationMethod: 'IN_PERSON', reason: 'Identidad sintética comprobada en persona' };
      const postReset = browser => browser.request(resetPath, { method:'POST',
        headers:{origin:target.baseUrl,'content-type':'application/json'},body:JSON.stringify(payload) });
      assert.equal((await postReset(scoped)).status,403);
      assert.equal((await (await postReset(admin)).json()).code,'VERIFIED_CHANNEL_REQUIRED');
      await owner.query('UPDATE sports_management.users SET email_verified_at=now() WHERE id=$1',[resetTarget]);
      const before = await snapshot(resetTarget);
      const old = new Browser(target.baseUrl);
      await old.login(before.user.username,fixturePassword);
      assert.ok((await old.session()).user);
      assert.equal((await (await postReset(admin)).json()).code,'NOT_CONFIGURED');
      assert.equal((await snapshot(resetTarget)).user.version,before.user.version);
      let credential;
      const delivery = { async send(message) { credential = message.temporaryPassword; return 'ACCEPTED'; } };
      const attempt = () => issueAdministrativeCredential(config.actorId,resetTarget,payload,prisma,delivery);
      const race = await Promise.allSettled([attempt(),attempt()]);
      assert.equal(race.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(race.find(x=>x.status==='rejected')?.reason.code,'ACCOUNT_CHANGED');
      const after = await snapshot(resetTarget);
      assert.equal(after.user.version,before.user.version+1);
      assert.ok(after.sessions.every(session=>session.revoked_at));
      assert.ok(after.resets.every(reset=>reset.used_at));
      assert.equal(after.audit.filter(row=>row.new_data?.operation==='ADMINISTRATIVE_RESET').length,1);
      assert.equal(JSON.stringify(after.audit).includes(credential),false);
      assert.equal((await old.session()).user,undefined);
      await old.login(before.user.username,fixturePassword);
      assert.equal((await old.session()).user,undefined);
      const first = new Browser(target.baseUrl), second = new Browser(target.baseUrl);
      await first.login(before.user.username,credential);
      assert.equal((await first.session()).user?.mustChangePassword,true);
      assert.equal((await first.request('/api/account-maintenance')).status,403);
      await second.login(before.user.username,credential);
      assert.equal((await second.session()).user,undefined);
      const newPassword = 'Synthetic-Changed!42';
      const changed = await first.request('/api/auth/change-password', {method:'POST',
        headers:{origin:target.baseUrl,'content-type':'application/json'},
        body:JSON.stringify({currentPassword:credential,newPassword,confirmPassword:newPassword})});
      assert.equal(changed.status,200);
      await second.login(before.user.username,newPassword);
      assert.equal((await second.session()).user?.mustChangePassword,false);
    }
    const path=`/api/account-maintenance/${e}/email-change`, httpInput=await input(e);
    const post=(browser,body,origin=target.baseUrl)=>browser.request(path,{method:'POST',
      headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal((await post(anonymous,httpInput)).status,401);
    assert.equal((await post(scoped,httpInput)).status,403);
    assert.equal((await post(admin,httpInput,'https://cross-site.invalid')).status,403);
    assert.equal((await post(admin,{...httpInput,actorId:config.actorId})).status,400);
    assert.equal((await post(admin,{...httpInput,expectedRevision:99})).status,409);
    const httpBefore=await snapshot(e), httpResponse=await post(admin,httpInput);
    assert.equal(httpResponse.status,202); assert.match(httpResponse.headers.get('cache-control'),/private.*no-store/);
    const httpResult=await httpResponse.json(); assert.equal(httpResult.confirmationDelivery,'NOT_CONFIGURED');
    assert.ok(!('token' in httpResult)); assert.ok(!('tokenHash' in httpResult));
    assert.deepEqual(await (await admin.request(`${path}?operationKey=${httpInput.operationKey}`)).json(),httpResult);
    assert.equal((await scoped.request(`${path}?operationKey=${httpInput.operationKey}`)).status,403);
    assert.equal((await post(admin,httpInput)).status,202);
    const existingLogin=new Browser(target.baseUrl),pendingLogin=new Browser(target.baseUrl);
    await existingLogin.login(httpBefore.user.email,fixturePassword); assert.ok((await existingLogin.session()).user);
    await pendingLogin.login(httpInput.email,fixturePassword); assert.equal((await pendingLogin.session()).user,undefined);
    const confirmPath='/api/account-maintenance/email-change/confirm';
    assert.equal((await anonymous.request(confirmPath)).status,405);
    assert.equal((await anonymous.request(confirmPath,{method:'POST',headers:{origin:target.baseUrl,'content-type':'application/json'},
      body:JSON.stringify({token:`ec1_${randomBytes(32).toString('base64url')}`})})).status,409);
    const accountBrowser=new Browser(target.baseUrl), initialAccount=(await snapshot(a)).user;
    await accountBrowser.login(initialAccount.email,fixturePassword); assert.ok((await accountBrowser.session()).user);
    const data=await input(a), before=await snapshot(a);
    await rejectCode(denied.request(a,data),'FORBIDDEN'); assert.deepEqual(await snapshot(a),before);
    const response=await service.request(a,data), secret=token();
    assert.equal(response.confirmationDelivery,'ACCEPTED'); assert.ok(!JSON.stringify(response).includes(secret));
    let after=await snapshot(a);
    assert.equal(after.user.email,before.user.email); assert.equal(after.user.version,before.user.version);
    assert.equal(after.user.email_verified_at,null); assert.ok(after.requests[0].token_hash !== secret);
    assert.equal(after.user.maintenance_revision,before.user.maintenance_revision+1);
    assert.deepEqual(after.sessions,before.sessions); assert.deepEqual(after.resets,before.resets);
    assert.ok((await accountBrowser.session()).user);
    assert.deepEqual(await service.request(a,data),response); assert.equal(messages.length,2);
    const confirmations=await Promise.allSettled([service.confirm({token:secret}),service.confirm({token:secret})]);
    assert.equal(confirmations.filter(row=>row.status==='fulfilled').length,1);
    await rejectCode(service.confirm({token:secret}),'EMAIL_CHANGE_INVALID');
    after=await snapshot(a); assert.equal(after.user.email,data.email); assert.ok(after.user.email_verified_at);
    assert.equal(after.user.version,before.user.version+1); assert.ok(after.sessions.every(row=>row.revoked_at));
    assert.ok(after.resets.every(row=>row.used_at)); assert.equal(after.audit.length,2);
    assert.ok(!JSON.stringify(after.audit).includes(secret));
    assert.equal((await accountBrowser.session()).user,undefined);
    const oldLogin=new Browser(target.baseUrl); await oldLogin.login(before.user.email,fixturePassword);
    assert.equal((await oldLogin.session()).user,undefined);
    await accountBrowser.login(data.email,fixturePassword); assert.ok((await accountBrowser.session()).user);

    await service.request(b,await input(b)); const expired=token();
    await owner.query("UPDATE sports_management.account_email_changes SET created_at=now()-interval '1 hour',expires_at=now()-interval '1 second' WHERE user_id=$1",[b]);
    const expiredState=await snapshot(b);
    await rejectCode(service.confirm({token:expired}),'EMAIL_CHANGE_INVALID'); assert.deepEqual(await snapshot(b),expiredState);
    await service.request(b,await input(b)); const replaced=token(); await age(b);
    await service.request(b,await input(b)); const live=token();
    await rejectCode(service.confirm({token:replaced}),'EMAIL_CHANGE_INVALID');
    await owner.query('UPDATE sports_management.users SET must_change_password=true WHERE id=$1',[config.actorId]);
    try { await rejectCode(service.confirm({token:live}),'FORBIDDEN'); }
    finally { await owner.query('UPDATE sports_management.users SET must_change_password=false WHERE id=$1',[config.actorId]); }

    // La autoridad global no sustituye unicidad: verificar al solicitar y al confirmar.
    await age(b); await rejectCode(service.request(b,await input(b,data.email)),'DUPLICATE_ACCOUNT');
    const legacy=`${randomUUID()}@example.test`;
    await owner.query('UPDATE sports_management.users SET username=$2 WHERE id=$1',[d,legacy]);
    await rejectCode(service.request(c,await input(c,legacy)),'DUPLICATE_ACCOUNT');
    const shared=`${randomUUID()}@example.test`;
    await service.request(c,await input(c,shared)); const left=token();
    await service.request(d,await input(d,shared)); const right=token();
    const race=await Promise.allSettled([service.confirm({token:left}),service.confirm({token:right})]);
    assert.equal(race.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(race.find(row=>row.status==='rejected').reason.code,'DUPLICATE_ACCOUNT');

    // Un fallo real de auditoría debe revertir UPDATE, consumo, resets y revocación.
    const rollbackBefore=await snapshot(b), fn=`email_audit_${randomBytes(5).toString('hex')}`;
    await owner.query(`CREATE FUNCTION sports_management.${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='ACCOUNT_EMAIL_CONFIRMED' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await owner.query(`CREATE TRIGGER ${fn} BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION sports_management.${fn}()`);
    try { await assert.rejects(service.confirm({token:live})); }
    finally { await owner.query(`DROP TRIGGER ${fn} ON sports_management.audit_logs`); await owner.query(`DROP FUNCTION sports_management.${fn}()`); }
    assert.deepEqual(await snapshot(b),rollbackBefore);
    const publicConfirmation=await anonymous.request(confirmPath,{method:'POST',
      headers:{origin:target.baseUrl,'content-type':'application/json'},body:JSON.stringify({token:live})});
    assert.equal(publicConfirmation.status,200); assert.equal((await publicConfirmation.json()).sessionsRevoked,true);
    await age(a);
    const unavailable=await noTransport.request(a,await input(a));
    assert.equal(unavailable.confirmationDelivery,'NOT_CONFIGURED'); assert.equal(unavailable.previousNoticeDelivery,'NOT_CONFIGURED');
    assert.equal((await snapshot(a)).user.email,data.email);

    // Dos conexiones reales deben estar esperando el mismo bloqueo antes de
    // liberarlo. Promise.all por sí solo no demuestra superposición en PostgreSQL.
    const concurrentBefore=await snapshot(f), candidates=[await input(f),await input(f)];
    const applicationNames=['pdgld118-email-request-race-a','pdgld118-email-request-race-b'];
    const messageStart=messages.length;
    const services=applicationNames.map(name=>{
      const url=new URL(runtimeUrl); url.searchParams.set('application_name',name);
      const client=new PrismaClient({adapter:new PrismaPg({connectionString:url.href}),log:[]});
      raceClients.push(client);
      return createDatabaseEmailChanges(client,async()=>config.actorId,{
        async send(message) { messages.push(message); return 'ACCEPTED'; },
      });
    });
    let pendingRequests;
    await owner.query('BEGIN');
    try {
      await owner.query('SELECT pg_advisory_xact_lock(54,2026)');
      pendingRequests=Promise.allSettled(services.map((client,index)=>client.request(f,candidates[index])));
      let blocked=0;
      for(let attempt=0;attempt<200 && blocked!==2;attempt++) {
        await owner.query('SELECT pg_stat_clear_snapshot()');
        blocked=(await owner.query(`SELECT count(DISTINCT application_name)::int AS n
          FROM pg_stat_activity WHERE datname=current_database() AND application_name=ANY($1::text[])
          AND state='active' AND wait_event_type='Lock' AND query LIKE '%pg_advisory_xact_lock%'`,[applicationNames])).rows[0].n;
        if(blocked!==2) await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(blocked,2,'Ambas solicitudes deben estar esperando el bloqueo RF22.');
      await owner.query('COMMIT');
    } finally {
      await owner.query('ROLLBACK');
      if(pendingRequests) await pendingRequests;
    }
    const requestResults=await pendingRequests;
    assert.equal(requestResults.filter(row=>row.status==='fulfilled').length,1);
    assert.equal(requestResults.filter(row=>row.status==='rejected').length,1);
    const winnerIndex=requestResults.findIndex(row=>row.status==='fulfilled'), loserIndex=1-winnerIndex;
    assert.equal(requestResults[loserIndex].reason.code,'ACCOUNT_CHANGED');
    assert.equal(requestResults[loserIndex].reason.status,409);
    const winner=requestResults[winnerIndex].value, afterRequests=await snapshot(f);
    assert.equal(afterRequests.requests.length,1); assert.equal(afterRequests.audit.length,1);
    assert.equal(afterRequests.requests[0].operation_key,candidates[winnerIndex].operationKey);
    assert.equal(afterRequests.requests[0].status,'PENDING');
    assert.equal(afterRequests.user.maintenance_revision,concurrentBefore.user.maintenance_revision+1);
    assert.equal(afterRequests.user.email,concurrentBefore.user.email);
    assert.equal(afterRequests.user.version,concurrentBefore.user.version);
    assert.deepEqual(afterRequests.sessions,concurrentBefore.sessions);
    assert.deepEqual(afterRequests.resets,concurrentBefore.resets);
    const raceMessages=messages.slice(messageStart);
    assert.equal(raceMessages.length,2);
    const winnerMessage=raceMessages.find(message=>message.kind==='EMAIL_CHANGE_CONFIRMATION');
    assert.ok(winnerMessage); assert.equal(winnerMessage.to,candidates[winnerIndex].email);
    assert.ok(!raceMessages.some(message=>message.to===candidates[loserIndex].email));
    const oldNotice=raceMessages.find(message=>message.kind==='EMAIL_CHANGE_REQUESTED');
    assert.ok(oldNotice); assert.equal(oldNotice.to,concurrentBefore.user.email); assert.ok(!('token' in oldNotice));
    assert.ok(!('token' in winner)); assert.ok(!JSON.stringify(winner).includes(winnerMessage.token));

    // La petición perdedora con revisión vieja sigue sin escribir ni reemplazar.
    await rejectCode(service.request(f,candidates[loserIndex]),'ACCOUNT_CHANGED');
    assert.deepEqual(await snapshot(f),afterRequests);
    // Fixture: envejecer solo created_at permite atravesar el minuto documentado
    // sin cambiar límites, relojes de aplicación o versiones/revisiones oficiales.
    await age(f);
    const replacementInput=await input(f), replacement=await service.request(f,replacementInput), currentToken=token();
    assert.equal(replacement.revision,winner.revision+1);
    const replacedState=await snapshot(f);
    assert.equal(replacedState.requests.length,2);
    assert.equal(replacedState.requests.find(row=>row.id===winner.id).status,'SUPERSEDED');
    assert.equal(replacedState.requests.filter(row=>row.status==='PENDING').length,1);
    assert.equal(replacedState.requests.find(row=>row.status==='PENDING').id,replacement.id);
    await rejectCode(service.confirm({token:winnerMessage.token}),'EMAIL_CHANGE_INVALID');
    assert.deepEqual(await snapshot(f),replacedState);
    await service.confirm({token:currentToken});
    const finalState=await snapshot(f);
    assert.equal(finalState.user.email,replacementInput.email);
    assert.equal(finalState.user.maintenance_revision,concurrentBefore.user.maintenance_revision+3);
    assert.equal(finalState.user.version,concurrentBefore.user.version+1);
    assert.equal(finalState.requests.filter(row=>row.status==='PENDING').length,0);
    assert.equal(finalState.requests.find(row=>row.id===replacement.id).status,'CONFIRMED');
    assert.equal(finalState.requests.find(row=>row.id===winner.id).used_at,null);
    assert.equal(finalState.audit.length,3);
    assert.ok(finalState.sessions.every(row=>row.revoked_at)); assert.ok(finalState.resets.every(row=>row.used_at));
    await rejectCode(service.confirm({token:currentToken}),'EMAIL_CHANGE_INVALID');
    assert.deepEqual(await snapshot(f),finalState);
    if(target.runtimeDatabaseUrl) {
      const [identity]=await prisma.$queryRaw`SELECT current_user AS actor,row_security_active('sports_management.account_email_changes') AS rls`;
      assert.equal(identity.actor,'gestor_ligas_preview'); assert.equal(identity.rls,true);
      await assert.rejects(prisma.$executeRaw`DELETE FROM sports_management.account_email_changes WHERE false`);
      await assert.rejects(prisma.$executeRaw`UPDATE sports_management.account_email_changes SET token_hash=token_hash WHERE false`);
    }
    return {concurrentRequestsPassed:true};
  } finally {
    await owner.end();
    await Promise.all([prisma,...raceClients].map(client=>client.$disconnect()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.ok(process.send,'Solo con supervisor IPC aislado.');
  let running = true;
  process.on('disconnect', () => { if (running) process.exit(1); });
  process.once('message', async config => {
    try { const checks=await execute(config); running=false; process.send({completed:true,...checks},()=>process.disconnect()); }
    catch { running=false; process.exitCode=1; process.send({completed:false},()=>process.disconnect()); }
  });
}
