import assert from "node:assert/strict";
import {randomBytes,randomUUID,createHash} from "node:crypto";
import {writeFile} from "node:fs/promises";
import * as argon2 from "argon2";
import type {PrismaClient} from "@prisma/client";
import {PDFDocument} from "pdf-lib";
import {Browser} from "./auth.test.mjs";
import {authorizePlayerDocumentUploadForActor} from "../../src/features/players/server/document-service";
import {getPlayerDocumentPolicy} from "../../src/features/players/server/document-policy";
import {createSupabasePlayerDocumentStorage} from "../../src/features/players/server/supabase-document-storage";

/** Únicamente se invoca mediante --documents-real; conserva objetos y manifiesto, sin limpieza remota. */
export async function runPlayerDocumentStorageReal(db:PrismaClient,actors:{delegate:string;other:string},registration:{registrationId:string;seasonCategoryId:string}){
  assert.equal(process.env.AUTH_TEST_RUN,"1");assert.equal(process.env.PLAYER_DOCUMENT_STORAGE_REAL_TEST,"1");
  const target=new URL(process.env.DATABASE_URL!);assert.match(target.pathname,/^\/pdgld48_test_[a-f0-9]{16}$/);
  // El runner verificó URL/clave contra el archivo privado antes de crear la BD o el servidor.
  const expected={SUPABASE_URL:process.env.SUPABASE_URL};
  const baseUrl=process.env.PLAYER_DOCUMENT_HTTP_BASE_URL!;
  const policy=await getPlayerDocumentPolicy();assert.ok(policy);
  const transport=createSupabasePlayerDocumentStorage();
  const pdf=await PDFDocument.create();pdf.addPage();const bytes=await pdf.save();
  const otherPdf=await PDFDocument.create();otherPdf.addPage([200,200]);const different=await otherPdf.save();
  const hash=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
  const password=`Synthetic-${randomBytes(24).toString('hex')}!aA`;
  const passwordHash=await argon2.hash(password,{memoryCost:19456,timeCost:2,parallelism:1});
  const login=async(id:string)=>{const user=await db.users.update({where:{id},data:{password_hash:passwordHash},select:{email:true}});const browser=new Browser(baseUrl);const result=await browser.login(user.email,password);assert.equal(result.searchParams.get('error'),null);return browser;};
  const owner=await login(actors.delegate),foreign=await login(actors.other),anonymous=new Browser(baseUrl);
  const type=await db.document_types.findUniqueOrThrow({where:{code:"CURP"}});
  const requirement=await db.document_requirements.create({data:{season_category_id:registration.seasonCategoryId,document_type_id:type.id}});
  if(process.env.PLAYER_DOCUMENT_KEEP_SERVER==='1'){
    const user=await db.users.findUniqueOrThrow({where:{id:actors.delegate},select:{email:true}});
    await writeFile(`${process.env.PLAYER_DOCUMENT_TEST_MANIFEST}.session.json`,JSON.stringify({baseUrl,email:user.email,password,registrationId:registration.registrationId}),{mode:0o600});
    await writeFile(`${process.env.PLAYER_DOCUMENT_TEST_MANIFEST}.synthetic.pdf`,bytes,{mode:0o600});
  }
  const body=()=>({operationKey:randomUUID(),registrationId:registration.registrationId,requirementId:requirement.id,slot:1,replacesDocumentId:null,
    mimeType:"application/pdf",sizeBytes:bytes.length,sha256:hash(bytes)});
  const request=(browser:Browser,path:string,data:unknown,method="POST",mime="application/json")=>browser.request(path,{method,headers:{origin:baseUrl,"content-type":mime},body:mime==="application/json"?JSON.stringify(data):data});
  const manifest:{bucket:string;databaseDiscardedAfterTest:boolean;objects:Array<{scenario:string;uploadId:string;objectKey:string;state:string;documentId?:string}>}={bucket:"expedientes-jugadores",databaseDiscardedAfterTest:true,objects:[]};
  const save=()=>writeFile(process.env.PLAYER_DOCUMENT_TEST_MANIFEST!,JSON.stringify(manifest,null,2),{mode:0o600});
  const plan=async(uploadId:string,scenario:string)=>{
    const authorized=await authorizePlayerDocumentUploadForActor(actors.delegate,uploadId,policy);
    const entry={scenario,uploadId,objectKey:authorized.objectKey,state:"planned"};manifest.objects.push(entry);await save();return entry;
  };
  const prepare=async(data:ReturnType<typeof body>)=>{
    const response=await request(owner,"/api/player-documents/uploads",data);assert.equal(response.status,200);
    assert.ok(response.headers.get('cache-control')?.includes('no-store'));return response.json();
  };
  try{
    const a=body();
    assert.equal((await request(anonymous,"/api/player-documents/uploads",a)).status,401);
    assert.equal((await request(foreign,"/api/player-documents/uploads",a)).status,403);
    const prepared=await prepare(a);
    assert.equal((await prepare(a)).uploadId,prepared.uploadId);
    const object=await plan(prepared.uploadId,"confirmed-synthetic-pdf");
    const path=prepared.uploadPath;
    assert.equal((await request(foreign,path,bytes,"PUT","application/pdf")).status,403);
    assert.equal((await request(owner,path,different,"PUT","application/pdf")).status,409);
    const upload=await request(owner,path,bytes,"PUT","application/pdf");assert.equal(upload.status,200);
    object.state="stored-unconfirmed";await save();
    const replay=await request(owner,path,bytes,"PUT","application/pdf");assert.equal(replay.status,200);assert.equal((await replay.json()).replayed,true);
    const confirm=await request(owner,`${path}/confirm`,{});assert.equal(confirm.status,200);
    const receipt=await confirm.json();object.state="confirmed";Object.assign(object,{documentId:receipt.documentId});await save();
    const replayConfirm=await request(owner,`${path}/confirm`,{});assert.equal(replayConfirm.status,200);assert.equal((await replayConfirm.json()).documentId,receipt.documentId);
    const status=await owner.request(path);assert.equal((await status.json()).state,"CONFIRMED");
    assert.equal((await foreign.request(path)).status,403);
    const downloadPath=`/api/player-documents/${receipt.documentId}/download`;
    assert.equal((await request(foreign,downloadPath,{})).status,403);
    const link=await request(owner,downloadPath,{});assert.equal(link.status,200);
    const signed=await link.json();assert.equal(signed.expiresInSeconds,60);
    const downloaded=await fetch(signed.downloadUrl,{signal:AbortSignal.timeout(20000)});assert.equal(downloaded.status,200);
    assert.ok(hash(new Uint8Array(await downloaded.arrayBuffer()))===hash(bytes));
    const publicResponse=await fetch(`${expected.SUPABASE_URL}/storage/v1/object/public/expedientes-jugadores/${object.objectKey}`,{signal:AbortSignal.timeout(20000)});assert.ok(!publicResponse.ok);await publicResponse.body?.cancel();
    const dossier=await owner.request(`/api/player-registrations/${registration.registrationId}/documents`);assert.equal(dossier.status,200);
    assert.equal((await dossier.json()).approvalAllowed,false);
    assert.equal((await foreign.request(`/api/player-registrations/${registration.registrationId}/documents`)).status,403);
    const pagePath=`/players/registrations/${registration.registrationId}/documents`;
    const page=await owner.request(pagePath);assert.equal(page.status,200);assert.ok((await page.text()).includes('Expediente documental'));
    const deniedPage=await foreign.request(pagePath);assert.ok((await deniedPage.text()).includes('no tiene acceso'));
    // Intento de sustitución cuyo objeto se corrompe fuera de la aplicación, usando el fixture confiable.
    const b={...body(),replacesDocumentId:receipt.documentId};
    const mismatch=await prepare(b),mismatchObject=await plan(mismatch.uploadId,"different-than-prepared");
    await transport.put(mismatchObject.objectKey,{bytes:different,mimeType:"application/pdf"});mismatchObject.state="stored-mismatch-not-associated";await save();
    assert.equal((await request(owner,`${mismatch.uploadPath}/confirm`,{})).status,409);
    assert.equal((await owner.request(mismatch.uploadPath).then(r=>r.json())).state,"PENDING_STORAGE");
    assert.equal((await request(owner,mismatch.uploadPath,bytes,"PUT","application/pdf")).status,503);
    assert.ok(hash(await transport.read(mismatchObject.objectKey,10485760))===hash(different));
    const missing=await prepare({...body(),replacesDocumentId:receipt.documentId});
    const missingObject=await plan(missing.uploadId,"missing-object");missingObject.state="not-created";await save();
    assert.equal((await request(owner,`${missing.uploadPath}/confirm`,{})).status,503);
    assert.equal(await db.player_documents.count({where:{registration_id:registration.registrationId}}),1);
    console.log("Supabase pruebas: carga, descarga privada, reintentos, discrepancia, objeto ausente y denegaciones HTTP comprobados; 2 objetos sintéticos conservados, sin limpieza remota.");
  }finally{await save();if(process.env.PLAYER_DOCUMENT_KEEP_SERVER!=='1')await db.document_requirements.delete({where:{id:requirement.id}});}
}
