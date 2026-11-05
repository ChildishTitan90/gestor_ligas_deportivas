import "server-only";
import {createHash} from "node:crypto";
import type {Prisma} from "@prisma/client";
import {getPrisma} from "@/server/db/prisma";
import {AuthorizationError} from "@/server/auth/authorization";
import {adjacentBirthDates} from "../identity-rules";
import {minorAtDate} from "../document-rules";
import {playerIdentitySchema} from "../schemas";
import {lockPlayerTeamContext} from "./access";
import {findPossibleIdentityMatches} from "./identity-matches";
import {hasCurrentIdentityResolution} from "./identity-resolution";
import {manualPlayerScenario} from "./manual-player-scenario";
import {resolveCategoryDocuments,readCategoryDocumentState,type ResolvedDocuments} from "./category-document-requirements";
import {assessPlayerEligibility} from "./eligibility-assessment";

/** Se llama solo desde operaciones POST de servidor, nunca desde una lectura GET. */
export async function activateVerifiedAdultForActor(actorId:string,id:string,action:"UPDATE"|"APPROVE"="UPDATE"){
  return getPrisma().$transaction(async tx=>{
    const initial=await tx.player_registrations.findUnique({where:{id},select:{season_team_id:true,person_id:true}});
    if(!initial)throw new AuthorizationError();
    await lockPlayerTeamContext(tx,actorId,initial.season_team_id,action);
    const {row:context}=await lockPlayerTeamContext(tx,actorId,initial.season_team_id,"READ");
    if(await manualPlayerScenario(tx,initial.season_team_id))return;
    const before=await tx.people.findUniqueOrThrow({where:{id:initial.person_id},select:{birth_date:true}});
    if(!before.birth_date)return;
    // Mismo orden de locks que las altas para evitar una carrera con nuevas identidades similares.
    const dob=before.birth_date.toISOString().slice(0,10);
    for(const date of adjacentBirthDates(dob))await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`PDGLD-97:birth:${date}`},0))::text`;
    await tx.$queryRaw`SELECT pr.id FROM sports_management.player_registrations pr JOIN sports_management.people p ON p.id=pr.person_id WHERE pr.id=${id}::uuid FOR UPDATE OF pr,p`;
    const reg=await tx.player_registrations.findUniqueOrThrow({where:{id},select:{status:true,withdrawn_at:true,registered_at:true,identity_review_status:true,season_team_id:true,people:{select:{id:true,curp:true,first_name:true,paternal_surname:true,maternal_surname:true,birth_date:true,identity_version:true}}}});
    if(reg.status!=="INELIGIBLE" || reg.withdrawn_at || reg.season_team_id!==initial.season_team_id || reg.people.birth_date?.toISOString().slice(0,10)!==dob)return;
    if(context.seasonStatus==="CLOSED" || context.teamStatus==="WITHDRAWN" || context.affiliationStatus!=="APPROVED" || (!context.categoryAuthorized || !context.operational))return;
    const date=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(reg.registered_at);
    if(minorAtDate(dob,date)!==false)return;
    const category=await tx.season_categories.findUniqueOrThrow({where:{id:context.seasonCategoryId},select:{type:true,minimum_age:true,maximum_age:true,age_cutoff_date:true,eligibility_pending:true}});
    if(category.eligibility_pending || !category.age_cutoff_date || !["OPEN","YOUTH"].includes(category.type) || (category.type==="YOUTH" && category.maximum_age===null))return;
    // Edad deportiva por año de referencia configurado; no aplicar excepciones automáticamente.
    const age=category.age_cutoff_date.getUTCFullYear()-Number(dob.slice(0,4));
    if(age<0 || (category.minimum_age!==null && age<category.minimum_age) || (category.maximum_age!==null && age>category.maximum_age))return;
    const documents=await resolveCategoryDocuments(tx,context.seasonCategoryId,false);
    if(!documents.approved || documents.activation!=="VERIFIED_ADULT_CURP")return;
    const documentState=await readCategoryDocumentState(tx,id,reg.people.identity_version,documents);
    if(!documentState.eligibilityDocumentsComplete)return;
    const [clock]=await tx.$queryRaw<{now:Date}[]>`SELECT sports_management.player_participation_now() AS now`;
    if(await tx.sanctions.findFirst({where:{blocks_participation:true,starts_at:{lte:clock.now},AND:[{OR:[{ends_at:null},{ends_at:{gt:clock.now}}]},{OR:[{player_registrations:{person_id:reg.people.id}},{season_team_id:reg.season_team_id}]}]},select:{id:true}}))return;
    const raw={curp:reg.people.curp,firstName:reg.people.first_name,paternalSurname:reg.people.paternal_surname,maternalSurname:reg.people.maternal_surname ?? "",birthDate:dob};
    const identity=playerIdentitySchema.safeParse(raw);if(!identity.success)return;
    const fingerprint=createHash("sha256").update(JSON.stringify([reg.people.identity_version,raw])).digest("hex");
    const check=await tx.player_curp_checks.findFirst({where:{person_id:reg.people.id},orderBy:[{created_at:"desc"},{id:"desc"}],select:{id:true,status:true,identity_version:true,fingerprint:true}});
    if(!check || check.status!=="VERIFIED" || check.identity_version!==reg.people.identity_version || check.fingerprint!==fingerprint)return;
    const matches=await findPossibleIdentityMatches(tx,identity.data,reg.people.id);
    const resolved=matches.length?await hasCurrentIdentityResolution(tx,id,reg.people.id,matches):false;
    if((matches.length && !resolved) || (reg.identity_review_status==="REQUIRED" && !resolved)){
      if(reg.identity_review_status!=="REQUIRED"){
        await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','CURP verificada: coincidencia interna pendiente de revisión',true)`;
        await tx.player_registrations.update({where:{id},data:{identity_review_status:"REQUIRED"}});
      }
      return;
    }
    if(!(await assessPlayerEligibility(tx,id,[context])).ready)return;
    await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason','Habilitación automática de adulto: CURP verificada, política documental vigente y sin coincidencias pendientes',true)`;
    await tx.player_registrations.update({where:{id},data:{status:"ACTIVE",identity_review_status:"NOT_REQUIRED"}});
    await tx.player_status_history.create({data:{registration_id:id,previous_status:"INELIGIBLE",new_status:"ACTIVE",user_id:actorId,reason:"CURP verificada y reglas de activación automática cumplidas"}});
    await tx.audit_logs.create({data:{user_id:actorId,action:"PLAYER_AUTO_ACTIVATED",table_name:"player_registrations",entity_id:id,reason:"Adulto habilitado conforme a política documental explícita y CURP verificada",new_data:{policy:"VERIFIED_ADULT_CURP_V2",documentPolicyFingerprint:documents.fingerprint,checkId:check.id,identityVersion:reg.people.identity_version}}});
  },{timeout:15000});
}

