import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {dirname} from 'node:path';
import {validateAccountProvisioningTarget} from './account-provisioning-entry.mjs';
import {childEnvironment} from '../ci/delegate-isolated-runtime.mjs';
export async function runPlayerAgeCompatibility(config){
 const target=validateAccountProvisioningTarget(config);
 assert.equal(target.suite,'identity-age-regression');
 assert.match(process.cwd(),/^\/(?:private\/tmp|tmp)\/pdgld106-[a-f0-9-]{36}\/app-pg(?:15|17)$/);
 const major=new URL(target.databaseUrl).port.slice(-2),directory=`${dirname(process.cwd())}/evidence-pg${major}`;
 const env={...childEnvironment(process.env),AUTH_TEST_RUN:'1',DATABASE_URL:target.databaseUrl,DIRECT_URL:target.databaseUrl,NEXTAUTH_URL:target.baseUrl};
 const result=await new Promise(resolve=>execFile(process.execPath,['--conditions=react-server','--import','tsx','--test','--test-concurrency=1','--test-reporter=tap','tests/integration/player-registrations.test.ts','tests/integration/authorization-player-registration.test.ts'],{cwd:process.cwd(),env,timeout:480000,maxBuffer:4*1024*1024},(error,stdout,stderr)=>resolve({error,stdout,stderr})));
 const raw=result.stdout+'\n'+result.stderr;
 const summary=raw.split('\n').filter(line=>/^# (tests|suites|pass|fail|cancelled|skipped|duration_ms)|^\s*(not ok|ok) \d/.test(line));
 const locations=[...raw.matchAll(/(?:tests|src)\/[\w./-]+\.(?:ts|tsx|mjs):\d+:\d+/g)].map(m=>m[0]);
 await writeFile(`${directory}/age-compatibility.json`,JSON.stringify({passed:!result.error,providers:'synthetic-only',summary,locations},null,2),{mode:0o600});
 // Errores sintéticos privados, con conexiones/secretos de la copia eliminados.
 const safe=raw.replaceAll(target.databaseUrl,'[isolated-connection]').replace(/postgres(?:ql)?:\/\/[^\s"']+/g,'[isolated-connection]');
 await writeFile(`${directory}/age-compatibility-private.log`,safe,{mode:0o600});
 if(result.error)throw Object.assign(Error('AGE_COMPATIBILITY_FAILED'),{code:'AGE_COMPATIBILITY_FAILED'});
}
