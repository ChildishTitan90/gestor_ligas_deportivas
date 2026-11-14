import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import type pg from "pg";
import {PDFDocument} from "pdf-lib";
import {getPrisma} from "../../src/server/db/prisma";
import {validatePrivateFileContent} from "../../src/server/files/private-file-validation";
import {mutatePresentationWithCredential,createCredentialPreview,readCredentialForActor} from "../../src/features/referees/server/presentation-credentials";
import {mutatePresentation,recoverPresentation} from "../../src/features/referees/server/presentations";
import {getOwnAvailabilityWorkspaceForActor,mutateOwnAvailability} from "../../src/features/referees/server/own-availability";
import {getPermissionGrants} from "../../src/server/auth/authorization";
import {provisionRefereeAccess,recoverRefereeAccess} from "../../src/features/accounts/server/referee-access";

export async function verifyRefereeingAdditions(c:{db:pg.Client;actors:Record<string,string>;league:string;season:string;clubs:string[];referee:string}){
  const prisma=getPrisma(),{db}=c;
  const [runtime]=await prisma.$queryRaw<{role:string;rls:boolean}[]>`SELECT current_user::text AS role,(SELECT relrowsecurity FROM pg_class WHERE oid='sports_management.referee_presentation_credentials'::regclass) AS rls`;
  assert.equal(runtime.role,"gestor_ligas_preview");assert.equal(runtime.rls,true);
  const own=await getOwnAvailabilityWorkspaceForActor(c.actors.arbitro,c.league,c.season);assert.equal(own.canUpdate,true);
  const interval={kind:"availability",operationKey:randomUUID(),leagueId:c.league,seasonId:c.season,refereeId:c.referee,expectedVersion:own.referee!.version,startsAt:"2026-12-11T16:00:00Z",endsAt:"2026-12-11T18:00:00Z",available:true,reason:"Disponibilidad propia sintética"};
  const saved=await mutateOwnAvailability(c.actors.arbitro,interval);assert.deepEqual(await mutateOwnAvailability(c.actors.arbitro,interval),saved);
  await assert.rejects(mutateOwnAvailability(c.actors.arbitro,{...interval,operationKey:randomUUID()}));
  await assert.rejects(mutateOwnAvailability(c.actors.arbitro,{...interval,refereeId:randomUUID(),operationKey:randomUUID()}));
  assert.equal((await prisma.$transaction(tx=>getPermissionGrants(tx,c.actors.comision,"users","CREATE"))).length,0);
  const actors=[];
  for(const club of c.clubs.slice(0,2)){
    const person=(await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Delegado','Sintético') RETURNING id")).rows[0].id;
    const user=(await db.query("INSERT INTO sports_management.users(person_id,username,email,password_hash,is_active,must_change_password) SELECT $1,$2,$3,password_hash,true,false FROM sports_management.users WHERE id=$4 RETURNING id",[person,`delegate_${randomUUID()}`,`${randomUUID()}@example.test`,c.actors.comision])).rows[0].id;
    await db.query("INSERT INTO sports_management.user_roles(user_id,role_id,league_id,club_id,delegate_position) SELECT $1,id,$2,$3,'PRIMARY' FROM sports_management.roles WHERE code='CLUB_DELEGATE'",[user,c.league,club]);actors.push(user);
  }
  const pdf=await PDFDocument.create();pdf.addPage();const file=await validatePrivateFileContent(await pdf.save(),"application/pdf");
  const meta={sha256:file.sha256,mimeType:file.mimeType,sizeBytes:file.sizeBytes};
  // Transporte de Storage explícitamente simulado; sesión/base/permisos son reales.
  const objects=new Map<string,Uint8Array>();let puts=0;
  const storage={async put(key:string,value:{bytes:Uint8Array;mimeType:string}){puts++;if(objects.has(key)){assert.deepEqual(objects.get(key),value.bytes);return {replayed:true};}objects.set(key,value.bytes);return {replayed:false};},async read(key:string){const b=objects.get(key);assert.ok(b);return b;},async createDownloadUrl(){return {downloadUrl:"https://storage.example.test/synthetic-only",expiresInSeconds:60};}};
  const submit={kind:"submit",operationKey:randomUUID(),clubId:c.clubs[0],seasonId:c.season,reason:"Candidato sintético con acreditación",candidate:{mode:"new",firstName:`Candidato ${randomUUID()}`,paternalSurname:"Sintético",maternalSurname:""},credential:meta};
  const counts={people:await prisma.people.count(),users:await prisma.users.count()};
  await assert.rejects(mutatePresentation(actors[0],{...submit,credential:undefined}));
  await assert.rejects(mutatePresentationWithCredential(actors[1],submit,{bytes:file.bytes,mimeType:file.mimeType},storage));assert.equal(puts,0);
  const request=await mutatePresentationWithCredential(actors[0],submit,{bytes:file.bytes,mimeType:file.mimeType},storage);
  assert.deepEqual(await mutatePresentationWithCredential(actors[0],submit,{bytes:file.bytes,mimeType:file.mimeType},storage),request);assert.equal(puts,1);
  assert.deepEqual(await recoverPresentation(actors[0],submit.operationKey),request);
  await assert.rejects(mutatePresentationWithCredential(actors[0],{...submit,reason:"Contenido distinto con la misma clave"},{bytes:file.bytes,mimeType:file.mimeType},storage));
  assert.equal(await prisma.people.count(),counts.people);assert.equal(await prisma.users.count(),counts.users);
  await assert.rejects(readCredentialForActor(actors[1],request.id));
  assert.equal((await createCredentialPreview(c.actors.comision,request.id,storage)).expiresInSeconds,60);
  const accept={kind:"accept",presentationId:request.id,expectedVersion:request.version,operationKey:randomUUID(),reason:"Identidad y acreditación sintéticas revisadas",confirmNewPerson:true,reviewedCredentialSha256:meta.sha256};
  await assert.rejects(mutatePresentation(c.actors.comision,{...accept,reviewedCredentialSha256:undefined}));
  await assert.rejects(mutatePresentation(actors[0],accept));
  const accepted=await mutatePresentation(c.actors.comision,accept);assert.deepEqual(await mutatePresentation(c.actors.comision,accept),accepted);
  assert.equal(await prisma.people.count(),counts.people+1);assert.equal(await prisma.users.count(),counts.users);
  const row=await prisma.referee_presentations.findUniqueOrThrow({where:{id:request.id},select:{referee_id:true,club_id:true,approved_identity:true}});assert.equal(row.club_id,c.clubs[0]);assert.equal((row.approved_identity as {credentialSha256:string}).credentialSha256,meta.sha256);
  await assert.rejects(db.query("UPDATE sports_management.referee_presentation_credentials SET input_hash='changed' WHERE id=$1",[request.id]),/CREDENTIAL_IMMUTABLE/);
  const incorporated=await prisma.referees.findUniqueOrThrow({where:{id:row.referee_id!},select:{version:true,person_id:true,people:{select:{identity_version:true}}}});
  const access={kind:'create',operationKey:randomUUID(),refereeId:row.referee_id,seasonId:c.season,expectedRefereeVersion:incorporated.version,expectedIdentityVersion:incorporated.people.identity_version,username:`ref_${randomUUID().replaceAll('-','')}`,email:`${randomUUID()}@example.test`,temporaryPassword:'Synthetic-Referee-143!aA',reason:'Acceso limitado para árbitro incorporado'};
  await assert.rejects(provisionRefereeAccess(actors[0],access));
  await assert.rejects(provisionRefereeAccess(c.actors.programador,access));
  await assert.rejects(provisionRefereeAccess(c.actors.comision,{...access,roles:['SUPERADMIN']}));
  const account=await provisionRefereeAccess(c.actors.comision,access);
  assert.deepEqual(await provisionRefereeAccess(c.actors.comision,access),account);
  assert.deepEqual(await recoverRefereeAccess(c.actors.comision,access.operationKey),account);
  assert.equal((await prisma.users.findUniqueOrThrow({where:{id:account.id},select:{person_id:true,must_change_password:true}})).person_id,incorporated.person_id);
  assert.deepEqual((await prisma.user_roles.findMany({where:{user_id:account.id},select:{league_id:true,roles:{select:{code:true}}}})).map(r=>[r.roles.code,r.league_id]),[['REFEREE',c.league]]);
  assert.equal(await prisma.people.count(),counts.people+1);assert.equal(await prisma.users.count(),counts.users+1);
  console.log(JSON.stringify({suite:"PDGLD-143 ampliaciones",role:runtime.role,rls:true,storage:"transporte sintético",checks:["disponibilidad-propia-version-idempotencia","intervalos-ajenos-denegados","comision-sin-alta-general-de-cuentas","cedula-obligatoria","club-ajeno-sin-lectura-ni-carga","revision-documental-obligatoria","incorporacion-sin-cuenta","evidencia-inmutable"]}));
}
