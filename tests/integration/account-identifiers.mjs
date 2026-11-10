import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { Browser } from './auth.test.mjs';
import { fixturePassword } from './auth-fixtures.mjs';

function identifierTest(t, name, work) {
  return t.test(name, async () => {
    try { await work(); }
    catch (error) {
      const location = error.stack?.match(/tests\/integration\/account-identifiers\.mjs:\d+:\d+/)?.[0];
      if (process.connected && location) process.send({ type: 'maintenance-failure', location });
      throw error;
    }
  });
}

/** Mismo harness exclusivo, actores y servicios que la entrega de estado. */
export async function runAccountIdentifierChecks({ t, db, users, admin, second, scoped, target, baseUrl }) {
  const path = id => `/api/account-maintenance/${id}/identifiers`;
  const input = (expectedRevision, changes) => ({ changes, expectedRevision, confirmed: true, reason: 'Corrección sintética de acceso' });
  const patch = (browser, id, data) => browser.request(path(id), { method: 'PATCH',
    headers: { origin: baseUrl, 'content-type': 'application/json' }, body: JSON.stringify(data) });
  const get = async id => {
    const response = await admin.request(path(id)); assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /private.*no-store/); return response.json();
  };
  const snapshot = async id => ({
    user: (await db.query('SELECT * FROM sports_management.users WHERE id=$1', [id])).rows[0],
    person: (await db.query('SELECT p.* FROM sports_management.people p JOIN sports_management.users u ON u.person_id=p.id WHERE u.id=$1', [id])).rows[0],
    roles: (await db.query('SELECT * FROM sports_management.user_roles WHERE user_id=$1 ORDER BY id', [id])).rows,
    audit: (await db.query("SELECT * FROM sports_management.audit_logs WHERE table_name='users' AND entity_id=$1 ORDER BY occurred_at,id", [id])).rows,
    sessions: (await db.query('SELECT * FROM sports_management.sessions WHERE user_id=$1 ORDER BY id', [id])).rows,
  });

  await identifierTest(t, 'identificadores: permiso global también para leer datos de edición; contratos estrictos', async () => {
    const before = await snapshot(users.underscore.id);
    for (const browser of [scoped, target, new Browser(baseUrl)]) {
      assert.ok([401,403].includes((await browser.request(path(users.underscore.id))).status));
      assert.ok([401,403].includes((await patch(browser, users.underscore.id, input(2, {username:'denegado'}))).status));
    }
    for (const changes of [{ firstName:'Nombre' }, {curp:'dato'}, {birthDate:'2000-01-01'}, {personId:randomUUID()}, {roles:[]}, {password:'dato'}, {email:'new@example.test'}, {username:'new',email:'new@example.test'}, {}])
      assert.equal((await patch(admin, users.underscore.id, input(2, changes))).status, 400);
    assert.equal((await patch(admin, users.underscore.id, input(99, {username:'obsoleto'}))).status, 409);
    assert.deepEqual(await snapshot(users.underscore.id), before);
    assert.deepEqual(Object.keys(await get(users.underscore.id)).sort(), ['email','id','revision','username']);
  });
  await identifierTest(t, 'índice lower impide username duplicado; email directo se rechaza sin efectos', async () => {
    const before = await snapshot(users.underscore.id);
    const response = await patch(admin, users.underscore.id, input(2, {username:' PDGLD48_CONCURRENT '}));
    assert.equal(response.status,409); assert.equal((await response.json()).code,'DUPLICATE_ACCOUNT');
    assert.equal((await patch(admin,users.underscore.id,input(2,{email:'new@example.test'}))).status,400);
    const current=await get(users.underscore.id);
    const unchanged=await patch(admin,users.underscore.id,input(2,{username:current.username.toUpperCase()}));
    assert.equal(unchanged.status,409); assert.equal((await unchanged.json()).code,'ACCOUNT_IDENTIFIERS_UNCHANGED');
    assert.deepEqual(await snapshot(users.underscore.id),before);
  });
  await identifierTest(t, 'edición normalizada conserva persona/referencias/asignaciones y revoca cookies con auditoría mínima', async () => {
    const before = await snapshot(users.underscore.id); const oldCookies = new Map(target.cookies);
    const suffix = randomBytes(6).toString('hex'); const username = `edit_${suffix}`; const email = before.user.email;
    const response = await patch(admin, users.underscore.id, input(2, {username:` ${username.toUpperCase()} `}));
    assert.equal(response.status, 200); const result = await response.json();
    assert.deepEqual(Object.keys(result).sort(), ['id','isActive','revision','sessionsRevoked','username']);
    assert.equal(result.revision, 3); assert.equal(result.sessionsRevoked, true);
    const after = await snapshot(users.underscore.id);
    assert.equal(after.user.username, username); assert.equal(after.user.email, email);
    assert.deepEqual(after.person, before.person); assert.deepEqual(after.roles, before.roles);
    const stable = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['username','email','maintenance_revision','version'].includes(key)));
    assert.deepEqual(stable(after.user), stable(before.user));
    assert.equal(after.user.version, before.user.version+1);
    assert.ok(after.sessions.every(row => row.revoked_at));
    assert.equal(after.audit.length, before.audit.length+1);
    const event = after.audit.at(-1); assert.equal(event.user_id, users.operational.id);
    assert.deepEqual(event.previous_data, {maintenance_revision:2});
    assert.deepEqual(event.new_data, {maintenance_revision:3,changed_fields:['username'],sessions_revoked:true});
    target.cookies = oldCookies; assert.equal((await target.session()).user, undefined);
    for (const identifier of [before.user.username]) {
      const browser = new Browser(baseUrl); await browser.login(identifier, fixturePassword);
      assert.equal((await browser.session()).user, undefined);
    }
    await target.login(username, fixturePassword); assert.ok((await target.session()).user);
    const byEmail = new Browser(baseUrl); await byEmail.login(email, fixturePassword); assert.ok((await byEmail.session()).user);
  });
  await identifierTest(t, 'dos cuentas disputando username tienen un ganador y un conflicto recuperable', async () => {
    const ids = [users.inactive.id, users.unknownHash.id];
    for (const field of ['username']) {
      const before = await Promise.all(ids.map(snapshot)); const details = await Promise.all(ids.map(get));
      const suffix = randomBytes(6).toString('hex'); const value = `race_${suffix}`;
      const responses = await Promise.all(ids.map((id,index) => patch(index ? second : admin,id,input(details[index].revision,{[field]:index ? value.toUpperCase() : value}))));
      assert.deepEqual(responses.map(r=>r.status).sort(), [200,409]);
      const loser = responses.findIndex(r=>r.status===409);
      assert.deepEqual(await responses[loser].json(), {code:'DUPLICATE_ACCOUNT'});
      assert.deepEqual(await snapshot(ids[loser]), before[loser]);
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM sports_management.users WHERE lower(${field})=lower($1)`, [value])).rows[0].n, 1);
    }
  });
  await identifierTest(t, 'edición y estado con la misma revisión no pueden confirmar ambos', async () => {
    const id = users.underscore.id; const current = await get(id); const suffix = randomBytes(6).toString('hex');
    const responses = await Promise.all([
      patch(admin,id,input(current.revision,{username:`mixed_${suffix}`})),
      second.request(`/api/account-maintenance/${id}/status`,{method:'PATCH',headers:{origin:baseUrl,'content-type':'application/json'},
        body:JSON.stringify({isActive:false,expectedRevision:current.revision,confirmed:true,reason:'Baja sintética concurrente'})}),
    ]);
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.equal((await responses.find(r=>r.status===409).json()).code,'ACCOUNT_CHANGED');
    assert.equal((await get(id)).revision,current.revision+1);
  });
  await identifierTest(t, 'fallo de auditoría en edición revierte identificadores, revisión, versión y sesiones', async () => {
    const id=users.concurrent.id;const before=await snapshot(id);const current=await get(id);
    assert.ok(before.sessions.some(row=>row.revoked_at===null),'El rollback debe proteger sesiones todavía activas.');
    const name=`fail_identifiers_${randomBytes(5).toString('hex')}`;
    await db.query(`CREATE FUNCTION sports_management.${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.table_name='users' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER ${name} BEFORE INSERT ON sports_management.audit_logs FOR EACH ROW EXECUTE FUNCTION sports_management.${name}()`);
    try { assert.equal((await patch(admin,id,input(current.revision,{username:`rollback_${randomBytes(6).toString('hex')}`}))).status,503); }
    finally { await db.query(`DROP TRIGGER ${name} ON sports_management.audit_logs`);await db.query(`DROP FUNCTION sports_management.${name}()`); }
    assert.deepEqual(await snapshot(id),before);
  });
  await identifierTest(t, 'login descubierto antes de una edición no autentica con el identificador antiguo tras esperar', async () => {
    const id=users.underscore.id;const current=await get(id);const browser=new Browser(baseUrl);
    // Fixture controlado: cambiar la fila mientras el login espera FOR UPDATE.
    await db.query('BEGIN'); let pending;
    try {
      await db.query('SELECT id FROM sports_management.users WHERE id=$1 FOR UPDATE',[id]);
      pending=browser.login(current.email,fixturePassword);
      let waiting=false;
      for(let attempt=0;attempt<100&&!waiting;attempt++) {
        // pg_stat_activity conserva su snapshot durante la transacción del fixture.
        await db.query('SELECT pg_stat_clear_snapshot()');
        waiting=(await db.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%sports_management.users%' AND query LIKE '%FOR UPDATE%') AS waiting`)).rows[0].waiting;
        if(!waiting) await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(waiting,true,'El login debe haber descubierto la cuenta y estar esperando su bloqueo.');
      await db.query('UPDATE sports_management.users SET is_active=true,email=$2,version=version+1,maintenance_revision=maintenance_revision+1 WHERE id=$1',[id,`${randomUUID()}@example.test`]);
      await db.query('COMMIT');
    } finally { await db.query('ROLLBACK'); if(pending) await pending; }
    assert.equal((await browser.session()).user,undefined);
  });
}

export async function runAccountSelfIdentifierCheck({ t, db, users, admin, second, baseUrl }) {
  await identifierTest(t, 'editar el propio username confirma la escritura y exige iniciar una sesión nueva', async () => {
    const current=(await db.query('SELECT id,username,maintenance_revision FROM sports_management.users WHERE id=ANY($1::uuid[]) AND is_active',[[users.operational.id,users.concurrent.id]])).rows[0];
    assert.ok(current);
    const browser=current.id===users.operational.id?admin:second;
    const nextUsername=`self_${randomBytes(6).toString('hex')}`;
    const response=await browser.request(`/api/account-maintenance/${current.id}/identifiers`,{method:'PATCH',headers:{origin:baseUrl,'content-type':'application/json'},
      body:JSON.stringify({changes:{username:nextUsername},expectedRevision:current.maintenance_revision,confirmed:true,reason:'Corrección sintética propia'})});
    assert.equal(response.status,200);assert.equal((await response.json()).sessionsRevoked,true);
    assert.equal((await browser.session()).user,undefined);
    await browser.login(nextUsername,fixturePassword);assert.ok((await browser.session()).user);
  });
}
