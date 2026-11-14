import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { assertPermission, AuthorizationError, getActorPermissionGrants, grantCoversContext, type PermissionAction } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { authorizeRefereeing, ensurePresentingClub, lockRefereeing, personInRefereeingLeague, RefereeError, type Receipt } from "./service";
import { presentationMutation, type PresentationMutation, type PresentationWorkspace, type CredentialMetadata } from "../presentation-contract";
import {readRefereeClubQuotas} from "./club-quota";
type Tx=Prisma.TransactionClient;
export type StoredRefereeCredential=CredentialMetadata&{fileId:string;objectKey:string};
type RequestRow={id:string;season_id:string;club_id:string;requester_id:string;operation_key:string;input_hash:string;person_id:string|null;first_name:string;paternal_surname:string;maternal_surname:string|null;reason:string;status:"PENDING"|"APPROVED"|"REJECTED";version:number;created_at:Date;reviewed_by:string|null;review_key:string|null;review_hash:string|null;review_reason:string|null;approved_person_id:string|null;approved_identity:{label:string}|null;referee_id:string|null};
const names={id:true,first_name:true,paternal_surname:true,maternal_surname:true,identity_version:true} satisfies Prisma.peopleSelect;
const label=(p:{first_name:string;paternal_surname:string;maternal_surname:string|null})=>[p.first_name,p.paternal_surname,p.maternal_surname].filter(Boolean).join(" ");
export function personVisibleInClub(clubId:string,seasonId:string):Prisma.peopleWhereInput{return {OR:[
  {player_registrations:{some:{season_id:seasonId,season_teams:{club_id:clubId}}}},
  {club_officers:{some:{club_affiliations:{club_id:clubId,season_id:seasonId}}}},
  {referees:{club_season_referees:{some:{club_id:clubId}}}},
]};}
async function context(tx:Tx,clubId:string,seasonId:string){
  if(!z.uuid().safeParse(clubId).success||!z.uuid().safeParse(seasonId).success)throw new AuthorizationError();
  const row=await tx.club_affiliations.findUnique({where:{club_id_season_id:{club_id:clubId,season_id:seasonId}},select:{league_id:true,status:true,clubs:{select:{status:true}},seasons:{select:{status:true}}}});
  if(!row || row.status!=="APPROVED" || row.clubs.status!=="ACTIVE")throw new RefereeError("INVALID_PRESENTATION");
  return row;
}
export async function submitAccess(tx:Tx,actorId:string,clubId:string,seasonId:string){
  const ctx=await context(tx,clubId,seasonId);
  await assertPermission(tx,actorId,{module:"clubs",action:"READ",context:{clubId,seasonId,leagueId:ctx.league_id}});
  const grants=await assertPermission(tx,actorId,{module:"clubs",action:"CREATE",context:{clubId,seasonId,leagueId:ctx.league_id}});
  // Presentar por el club consume su capacidad contextual; no concede refereeing.
  if(!grants.some(g=>g.clubId===clubId))throw new AuthorizationError();
  return ctx;
}
export async function reviewAccess(tx:Tx,actorId:string,row:{club_id:string;season_id:string}){
  const ctx=await context(tx,row.club_id,row.season_id);
  await authorizeRefereeing(tx,actorId,"READ",ctx.league_id,row.season_id,row.club_id);
  await authorizeRefereeing(tx,actorId,"APPROVE",ctx.league_id,row.season_id,row.club_id);
  return ctx;
}
async function contexts(tx:Tx,actorId:string){
  // Snapshot limitado a esta transacción: conserva bloqueo RF22 y las filas de
  // concesión. Evita releer identidad/permisos por cada club y cada acción.
  const grants=await getActorPermissionGrants(tx,actorId);
  const submission=grants.filter(g=>g.module==="clubs"&&g.action==="CREATE").flatMap(g=>g.clubId?[g.clubId]:[]);
  const review=grants.filter(g=>g.module==="refereeing"&&g.action==="APPROVE"&&!g.contextOnly&&!g.clubId);
  const all=review.some(g=>!g.leagueId);
  const affiliations=await tx.club_affiliations.findMany({where:{status:"APPROVED",clubs:{status:"ACTIVE"},seasons:{leagues:{is_active:true}},OR:[{club_id:{in:submission}},...(all?[{}]:[{league_id:{in:review.flatMap(g=>g.leagueId?[g.leagueId]:[])}}])]},select:{club_id:true,season_id:true,league_id:true,clubs:{select:{name:true}},seasons:{select:{name:true,status:true,leagues:{select:{name:true,timezone:true}}}}},orderBy:[{season_id:"asc"},{club_id:"asc"}]});
  const result=[];
  for(const a of affiliations){
    // Este contexto procede de afiliaciones verificadas en PostgreSQL, no de IDs del navegador.
    const resolved={leagueId:a.league_id,seasonId:a.season_id,clubIds:[a.club_id],hasContext:true};
    const covers=(module:string,action:PermissionAction,wide=false)=>grants.some(g=>g.module===module&&g.action===action&&(!wide||!g.contextOnly&&!g.clubId)&&grantCoversContext(g,resolved));
    const canSubmit=covers("clubs","READ")&&grants.some(g=>g.module==="clubs"&&g.action==="CREATE"&&g.clubId===a.club_id&&grantCoversContext(g,resolved));
    const canReview=covers("refereeing","READ",true)&&covers("refereeing","APPROVE",true);
    const canProvisionAccess=canReview&&a.seasons.status!=="CLOSED"&&covers("referee-accounts","CREATE",true);
    if(canSubmit||canReview)result.push({id:a.club_id,name:a.clubs.name,seasonId:a.season_id,season:a.seasons.name,leagueId:a.league_id,league:a.seasons.leagues.name,timezone:a.seasons.leagues.timezone,closed:a.seasons.status==="CLOSED",canSubmit,canReview,canProvisionAccess,teams:0,presented:0,pending:0});
  }
  return result;
}
export async function canAccessRefereePresentations(){const actor=await requireOperationalUser();return getPrisma().$transaction(async tx=>(await contexts(tx,actor.id)).length>0,{timeout:20000});}
export async function getPresentationWorkspace(){return getPresentationWorkspaceForActor((await requireOperationalUser()).id);}
export async function getPresentationWorkspaceForActor(actorId:string):Promise<PresentationWorkspace>{
  return getPrisma().$transaction(async tx=>{
    const clubs=await contexts(tx,actorId);
    if(!clubs.length)throw new AuthorizationError();
    const result:PresentationWorkspace={actorId,clubs,rows:[],people:[]};
    const where=Prisma.join(clubs.map(c=>Prisma.sql`(p.club_id=${c.id}::uuid AND p.season_id=${c.seasonId}::uuid)`)," OR ");
    const rows=await tx.$queryRaw<(RequestRow&{requester:string;reviewer:string|null})[]>`SELECT p.*,u.username AS requester,ru.username AS reviewer FROM sports_management.referee_presentations p JOIN sports_management.users u ON u.id=p.requester_id LEFT JOIN sports_management.users ru ON ru.id=p.reviewed_by WHERE ${where} ORDER BY p.created_at DESC,p.id`;
    result.rows=rows.map(r=>{const c=clubs.find(c=>c.id===r.club_id&&c.seasonId===r.season_id)!;return {id:r.id,clubId:r.club_id,club:c.name,seasonId:r.season_id,season:c.season,status:r.status,version:r.version,name:label(r),reason:r.reason,requester:r.requester,createdAt:r.created_at.toISOString(),reviewer:r.reviewer,reviewReason:r.review_reason,personId:r.person_id,approvedPersonId:r.approved_person_id,approvedName:r.approved_identity?.label??null,refereeId:r.referee_id};});
    const credentials=await tx.referee_presentation_credentials.findMany({where:{id:{in:rows.map(r=>r.id)}},select:{id:true,file:{select:{mime_type:true,size_bytes:true,sha256:true}}}});
    for(const row of result.rows){const c=credentials.find(c=>c.id===row.id);row.credential=c?{mimeType:c.file.mime_type as CredentialMetadata["mimeType"],sizeBytes:Number(c.file.size_bytes),sha256:c.file.sha256!}:null;}
    const quotas:Awaited<ReturnType<typeof readRefereeClubQuotas>>=[];
    for(const season of new Set(clubs.map(c=>c.seasonId)))quotas.push(...await readRefereeClubQuotas(tx,season,clubs.filter(c=>c.seasonId===season).map(c=>c.id)));
    const catalogs=new Map<string,Awaited<ReturnType<typeof tx.people.findMany<{select:typeof names}>>>>();
    for(const c of clubs){
      const quota=quotas.find(q=>q.id===c.id&&q.seasonId===c.seasonId);c.teams=quota?.registeredTeams??0;c.presented=quota?.presented??0;
      c.pending=rows.filter(r=>r.club_id===c.id&&r.season_id===c.seasonId&&r.status==="PENDING").length;
      if(c.closed)continue;
      const catalogKey=c.canReview?`league:${c.leagueId}`:`club:${c.id}:${c.seasonId}`;
      let people=catalogs.get(catalogKey);
      if(!people){people=await tx.people.findMany({where:c.canReview?personInRefereeingLeague(c.leagueId):personVisibleInClub(c.id,c.seasonId),select:names,orderBy:[{first_name:"asc"},{id:"asc"}]});catalogs.set(catalogKey,people);}
      for(const p of people){let item=result.people.find(i=>i.id===p.id);if(!item){item={id:p.id,label:label(p),clubContexts:[],leagueIds:[],identityVersion:p.identity_version};result.people.push(item);}if(c.canSubmit && !item.clubContexts.includes(`${c.id}:${c.seasonId}`))item.clubContexts.push(`${c.id}:${c.seasonId}`);if(c.canReview&&!item.leagueIds.includes(c.leagueId))item.leagueIds.push(c.leagueId);}
    }
    return result;
  },{timeout:20000});
}
export async function requestById(tx:Tx,id:string){const rows=await tx.$queryRaw<RequestRow[]>`SELECT * FROM sports_management.referee_presentations WHERE id=${id}::uuid FOR UPDATE`;if(!rows[0])throw new AuthorizationError();return rows[0];}
export async function mutatePresentation(actorId:string,input:unknown):Promise<Receipt>{
  try{return await getPrisma().$transaction(tx=>mutatePresentationInTransaction(tx,actorId,input),{timeout:20000});}catch(e){if(e instanceof Prisma.PrismaClientKnownRequestError){if(e.code==="P2002")throw new RefereeError("ALREADY_PRESENTED");if(e.code==="P2010"&&JSON.stringify(e.meta).includes("PRESENTING_CLUB_FIXED"))throw new RefereeError("PRESENTING_CLUB_FIXED");}throw e;}
}

