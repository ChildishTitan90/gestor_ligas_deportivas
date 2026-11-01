import "server-only";
import {z} from "zod";
import {getPrisma} from "@/server/db/prisma";
import {requireOperationalUser} from "@/server/auth/session";
import {AuthorizationError} from "@/server/auth/authorization";
import {assertPlayerRegistrationRead,lockPlayerTeamContext} from "./access";
import {summarizeDossier,minorAtDate} from "../document-rules";

export async function getPlayerDossier(registrationId:string){
  return readPlayerDossierForActor((await requireOperationalUser()).id,registrationId);
}
/** Contrato interno. No confirma Storage ni habilita aprobación deportiva. */
export async function readPlayerDossierForActor(actorId:string,registrationId:string){
  if(!z.uuid().safeParse(registrationId).success) throw new AuthorizationError();
  return getPrisma().$transaction(async tx=>{
    const registration=await tx.player_registrations.findUnique({where:{id:registrationId},select:{season_team_id:true,status:true,withdrawn_at:true,registered_at:true,people:{select:{identity_version:true,birth_date:true}}}});
    if(!registration)throw new AuthorizationError();
    const context=await assertPlayerRegistrationRead(tx,actorId,registrationId,registration.season_team_id);
    let canUpdate=true;try{await lockPlayerTeamContext(tx,actorId,registration.season_team_id,"UPDATE");}catch(error){if(!(error instanceof AuthorizationError))throw error;canUpdate=false;}
    const configured=await tx.document_requirements.findMany({where:{season_category_id:context.seasonCategoryId},
      select:{id:true,document_type_id:true,quantity:true,is_required:true,document_types:{select:{name:true,code:true}}},orderBy:{id:"asc"}});
    const documents=await tx.player_documents.findMany({where:{registration_id:registrationId},
      select:{id:true,document_type_id:true,status:true},orderBy:{id:"asc"}});
    const events=await tx.audit_logs.findMany({where:{entity_id:registrationId,action:"PLAYER_DOCUMENT_CONFIRMED"},select:{new_data:true}});
    const revisions=events.map(e=>e.new_data as {documentId:string;replacesDocumentId:string|null;identityVersion:number});
    const confirmed=new Set(revisions.filter(r=>r.identityVersion===registration.people.identity_version).map(r=>r.documentId));
    const superseded=new Set(revisions.map(r=>r.replacesDocumentId));
    const referenceDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(registration.registered_at);
    const minor=minorAtDate(registration.people.birth_date?.toISOString().slice(0,10) ?? null,referenceDate);
    const requirements=configured.filter(r=>!["GUARDIAN_CONSENT","STUDENT_ID"].includes(r.document_types.code) || minor===true);
    const configurationIssues:string[]=[];
    if(minor===null)configurationIssues.push("UNKNOWN_AGE");
    if(!requirements.some(r=>r.document_types.code==="CURP" && r.is_required))configurationIssues.push("MISSING_CURP_REQUIREMENT");
    if(minor===true && !requirements.some(r=>r.document_types.code==="GUARDIAN_CONSENT" && r.is_required))configurationIssues.push("MISSING_GUARDIAN_REQUIREMENT");
    if(requirements.some(r=>r.document_types.code==="STUDENT_ID" && r.is_required))configurationIssues.push("STUDENT_ID_MUST_BE_OPTIONAL");
    if(requirements.some(r=>!["CURP","INE","GUARDIAN_CONSENT","STUDENT_ID"].includes(r.document_types.code)))configurationIssues.push("UNSUPPORTED_REQUIREMENT");
    return {registrationId,...summarizeDossier(requirements.map(r=>({id:r.id,typeId:r.document_type_id,quantity:r.quantity,required:r.is_required})),
      documents.filter(d=>!superseded.has(d.id)).map(d=>({id:d.id,typeId:d.document_type_id,status:d.status,storageConfirmed:confirmed.has(d.id)}))),
      configurationIssues,minorAtRegistration:minor,referenceDate,canUpload:canUpdate && registration.status==="INELIGIBLE" && !registration.withdrawn_at && context.seasonStatus!=="CLOSED" && context.teamStatus!=="WITHDRAWN" && context.affiliationStatus==="APPROVED" && context.categoryAuthorized,
      documentTypes:requirements.map(r=>({id:r.document_type_id,...r.document_types})),
      documents:documents.map(d=>({id:d.id,typeId:d.document_type_id,reviewStatus:d.status,superseded:superseded.has(d.id),requirementId:(events.find(e=>(e.new_data as {documentId:string}).documentId===d.id)?.new_data as {requirementId?:string}|undefined)?.requirementId,
        slot:(events.find(e=>(e.new_data as {documentId:string}).documentId===d.id)?.new_data as {slot?:number}|undefined)?.slot,storageConfirmation:confirmed.has(d.id)?"CONFIRMED" as const:"NOT_CHECKED" as const})),
      guardianConsent:minor===true?"REQUIRES_ACCREDITATION" as const:minor===false?"NOT_REQUIRED" as const:"UNKNOWN_AGE" as const};
  },{isolationLevel:"RepeatableRead"});
}
