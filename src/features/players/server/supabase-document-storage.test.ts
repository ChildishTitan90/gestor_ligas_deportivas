import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {createSupabasePlayerDocumentStorage,PlayerDocumentStorageError} from "./supabase-document-storage";
import {getPlayerDocumentPolicy} from "./document-policy";
const environment={SUPABASE_URL:"https://storage.example.test",SUPABASE_STORAGE_SERVER_KEY:"synthetic-server-key",SUPABASE_PLAYER_DOCUMENTS_BUCKET:"expedientes-jugadores"};
const key=`player-documents/v1/${Array.from({length:5},()=>randomUUID()).join('/')}`;
function fixture({privateBucket=true,limit=10485760,existing=false,stored=new Uint8Array([1,2,3]),declaredLength=3}={}){
  const calls:{url:string;options:RequestInit|undefined}[]=[];
  const fetcher:typeof fetch=async(input,options)=>{
    const url=String(input);calls.push({url,options});
    if(url.includes('/bucket/'))return Response.json({id:'expedientes-jugadores',public:!privateBucket,file_size_limit:limit,allowed_mime_types:['application/pdf','image/png','image/jpeg']});
    if(url.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/expedientes-jugadores/fake?token=synthetic'});
    if(options?.method==='POST')return existing?Response.json({statusCode:'409',error:'Duplicate',message:'synthetic collision'},{status:409}):Response.json({Key:'synthetic',Id:randomUUID()});
    return new Response(Buffer.from(stored),{headers:{'content-type':'application/pdf','content-length':String(declaredLength)}});
  };
  return {calls,transport:createSupabasePlayerDocumentStorage(environment,fetcher)};
}
test('requiere configuración privada y bloquea la red en suites normales',()=>{
  assert.throws(()=>createSupabasePlayerDocumentStorage({...environment,AUTH_TEST_RUN:'1'}),PlayerDocumentStorageError);
  assert.throws(()=>createSupabasePlayerDocumentStorage({...environment,SUPABASE_PLAYER_DOCUMENTS_BUCKET:'firmas-afiliacion'}),PlayerDocumentStorageError);
});
test('rechaza rutas arbitrarias y buckets públicos o con límites divergentes',async()=>{
  const valid=fixture();await assert.rejects(valid.transport.read('../outside',10485760),PlayerDocumentStorageError);assert.equal(valid.calls.length,0);
  for(const f of [fixture({privateBucket:false}),fixture({limit:999})])await assert.rejects(f.transport.read(key,10485760),PlayerDocumentStorageError);
});
test('sube sin upsert y recupera colisiones únicamente con bytes idénticos',async()=>{
  const first=fixture();assert.equal((await first.transport.put(key,{bytes:new Uint8Array([1,2,3]),mimeType:'application/pdf'})).replayed,false);
  const upload=first.calls.find(c=>c.options?.method==='POST')!;
  assert.equal(new Headers(upload.options?.headers).get('x-upsert'),'false');
  const repeat=fixture({existing:true});assert.equal((await repeat.transport.put(key,{bytes:new Uint8Array([1,2,3]),mimeType:'application/pdf'})).replayed,true);
  await assert.rejects(fixture({existing:true}).transport.put(key,{bytes:new Uint8Array([9,8,7]),mimeType:'application/pdf'}),PlayerDocumentStorageError);
});
test('limita bytes descargados y emite enlace de sesenta segundos',async()=>{
  await assert.rejects(fixture({declaredLength:10485761}).transport.read(key,10485760),PlayerDocumentStorageError);
  await assert.rejects(fixture({stored:new Uint8Array(6),declaredLength:0}).transport.read(key,5),PlayerDocumentStorageError);
  const result=await fixture().transport.createDownloadUrl(key);assert.equal(result.expiresInSeconds,60);
});
test('la política de prueba no se habilita en una base habitual ni remota',async()=>{
  const saved={AUTH_TEST_RUN:process.env.AUTH_TEST_RUN,DATABASE_URL:process.env.DATABASE_URL,PLAYER_DOCUMENT_TEST_POLICY:process.env.PLAYER_DOCUMENT_TEST_POLICY};
  try{
    process.env.AUTH_TEST_RUN='1';process.env.PLAYER_DOCUMENT_TEST_POLICY=JSON.stringify({referenceDate:'2026-01-01',opensAt:'2026-01-01T00:00:00Z',closesAt:'2026-12-31T00:00:00Z'});
    for(const value of ['postgresql://localhost:5433/gestor_ligas_dev','postgresql://example.test/pdgld48_test_0123456789abcdef']){process.env.DATABASE_URL=value;assert.equal(await getPlayerDocumentPolicy(),undefined);}
    process.env.DATABASE_URL='postgresql://localhost:5433/pdgld48_test_0123456789abcdef';assert.ok(await getPlayerDocumentPolicy());
  }finally{for(const [key,value] of Object.entries(saved)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
