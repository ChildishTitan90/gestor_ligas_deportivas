import assert from "node:assert/strict";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import nextEnv from "@next/env";
import {PDFDocument,StandardFonts,rgb} from "pdf-lib";
import {getPrisma} from "../src/server/db/prisma";
import {validatePrivateFileContent} from "../src/server/files/private-file-validation";
import {mutatePresentationWithCredential,createCredentialPreview,readCredentialForActor} from "../src/features/referees/server/presentation-credentials";
import {createRefereeCredentialStorage} from "../src/features/referees/server/credential-storage";
import {getPresentationWorkspaceForActor,recoverPresentation} from "../src/features/referees/server/presentations";
nextEnv.loadEnvConfig(process.cwd(),true,{info(){},error(){}});
let db:ReturnType<typeof getPrisma>|undefined;let stage="target";
try{
  for(const name of ["DATABASE_URL","DIRECT_URL"]){const u=new URL(process.env[name]!);if(!["localhost","127.0.0.1"].includes(u.hostname)||u.port!=="5433"||u.pathname!=="/gestor_ligas_dev")throw Error("LOCAL_ONLY");}
  if(new URL(process.env.SUPABASE_URL!).hostname!=="loaztwwpwsaqzdtdtvvj.supabase.co")throw Error("TEST_STORAGE_ONLY");
  db=getPrisma();
  const delegate=await db.users.findFirstOrThrow({where:{username:"demo-delegado-a",is_active:true,must_change_password:false},select:{id:true}});
  const commission=await db.users.findFirstOrThrow({where:{username:"arbitraje_comision",is_active:true,must_change_password:false},select:{id:true}});
  const other=await db.users.findFirstOrThrow({where:{username:"demo-delegado-b"},select:{id:true}});
  const seasonId="33f8a69d-ed3c-5629-a464-6e9f440d8b42",clubId="54000000-0000-4000-8000-000000000005",operationKey="3a2756d9-388e-5b2a-a4c3-e48153651886";
  const season=await db.seasons.findUniqueOrThrow({where:{id:seasonId},select:{name:true,league_id:true}});if(season.name!=="DEMO Registro de jugadores 2026"||season.league_id!=="54000000-0000-4000-8000-000000000001")throw Error("CONTEXT_REQUIRED");
  const storage=createRefereeCredentialStorage();
  let request=await db.referee_presentations.findFirst({where:{requester_id:delegate.id,operation_key:operationKey},select:{id:true}}),installed=false;
  if(!request){
    stage="synthetic-pdf";
    const pdf=await PDFDocument.create();pdf.setCreationDate(new Date("2026-11-14T00:00:00Z"));pdf.setModificationDate(new Date("2026-11-14T00:00:00Z"));pdf.setTitle("Documento sintetico PDGLD-86");
    const font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage([595,420]);
    page.drawText("DOCUMENTO SINTETICO - NO ACREDITA",{x:40,y:340,size:22,font,color:rgb(.7,.1,.1)});
    page.drawText("Ejemplo de cedula arbitral para probar la vista previa.",{x:40,y:290,size:15,font});
    page.drawText("Candidato: SINTETICO Cedula PDGLD86",{x:40,y:250,size:15,font});
    page.drawText("Sin organismo emisor, licencia ni validez profesional.",{x:40,y:210,size:15,font});
    const path=new URL("../docs/validation/fixtures/cedula-arbitral-sintetica.pdf",import.meta.url);await mkdir(new URL(".",path),{recursive:true});await writeFile(path,await pdf.save());
    const bytes=await readFile(path),file=await validatePrivateFileContent(bytes,"application/pdf"),credential={mimeType:file.mimeType,sizeBytes:file.sizeBytes,sha256:file.sha256};
    const command={kind:"submit",clubId,seasonId,operationKey,credential,reason:"SINTÉTICO PDGLD-86: ejemplo de carga y vista previa; el documento no acredita a una persona real",candidate:{mode:"new",firstName:"SINTÉTICO Cédula",paternalSurname:"PDGLD86",maternalSurname:""}};
    stage="submit-with-storage";
    request=await mutatePresentationWithCredential(delegate.id,command,{bytes,mimeType:file.mimeType},storage);
    assert.deepEqual(await mutatePresentationWithCredential(delegate.id,command,{bytes,mimeType:file.mimeType},storage),request);
    assert.deepEqual(await recoverPresentation(delegate.id,operationKey),request);installed=true;
  }
  stage="authorized-preview";
  const access=await createCredentialPreview(commission.id,request.id,storage);
  assert.equal(access.mimeType,"application/pdf");assert.equal(access.expiresInSeconds,60);
  const response=await fetch(access.downloadUrl,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(20000)});assert.equal(response.ok,true);
  const actual=new Uint8Array(await response.arrayBuffer());await validatePrivateFileContent(actual,"application/pdf");
  await assert.rejects(readCredentialForActor(other.id,request.id));
  const workspace=await getPresentationWorkspaceForActor(commission.id);assert.ok(workspace.rows.find(r=>r.id===request!.id)?.credential);
  console.log(JSON.stringify({installed,presentationId:request.id,season:season.name,synthetic:true,commissionPreviewVerified:true,foreignClubDenied:true,previewLifetimeSeconds:60,productionUploads:0,newAccounts:0,url:"/referees/presentations"}));
}catch(e){console.error(JSON.stringify({code:"LOCAL_CREDENTIAL_CHECK_FAILED",stage,name:e instanceof Error?e.name:"unknown",domainCode:e instanceof Error&&"code" in e?e.code:undefined}));process.exitCode=1;}
finally{await db?.$disconnect();}
