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
        assert.equal(req.headers.authorization,'Bearer synthetic-resend-key');
        assert.equal(value.from,'fixture@example.test');assert.equal(value.to.length,1);
        const temporaryPassword=value.text.match(/^Credencial temporal: (.+)$/m)?.[1];
        const expiresAt=value.text.match(/^Vence: (.+)$/m)?.[1];
        assert.ok(temporaryPassword&&expiresAt&&req.headers['idempotency-key']);
        messages.push({kind:'ADMINISTRATIVE_RESET',to:value.to[0],temporaryPassword,expiresAt,idempotencyKey:req.headers['idempotency-key']});
        res.writeHead(delivery==='ACCEPTED'?200:delivery==='FAILED'?422:503);
        res.end(JSON.stringify(delivery==='ACCEPTED'?{id:'synthetic-resend-id'}:{name:'synthetic-response'}));return;
      }
      res.writeHead(404).end('{}');
    }catch{res.writeHead(400).end('{}');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    const address=server.address();assert.equal(address.address,'127.0.0.1');
    const url=`http://127.0.0.1:${address.port}`,enableFile=`${app}/.synthetic-email-enabled`;
    const file=`${app}/src/server/email/transport.ts`,source=await readFile(file,'utf8');
    const marker=`export function getEmailTransport(): EmailTransport | null {
  const config = resendConfiguration(process.env);
  return config ? createResendEmailTransport(config) : null;
}`;
    assert.equal(source.split(marker).length,2);
    const replacement=`export function getEmailTransport(): EmailTransport | null {
      if (!existsSync(${JSON.stringify(enableFile)})) return null;
      return createResendEmailTransport({apiKey:'synthetic-resend-key',from:'fixture@example.test',origin:'https://ligas.example.test'},async (input,init)=>{
        if(String(input)!=='https://api.resend.com/emails')throw Error('UNEXPECTED_SYNTHETIC_ENDPOINT');
        const headers=new Headers(init?.headers);headers.set('x-fixture-key',${JSON.stringify(key)});
        return fetch(${JSON.stringify(url+'/delivery')},{...init,headers});
      });
    }`;
    await writeFile(file,"import { existsSync } from 'node:fs';\n"+source.replace(marker,replacement),{mode:0o600});
    return {config:{url,key,enableFile},async close(){try{await closeTestServer(server);}finally{messages.length=0;}}};
  }catch(error){await closeTestServer(server);throw error;}
}
