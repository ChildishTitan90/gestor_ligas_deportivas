import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,open} from 'node:fs/promises';

const major=process.argv.find(a=>a.startsWith('--postgres='))?.split('=')[1]??'15';
assert.ok(['15','17'].includes(major));
const directory=`.codex-attachments/pdgld149/pg${major}`;
await mkdir(directory,{recursive:true});
const steps=process.argv.includes('--regression')?[
  ['elegibilidad',['scripts/test-match-eligibility-isolated.mjs',`--postgres=${major}`]],
  ['designaciones',['--conditions=react-server','--import','tsx','scripts/referees-local.mts','--acceptance','--http',`--postgres=${major}`]],
  ['identidad-historica',['scripts/test-season-identity-history.mjs']],
  ['firmas',['--conditions=react-server','--import','tsx','--test','src/features/match-reports/server/signature-storage-profile.test.ts','src/features/clubs/server/signature-validation.test.ts','src/features/clubs/server/signature-binding.test.ts']],
]:[
  ['reglas-cliente',['--import','tsx','--test','src/features/match-reports/tactics.test.ts','src/features/match-reports/lineup-clock.test.ts','src/features/match-reports/report-client.test.ts']],
  ['componentes-sinteticos',['--test','--test-concurrency=1','tests/e2e/match-report-demo.test.mjs','tests/e2e/report-signature-browser.test.mjs']],
  ['integracion-real',['--conditions=react-server','--import','tsx','scripts/match-reports-local.mts','--acceptance','--http','--browser',`--postgres=${major}`]],
];
const results=[];
try{
  for(const [name,args]of steps){
    const log=await open(`${directory}/${name}.log`,'w');const started=Date.now();
    const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});for(const channel of ['stdout','stderr'])child[channel].on('data',data=>{process.stdout.write(data);log.write(data);});child.once('error',reject);child.once('close',resolve);});
    await log.close();results.push({name,code,milliseconds:Date.now()-started});assert.equal(code,0,`PDGLD149_${name}_FAILED`);
  }
}finally{
  const report={postgres:major,executedAt:new Date().toISOString(),results,notExecuted:steps.map(([name])=>name).filter(name=>!results.some(r=>r.name===name)),acceptance:'BLOCKED',blockers:['Finalización oficial con historial','Receptor mínimo de expedientes disciplinarios'],note:'Pasar estas comprobaciones no acepta PDGLD-18/147/149. No se sustituyen los efectos oficiales por mocks.'};
  await writeFile(`${directory}/${process.argv.includes('--regression')?'regression':'checks'}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