/** Completar el expediente pendiente de un registro habilitado por esta política. */
export async function canCompleteActivatedDossier(tx:Prisma.TransactionClient,id:string,identityVersion:number,resolved?:ResolvedDocuments){
  const receipt=await tx.audit_logs.findFirst({where:{entity_id:id,action:{in:["PLAYER_AUTO_ACTIVATED","PLAYER_MANUAL_ACTIVATED"]},new_data:{path:["identityVersion"],equals:identityVersion}},select:{id:true}});
  const superior=await tx.player_category_participations.count({where:{origin_registration_id:id,status:{not:"WITHDRAWN"}}});
  if(!receipt && !superior)return false;
  if(resolved?.fingerprint){const state=await readCategoryDocumentState(tx,id,identityVersion,resolved);return !state.dossierComplete;}
  const events=await tx.audit_logs.findMany({where:{entity_id:id,action:"PLAYER_DOCUMENT_CONFIRMED"},select:{new_data:true}});
  const revisions=events.map(e=>e.new_data as {documentId:string;replacesDocumentId:string|null;identityVersion:number});
  const replaced=new Set(revisions.map(e=>e.replacesDocumentId));
  const current=revisions.filter(e=>e.identityVersion===identityVersion && !replaced.has(e.documentId)).map(e=>e.documentId);
  return !await tx.player_documents.findFirst({where:{registration_id:id,id:{in:current},document_types:{code:"CURP"},status:"VALIDATED"},select:{id:true}});
}
