import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import pg from 'pg';
import { Browser } from './auth.test.mjs';
import { fixturePassword } from './auth-fixtures.mjs';
import { prepareMaintenanceUI } from './account-maintenance-ui-fixtures.mjs';
import { validateAccountProvisioningTarget } from '../../scripts/verification/account-provisioning-entry.mjs';
import { childEnvironment } from '../../scripts/ci/delegate-isolated-runtime.mjs';

// Focused regression: retain the original auth-suite assertions and force both
// cookie identities to be read before either request can change the account.
export async function verifyPasswordChangeVersion(config) {
  const target=validateAccountProvisioningTarget(config);assert.equal(target.suite,'password-change-regression');
  assert.match(process.cwd(),/^\/(?:private\/tmp|tmp)\/pdgld106-[a-f0-9-]{36}\/app-pg(?:15|17)$/);
  const db=new pg.Client({connectionString:target.databaseUrl});
  try {
    await prepareMaintenanceUI(target);await db.connect();
    const account=(await db.query("SELECT id,email,version FROM sports_management.users WHERE username='pdgld48_operational'")).rows[0];
    const browsers=[new Browser(target.baseUrl),new Browser(target.baseUrl)];
    for(const browser of browsers){await browser.login(account.email,fixturePassword);assert.ok((await browser.session()).user);}
    assert.equal((await new Browser(target.baseUrl).request('/api/auth/change-password')).status,405);
    const newPasswords=[0,1].map(()=>`New-${randomBytes(24).toString('base64url')}!aA`);
    await db.query('BEGIN');await db.query('SELECT id FROM sports_management.users WHERE id=$1 FOR UPDATE',[account.id]);
    const pending=browsers.map((browser,index)=>browser.request('/api/auth/change-password',{method:'POST',headers:{origin:target.baseUrl,'Content-Type':'application/json'},body:JSON.stringify({currentPassword:fixturePassword,newPassword:newPasswords[index],confirmPassword:newPasswords[index]})}));
    let responses;
    try {
      let waiting=false;
      for(let attempt=0;attempt<100&&!waiting;attempt++){
        await db.query('SELECT pg_stat_clear_snapshot()');
        waiting=(await db.query(`SELECT count(*)::int >= 2 AS waiting FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%sports_management.users%' AND query LIKE '%FOR UPDATE%'`)).rows[0].waiting;
        if(!waiting)await new Promise(resolve=>setTimeout(resolve,50));
      }
      assert.equal(waiting,true,'Both requests must wait on the account lock.');
      await db.query('COMMIT');responses=await Promise.all(pending);
    }finally{await db.query('ROLLBACK');await Promise.allSettled(pending);}
    assert.deepEqual(responses.map(r=>r.status).sort(),[200,401]);
    const winner=responses.findIndex(r=>r.status===200),loser=1-winner;
    assert.equal((await responses[loser].json()).code,'UNAUTHORIZED');
    const after=(await db.query('SELECT version FROM sports_management.users WHERE id=$1',[account.id])).rows[0];
    assert.equal(after.version,account.version+1);
    assert.equal((await db.query("SELECT count(*)::int n FROM sports_management.authentication_events WHERE user_id=$1 AND action='PASSWORD_CHANGED'",[account.id])).rows[0].n,1);
    for(const browser of browsers)assert.equal((await browser.session()).user,undefined);
    const fresh=new Browser(target.baseUrl);await fresh.login(account.email,newPasswords[winner]);assert.ok((await fresh.session()).user);
    const rejected=new Browser(target.baseUrl);await rejected.login(account.email,newPasswords[loser]);assert.equal((await rejected.session()).user,undefined);
    await new Promise((resolve,reject)=>execFile(process.execPath,[`${process.cwd()}/node_modules/typescript/bin/tsc`,'--noEmit','--incremental','false'],{cwd:process.cwd(),env:childEnvironment(process.env),timeout:120000},error=>error?reject(Error('PASSWORD_CHANGE_TYPECHECK_FAILED')):resolve()));
    const major=new URL(target.databaseUrl).port.slice(-2);
    await writeFile(`${dirname(process.cwd())}/evidence-pg${major}/password-change-version.json`,JSON.stringify({passed:true,typecheck:true,overlap:'two-requests-waiting-on-account-lock',statuses:[200,401],versionIncrements:1,audits:1,oldSessionsRevoked:true,winningPasswordWorks:true,losingPasswordRejected:true},null,2),{mode:0o600});
  }finally{await db.end();}
}
