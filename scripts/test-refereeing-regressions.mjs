import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {resolve} from 'node:path';

// Linux como CI, sin publicar puertos. Comparte únicamente la red del PG propio.
const major=process.argv.find(a=>a.startsWith('--postgres='))?.split('=')[1]??'15';
assert.ok(['15','17'].includes(major));
assert.ok(!(process.argv.includes('--seed-only') && process.argv.includes('--preview-only')), 'Seleccionar un solo perfil de regresión.');
const nonce=randomBytes(8).toString('hex'),container=`pdgld143-regression-${nonce}`,runner=`${container}-node`;
const docker=args=>execFileSync('docker',args,{encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
const created=[];
try{
  docker(['create','--name',container,'--label',`pdgld143.owner=${nonce}`,'-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=gestor_ligas_ci',`postgres:${major}`]);created.push(container);
  docker(['start',container]);
  for(let n=0;;n++){try{docker(['exec',container,'pg_isready','-U','postgres']);break;}catch{if(n===60)throw Error('REGRESSION_DATABASE_NOT_READY');await new Promise(r=>setTimeout(r,250));}}
  const commands=[
    'mkdir /app',
    'cp -r /source/src /source/public /source/prisma /source/scripts /source/tests /app/',
    'cp /source/package.json /source/package-lock.json /source/prisma.config.ts /source/next.config.ts /source/tsconfig.json /app/',
    'cd /app','npm ci --no-audit --no-fund',
    'npm run test:ci',
    'npx --no-install prisma migrate deploy',
    'npx --no-install prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code',
    'node scripts/ci/verify-database.mjs','node scripts/ci/verify-production-security.mjs',
    process.argv.includes('--seed-only') ? 'npm run test:seed -- --existing'
      : process.argv.includes('--preview-only') ? 'node scripts/test-auth.mjs --preview' : 'node scripts/test-auth.mjs --authorization',
    // Reproduce también los pasos que CI no alcanzaba después del seed. La
    // marca de Actions es local a cada prueba; el destino sigue siendo el PG propio.
    ...(process.argv.includes('--seed-only') ? [
      'GITHUB_ACTIONS=true PDGLD22_TEST_DATABASE_URL="$DATABASE_URL" node --test tests/integration/venue-availability.test.mjs',
      'node --conditions=react-server --import tsx prisma/seed.ts --profile permissions',
      'GITHUB_ACTIONS=true node --conditions=react-server --import tsx --test tests/integration/league-governance.test.ts',
    ] : []),
  ].join(' && ');
  docker(['create','--name',runner,'--label',`pdgld143.owner=${nonce}`,'--network',`container:${container}`,
    '--mount',`type=bind,source=${resolve('.')},target=/source,readonly`,
    '-e','CI=true','-e','CI_DB_PORT=5432','-e','AUTH_TEST_RUN=1',
    '-e','DATABASE_URL=postgresql://postgres:synthetic-only@127.0.0.1:5432/gestor_ligas_ci',
    '-e','DIRECT_URL=postgresql://postgres:synthetic-only@127.0.0.1:5432/gestor_ligas_ci',
    '-e','NEXTAUTH_URL=http://127.0.0.1:3008','-e',`NEXTAUTH_SECRET=${randomBytes(48).toString('hex')}`,
    '-e','SUPABASE_URL=https://storage.example.test','-e','SUPABASE_STORAGE_SERVER_KEY=synthetic-only',
    '-e','ACCOUNT_EMAIL_ENABLED=false','-e','NEXT_TELEMETRY_DISABLED=1',
    'node:24-bookworm-slim','sh','-c',commands]);created.push(runner);
  const child=spawn('docker',['start','-a',runner],{stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  assert.equal(code,0,'EXISTING_REGRESSION_FAILED');
  console.log(`PDGLD-143 PG${major}: regresión de integridad y ${process.argv.includes('--seed-only') ? 'seed' : 'autorización'} existente: OK`);
}finally{
  for(const name of created.reverse()){
    const labels=JSON.parse(docker(['inspect','--format','{{json .Config.Labels}}',name]));
    assert.equal(labels['pdgld143.owner'],nonce);
    docker(['rm','-f',name]);
  }
}