/** El actor proviene de sesión; la entrada interna conserva todas las comprobaciones. */
export async function mutatePresentationInTransaction(tx:Tx,actorId:string,input:unknown,credential?:StoredRefereeCredential):Promise<Receipt>{
  const parsed=presentationMutation.safeParse(input);if(!parsed.success)throw new RefereeError("INVALID_PAYLOAD",400);
  const command=parsed.data,hash=createHash("sha256").update(JSON.stringify(command)).digest("hex");
    await lockRefereeing(tx);
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${command.reason},true)`;
    if(command.kind==="submit"){
      const ctx=await submitAccess(tx,actorId,command.clubId,command.seasonId);
      const [prior]=await tx.$queryRaw<RequestRow[]>`SELECT * FROM sports_management.referee_presentations WHERE (requester_id=${actorId}::uuid AND operation_key=${command.operationKey}::uuid) OR (reviewed_by=${actorId}::uuid AND review_key=${command.operationKey}::uuid)`;
      if(prior){if(prior.requester_id!==actorId||prior.operation_key!==command.operationKey||prior.input_hash!==hash)throw new RefereeError("OPERATION_KEY_REUSED");return {id:prior.id,version:1,operationKey:command.operationKey};}
      if(ctx.seasons.status==="CLOSED")throw new RefereeError("CLOSED_CONTEXT");
      if(!command.credential||!credential)throw new RefereeError("CREDENTIAL_REQUIRED",400);
      let personId:string|null=null;let first:string,last:string,maternal:string|null;
      if(command.candidate.mode==="existing"){
        const p=await tx.people.findFirst({where:{id:command.candidate.personId,...personVisibleInClub(command.clubId,command.seasonId)},select:names});if(!p)throw new AuthorizationError();
        personId=p.id;first=p.first_name;last=p.paternal_surname;maternal=p.maternal_surname;
        if(await tx.club_season_referees.findFirst({where:{season_id:command.seasonId,referees:{person_id:personId}},select:{id:true}}))throw new RefereeError("ALREADY_PRESENTED");
      }else{first=command.candidate.firstName;last=command.candidate.paternalSurname;maternal=command.candidate.maternalSurname||null;}
      const [duplicate]=await tx.$queryRaw<{id:string}[]>`SELECT id FROM sports_management.referee_presentations WHERE season_id=${command.seasonId}::uuid AND club_id=${command.clubId}::uuid AND status='PENDING' AND lower(trim(first_name))=lower(trim(${first})) AND lower(trim(paternal_surname))=lower(trim(${last})) AND coalesce(lower(trim(maternal_surname)),'')=coalesce(lower(trim(${maternal})), '')`;
      if(duplicate)throw new RefereeError("ALREADY_PRESENTED");
      const [saved]=await tx.$queryRaw<{id:string;version:number}[]>`INSERT INTO sports_management.referee_presentations(club_id,season_id,requester_id,operation_key,input_hash,person_id,first_name,paternal_surname,maternal_surname,reason) VALUES(${command.clubId}::uuid,${command.seasonId}::uuid,${actorId}::uuid,${command.operationKey}::uuid,${hash},${personId}::uuid,${first},${last},${maternal},${command.reason}) RETURNING id,version`;
      await storeCredential(tx,actorId,saved.id,command,hash,credential);
      return {...saved,operationKey:command.operationKey};
    }
    if(command.kind==="credential"){
      const row=await requestById(tx,command.presentationId);
      const ctx=await submitAccess(tx,actorId,row.club_id,row.season_id);
      const prior=await tx.referee_presentation_credentials.findFirst({where:{uploaded_by:actorId,operation_key:command.operationKey},select:{id:true,input_hash:true}});
      if(prior){if(prior.id!==row.id||prior.input_hash!==hash)throw new RefereeError("OPERATION_KEY_REUSED");return {id:row.id,version:1,operationKey:command.operationKey};}
      if(await tx.referee_presentations.findFirst({where:{OR:[{requester_id:actorId,operation_key:command.operationKey},{reviewed_by:actorId,review_key:command.operationKey}]},select:{id:true}}))throw new RefereeError("OPERATION_KEY_REUSED");
      if(row.status!=="PENDING"||row.version!==command.expectedVersion)throw new RefereeError("STALE_VERSION");
      if(ctx.seasons.status==="CLOSED")throw new RefereeError("CLOSED_CONTEXT");
      if(!credential)throw new RefereeError("CREDENTIAL_REQUIRED",400);
      await storeCredential(tx,actorId,row.id,command,hash,credential);
      return {id:row.id,version:row.version,operationKey:command.operationKey};
    }
    const row=await requestById(tx,command.presentationId),ctx=await reviewAccess(tx,actorId,row);
    const [usedKey]=await tx.$queryRaw<RequestRow[]>`SELECT * FROM sports_management.referee_presentations WHERE (requester_id=${actorId}::uuid AND operation_key=${command.operationKey}::uuid) OR (reviewed_by=${actorId}::uuid AND review_key=${command.operationKey}::uuid)`;
    if(usedKey&&(usedKey.id!==row.id||usedKey.reviewed_by!==actorId||usedKey.review_key!==command.operationKey))throw new RefereeError("OPERATION_KEY_REUSED");
    if(row.review_key===command.operationKey&&row.reviewed_by===actorId){if(row.review_hash!==hash)throw new RefereeError("OPERATION_KEY_REUSED");return {id:row.id,version:row.version,operationKey:command.operationKey};}
    if(await tx.referee_presentation_credentials.findFirst({where:{uploaded_by:actorId,operation_key:command.operationKey},select:{id:true}}))throw new RefereeError("OPERATION_KEY_REUSED");
    if(row.status!=="PENDING"||row.version!==command.expectedVersion)throw new RefereeError("STALE_VERSION");
    if(ctx.seasons.status==="CLOSED")throw new RefereeError("CLOSED_CONTEXT");
    let personId:string|null=null,refereeId:string|null=null,identity:string|null=null;
    if(command.kind==="accept"){
      const evidence=await tx.referee_presentation_credentials.findUnique({where:{id:row.id},select:{file:{select:{sha256:true}}}});
      if(!evidence)throw new RefereeError("CREDENTIAL_REQUIRED");
      if(!command.reviewedCredentialSha256||command.reviewedCredentialSha256!==evidence.file.sha256)throw new RefereeError("CREDENTIAL_REVIEW_REQUIRED");
      const person=await resolvePerson(tx,actorId,row,command,ctx.league_id);
      const existing=await tx.referees.findUnique({where:{person_id:person.id},select:{id:true}});
      await authorizeRefereeing(tx,actorId,existing?"UPDATE":"CREATE",ctx.league_id,row.season_id,row.club_id);
      const referee=existing??await tx.referees.create({data:{person_id:person.id,is_active:true},select:{id:true}});
      await ensurePresentingClub(tx,referee.id,row.club_id,row.season_id);
      personId=person.id;refereeId=referee.id;identity=JSON.stringify({label:label(person),identityVersion:person.identity_version,credentialSha256:evidence.file.sha256});
    }
    const [saved]=await tx.$queryRaw<{id:string;version:number}[]>`UPDATE sports_management.referee_presentations SET status=${command.kind==="accept"?"APPROVED":"REJECTED"},reviewed_by=${actorId}::uuid,reviewed_at=clock_timestamp(),review_reason=${command.reason},review_key=${command.operationKey}::uuid,review_hash=${hash},approved_person_id=${personId}::uuid,referee_id=${refereeId}::uuid,approved_identity=${identity}::jsonb WHERE id=${row.id}::uuid RETURNING id,version`;
    return {...saved,operationKey:command.operationKey};

}

async function resolvePerson(tx:Tx,actorId:string,row:RequestRow,command:Extract<PresentationMutation,{kind:"accept"|"reject"}>,leagueId:string){
  const selected=row.person_id??command.personId;
  if(row.person_id&&command.personId&&row.person_id!==command.personId)throw new RefereeError("PERSON_MATCH_REQUIRES_REVIEW");
  if(selected){
    const p=await tx.people.findFirst({where:{id:selected,...personInRefereeingLeague(leagueId)},select:names});if(!p)throw new AuthorizationError();
    if(command.expectedIdentityVersion!==p.identity_version)throw new RefereeError("IDENTITY_CHANGED");return p;
  }
  if(!command.confirmNewPerson)throw new RefereeError("PERSON_CONFIRMATION_REQUIRED");
  await authorizeRefereeing(tx,actorId,"CREATE",leagueId,row.season_id,row.club_id);
  // Los nombres no acreditan identidad: nunca fusionar por coincidencia. Una
  // coincidencia global detiene el alta; no revela datos de otras ligas.
  const matches=await tx.people.findMany({where:{first_name:{equals:row.first_name.trim(),mode:"insensitive"},paternal_surname:{equals:row.paternal_surname.trim(),mode:"insensitive"}},select:{id:true},take:1});
  if(matches.length)throw new RefereeError("PERSON_MATCH_REQUIRES_REVIEW");
  return tx.people.create({data:{first_name:row.first_name,paternal_surname:row.paternal_surname,maternal_surname:row.maternal_surname},select:names});
}
export async function recoverPresentation(actorId:string,key:string){
  if(!z.uuid().safeParse(key).success)throw new RefereeError("INVALID_PAYLOAD",400);
  return getPrisma().$transaction(async tx=>{
    const [r]=await tx.$queryRaw<RequestRow[]>`SELECT * FROM sports_management.referee_presentations WHERE (requester_id=${actorId}::uuid AND operation_key=${key}::uuid) OR (reviewed_by=${actorId}::uuid AND review_key=${key}::uuid)`;
    if(!r){const c=await tx.referee_presentation_credentials.findFirst({where:{uploaded_by:actorId,operation_key:key},select:{id:true,presentation:{select:{club_id:true,season_id:true}}}});if(!c)return null;await submitAccess(tx,actorId,c.presentation.club_id,c.presentation.season_id);return {id:c.id,version:1,operationKey:key};}
    if(r.requester_id===actorId&&r.operation_key===key){await submitAccess(tx,actorId,r.club_id,r.season_id);return {id:r.id,version:1,operationKey:key};}
    await reviewAccess(tx,actorId,r);return {id:r.id,version:r.version,operationKey:key};
  });
}

async function storeCredential(tx:Tx,actorId:string,presentationId:string,command:Extract<PresentationMutation,{kind:"submit"|"credential"}>,hash:string,file:StoredRefereeCredential){
  const expected=command.credential;
  if(!expected||expected.sha256!==file.sha256||expected.mimeType!==file.mimeType||expected.sizeBytes!==file.sizeBytes)throw new RefereeError("CREDENTIAL_CONFLICT");
  if(await tx.referee_presentation_credentials.findUnique({where:{id:presentationId},select:{id:true}}))throw new RefereeError("CREDENTIAL_CONFLICT");
  await tx.files.create({data:{id:file.fileId,storage_key:file.objectKey,original_name:"Cédula arbitral",mime_type:file.mimeType,size_bytes:BigInt(file.sizeBytes),sha256:file.sha256,uploaded_by:actorId},select:{id:true}});
  await tx.referee_presentation_credentials.create({data:{id:presentationId,file_id:file.fileId,uploaded_by:actorId,operation_key:command.operationKey,input_hash:hash},select:{id:true}});
}
