import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { childEnvironment } from './ci/delegate-isolated-runtime.mjs';
const container=`pdgld29-${randomBytes(8).toString('hex')}`;
const database=`pdgld48_test_${randomBytes(8).toString('hex')}`;
const major=process.argv.includes('--postgres=17')?'17':'15';
const docker=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
let created=false;
try {
 docker(['run','-d','--name',container,'--label','pdgld.ticket=PDGLD-29','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e',`POSTGRES_DB=${database}`,'-p','127.0.0.1::5432',`postgres:${major}`]);created=true;
 const port=docker(['port',container,'5432/tcp']).split(':').at(-1);
 for(let n=0;n<80;n++){try{docker(['exec',container,'pg_isready','-U','postgres']);break;}catch{await new Promise(r=>setTimeout(r,250));}}
 const url=`postgresql://postgres:synthetic@127.0.0.1:${port}/${database}`;
 const env={...childEnvironment(process.env),DATABASE_URL:url,DIRECT_URL:url,NEXTAUTH_URL:'http://127.0.0.1:3099',NEXTAUTH_SECRET:randomBytes(48).toString('hex'),STANDINGS_ISOLATED:'1'};
 for(const args of [['node_modules/prisma/build/index.js','migrate','deploy'],['--conditions=react-server','--import','tsx','--test','src/features/standings/calculation.test.ts','tests/integration/standings.test.ts']]){
 const run=spawnSync(process.execPath,args,{env,encoding:'utf8',maxBuffer:8*1024*1024});
 console.log((run.stdout+run.stderr).replaceAll(url,'[base desechable]'));
 if(run.status!==0)throw Error('Falló clasificación aislada');
 }
}finally{if(created)docker(['rm','-f',container]);}
