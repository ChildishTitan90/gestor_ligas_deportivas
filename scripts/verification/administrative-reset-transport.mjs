import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { closeTestServer } from '../../tests/e2e/chrome-session.mjs';

/** Test-only substitution in the validated disposable copy, never the repository. */
export async function prepareAdministrativeTransport(app, major) {
  assert.match(app, /^\/(?:private\/tmp|tmp)\/pdgld106-[a-f0-9-]{36}\/app-pg(?:15|17)$/);
  assert.ok(app.endsWith(`app-pg${major}`));
  const key=randomBytes(32).toString('base64url'), messages=[];
  let delivery='ACCEPTED';
  const server=createServer(async(req,res)=>{
    res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Type','application/json');
    if(req.headers['x-fixture-key']!==key){res.writeHead(403).end('{}');return;}
    try {
      if(req.url==='/state'&&req.method==='GET'){res.end(JSON.stringify({messages,delivery}));return;}
      let body='',size=0;
      for await(const chunk of req){size+=chunk.length;if(size>8192)throw Error('LIMIT');body+=chunk.toString();}
      const value=JSON.parse(body);
      if(req.url==='/control'&&req.method==='POST'){
        assert.ok(['ACCEPTED','FAILED','UNKNOWN'].includes(value.delivery));delivery=value.delivery;res.end('{}');return;
      }
      if(req.url==='/delivery'&&req.method==='POST'){
        assert.equal(value.kind,'ADMINISTRATIVE_RESET');assert.ok(typeof value.temporaryPassword==='string');
        messages.push(value);res.end(JSON.stringify({delivery}));return;
      }
      res.writeHead(404).end('{}');
    }catch{res.writeHead(400).end('{}');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const address=server.address();assert.equal(address.address,'127.0.0.1');
    const url=`http://127.0.0.1:${address.port}`,enableFile=`${app}/.synthetic-email-enabled`;
    const file=`${app}/src/server/email/transport.ts`,source=await readFile(file,'utf8');
    const marker='export function getEmailTransport(): EmailTransport | null { return null; }';
    assert.equal(source.split(marker).length,2);
    const replacement=`export function getEmailTransport(): EmailTransport | null {
      if (!existsSync(${JSON.stringify(enableFile)})) return null;
      return { async send(message) {
        const response = await fetch(${JSON.stringify(url+'/delivery')}, {method:'POST', cache:'no-store',
          headers:{'Content-Type':'application/json','x-fixture-key':${JSON.stringify(key)}}, body:JSON.stringify(message)});
        if (!response.ok) return 'UNKNOWN';
        const result = await response.json();
        return ['ACCEPTED','FAILED','UNKNOWN'].includes(result.delivery) ? result.delivery : 'UNKNOWN';
      } };
    }`;
    await writeFile(file,"import { existsSync } from 'node:fs';\n"+source.replace(marker,replacement),{mode:0o600});
    return {config:{url,key,enableFile},async close(){try{await closeTestServer(server);}finally{messages.length=0;}}};
  }catch(error){await closeTestServer(server);throw error;}
}
